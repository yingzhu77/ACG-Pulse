import type { Server } from 'socket.io';
import { prisma } from '../../db.js';
import { createAnalysisTaskIfAbsent, wakeAnalysisQueue } from '../ai/analysisQueue.js';
import { getAdapter } from '../adapters/registry.js';
import { contentHash, normalizeUrl, truncate } from '../utils.js';
import { fetchBilibiliAvatar } from '../adapters/bilibiliVideo.js';
import { getHealthLogRetentionDays, getMaxFeedItems } from '../config.js';
import { invalidatePublicStatsCache } from '../services/statsService.js';
import { buildFeedItemIdentityKey } from '../itemIdentity.js';
import { archiveFeedOverflow } from '../services/events.js';

let checkRunning = false;
let checkStartedAt: Date | null = null;
let healthLogUnavailableWarned = false;

export interface CheckResult {
  checkedSources: number;
  newItems: number;
  failedSources: number;
}

interface SourceCheckResult {
  newItems: number;
  failed: boolean;
}

// Clean up expired health logs
async function cleanupExpiredHealthLogs(): Promise<number> {
  const retentionDays = getHealthLogRetentionDays();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  try {
    const result = await prisma.sourceHealthLog.deleteMany({
      where: { checkedAt: { lt: cutoff } }
    });

    if (result.count > 0) {
      console.log(`[GamePulse] Cleaned up ${result.count} health logs older than ${retentionDays} days`);
    }
    return result.count;
  } catch (error) {
    warnHealthLogUnavailable(error);
    return 0;
  }
}

// Clean up old feed items when limit is exceeded
export async function enforceFeedItemLimit(): Promise<number> {
  const maxItems = getMaxFeedItems();
  const current = await prisma.feedItem.count({ where: { hidden: false, eventArchived: false } });
  if (current <= maxItems) return 0;
  return archiveFeedOverflow(maxItems);
}

export async function runGamePulseCheck(io?: Server): Promise<CheckResult> {
  if (process.env.ACG_PULSE_OFFLINE === '1') {
    return { checkedSources: 0, newItems: 0, failedSources: 0 };
  }
  if (checkRunning) {
    const elapsed = checkStartedAt ? Math.round((Date.now() - checkStartedAt.getTime()) / 1000) : 0;
    console.log(`[GamePulse] Check already running for ${elapsed}s, skipping`);
    return { checkedSources: 0, newItems: 0, failedSources: 0 };
  }

  checkRunning = true;
  checkStartedAt = new Date();

  try {
    return await doRunGamePulseCheck(io);
  } finally {
    checkRunning = false;
    checkStartedAt = null;
  }
}

async function doRunGamePulseCheck(io?: Server): Promise<CheckResult> {
  const sources = await prisma.source.findMany({
    where: { enabled: true },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }]
  });

  const results = await runWithConcurrency(sources, getSourceCheckConcurrency(), source => checkSource(source, io));

  // Cleanup old items after check. Identity uniqueness prevents new duplicates.
  await enforceFeedItemLimit();
  await cleanupExpiredHealthLogs();
  invalidatePublicStatsCache();

  return {
    checkedSources: sources.length,
    newItems: results.reduce((sum, result) => sum + result.newItems, 0),
    failedSources: results.filter(result => result.failed).length
  };
}

async function checkSource(
  source: Awaited<ReturnType<typeof prisma.source.findMany>>[number],
  io?: Server
): Promise<SourceCheckResult> {
  try {
    const adapter = getAdapter(source);
    const rawItems = await withTimeout(
      adapter.fetch(source),
      getSourceCheckTimeoutMs(),
      `Source check timeout after ${getSourceCheckTimeoutMs()}ms`
    );
    let sourceNewCount = 0;
    // The first non-empty successful harvest establishes the baseline for this source.
    const isSourceBackfill = !source.firstIngestAt;

    for (const raw of rawItems) {
      const normalizedUrl = normalizeUrl(raw.url);
      const identityKey = buildFeedItemIdentityKey(raw);
      const title = truncate(raw.title, 500) || 'Untitled';
      const content = truncate(raw.content, 5000) || raw.title;
      const authorName = truncate(raw.authorName || source.name, 120);
      const authorUrl = truncate(raw.authorUrl, 500);
      const coverUrl = truncate(raw.coverUrl, 1000);
      const sourcePublishedAt = raw.publishedAt && Number.isFinite(raw.publishedAt.getTime()) ? raw.publishedAt : null;
      const hash = contentHash([identityKey, title, content, sourcePublishedAt?.toISOString()]);
      const existing = await prisma.feedItem.findFirst({
        where: {
          sourceId: source.id,
          OR: [{ identityKey }, { contentHash: hash }, { url: normalizedUrl }]
        }
      });
      if (existing) {
        const storedContent = existing.eventArchived ? content.slice(0, 200) : content;
        const contentChanged = !existing.eventArchived && (existing.title !== title || existing.content !== storedContent);
        const publishedAt = sourcePublishedAt ?? existing.publishedAt;
        const effectiveHash = contentHash([identityKey, title, content, publishedAt?.toISOString()]);
        const needsUpdate = existing.identityKey !== identityKey
          || existing.contentHash !== effectiveHash
          || existing.url !== normalizedUrl
          || existing.externalId !== (raw.externalId || raw.url)
          || existing.coverUrl !== coverUrl
          || existing.authorName !== authorName
          || existing.authorUrl !== authorUrl
          || existing.publishedAt?.getTime() !== publishedAt?.getTime();

        if (needsUpdate) {
          await prisma.$transaction(async tx => {
            await tx.feedItem.update({
              where: { id: existing.id },
              data: {
                identityKey,
                externalId: raw.externalId || raw.url,
                itemKind: raw.itemKind,
                title,
                content: storedContent,
                url: normalizedUrl,
                authorName,
                authorUrl,
                coverUrl,
                sourceType: source.type,
                contentHash: effectiveHash,
                publishedAt,
                fetchedAt: new Date()
              }
            });
            if (contentChanged) {
              await tx.analysis.updateMany({
                where: { feedItemId: existing.id },
                data: {
                  status: 'pending', category: null, importance: 'low', visibility: 'public', confidence: 0,
                  summary: null, reason: null, dedupKeywords: null, provider: null, model: null,
                  analyzedAt: null, error: null
                }
              });
              await createAnalysisTaskIfAbsent(existing.id, tx);
            }
          });
          if (contentChanged) wakeAnalysisQueue(io);
        }
        continue;
      }

      const item = await prisma.$transaction(async tx => {
        const created = await tx.feedItem.create({
          data: {
            sourceId: source.id,
            externalId: raw.externalId || raw.url,
            itemKind: raw.itemKind,
            game: source.game,
            title,
            content,
            url: normalizedUrl,
            authorName,
            authorUrl,
            coverUrl,
            sourceType: source.type,
            identityKey,
            contentHash: hash,
            isSourceBackfill,
            publishedAt: sourcePublishedAt
          },
          include: {
            source: true
          }
        });
        await createAnalysisTaskIfAbsent(created.id, tx);
        return created;
      });

      sourceNewCount++;
      wakeAnalysisQueue(io);

      if (isSourceBackfill) continue;

      try {
        await prisma.notification.create({
          data: {
            type: 'feed_item',
            title: `发现新情报：${item.title.slice(0, 60)}`,
            content: item.content.slice(0, 120),
            feedItemId: item.id
          }
        });
      } catch (error) {
        console.warn(`[GamePulse] Notification write failed for item ${item.id}:`, error);
      }

      io?.to(`game:${item.game}`).emit('item:new', item);
      io?.emit('notification', {
        type: 'feed_item',
        title: item.title,
        content: item.content.slice(0, 120),
        feedItemId: item.id,
        importance: 'pending'
      });
    }

    // 获取 B站用户头像（如果还没有）
    if (source.type === 'bilibili_video' && source.uid && !source.avatar) {
      try {
        const avatar = await fetchBilibiliAvatar(source.uid);
        if (avatar) {
          await prisma.source.update({
            where: { id: source.id },
            data: { avatar }
          });
          source.avatar = avatar;
        }
      } catch (error) {
        console.warn(`[GamePulse] Failed to fetch avatar for ${source.name}:`, (error as Error).message);
      }
    }

    await prisma.source.update({
      where: { id: source.id },
      data: {
        healthStatus: 'healthy',
        ...(isSourceBackfill && rawItems.length > 0 ? { firstIngestAt: new Date() } : {}),
        lastSuccessAt: new Date(),
        lastCheckedAt: new Date(),
        lastError: null
      }
    });

    await writeSourceHealthLog(source.id, 'healthy');

    return { newItems: sourceNewCount, failed: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown source error';
    const healthStatus = shouldMarkSourceDegraded(source.lastSuccessAt) ? 'degraded' : 'failed';

    await prisma.source.update({
      where: { id: source.id },
      data: {
        healthStatus,
        lastCheckedAt: new Date(),
        lastError: message.slice(0, 500)
      }
    });

    await writeSourceHealthLog(source.id, healthStatus, message.slice(0, 500));
    io?.emit('source:error', {
      sourceId: source.id,
      sourceName: source.name,
      game: source.game,
      error: message
    });
    console.error(`[GamePulse] source failed: ${source.name}`, error);
    return { newItems: 0, failed: true };
  }
}

async function writeSourceHealthLog(
  sourceId: string,
  status: 'healthy' | 'degraded' | 'failed',
  error?: string
): Promise<void> {
  try {
    await prisma.sourceHealthLog.create({
      data: { sourceId, status, error }
    });
  } catch (err) {
    warnHealthLogUnavailable(err);
  }
}

function shouldMarkSourceDegraded(lastSuccessAt: Date | null): boolean {
  if (!lastSuccessAt) return false;
  const lastSuccessTime = lastSuccessAt.getTime();
  if (!Number.isFinite(lastSuccessTime)) return false;
  return Date.now() - lastSuccessTime <= getSourceDegradedGraceMs();
}

function warnHealthLogUnavailable(error: unknown): void {
  if (healthLogUnavailableWarned) return;
  healthLogUnavailableWarned = true;
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[GamePulse] Source health log unavailable; continuing checks without history. ${message}`);
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  handler: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await handler(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then(value => resolve(value))
      .catch(error => reject(error))
      .finally(() => clearTimeout(timer));
  });
}

function getSourceCheckTimeoutMs(): number {
  const parsed = Number(process.env.SOURCE_CHECK_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed >= 5000 ? parsed : 45000;
}

function getSourceDegradedGraceMs(): number {
  const parsed = Number(process.env.SOURCE_DEGRADED_GRACE_HOURS);
  const hours = Number.isFinite(parsed) && parsed >= 1 ? parsed : 24;
  return hours * 60 * 60 * 1000;
}

function getSourceCheckConcurrency(): number {
  const parsed = Number(process.env.SOURCE_CHECK_CONCURRENCY);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, 6) : 3;
}

export function getCheckerStatus() {
  return { running: checkRunning, startedAt: checkStartedAt?.toISOString() || null };
}
