import type { Server } from 'socket.io';
import { prisma } from '../../db.js';
import { ensureAnalysis } from '../ai/analyzer.js';
import { getAdapter } from '../adapters/registry.js';
import { contentHash, normalizeUrl, truncate } from '../utils.js';
import { sendFeedItemEmail } from '../../services/email.js';
import { fetchBilibiliAvatar } from '../adapters/bilibiliVideo.js';

export interface CheckResult {
  checkedSources: number;
  newItems: number;
  failedSources: number;
}

interface SourceCheckResult {
  newItems: number;
  failed: boolean;
}

export async function runGamePulseCheck(io?: Server): Promise<CheckResult> {
  const sources = await prisma.source.findMany({
    where: { enabled: true },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }]
  });

  const results = await runWithConcurrency(sources, getSourceCheckConcurrency(), source => checkSource(source, io));

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

    for (const raw of rawItems) {
      const hash = contentHash([raw.externalId, normalizeUrl(raw.url), raw.title, raw.publishedAt?.toISOString()]);
      const existing = await prisma.feedItem.findUnique({
        where: {
          sourceId_contentHash: {
            sourceId: source.id,
            contentHash: hash
          }
        }
      });
      if (existing) continue;

      const item = await prisma.feedItem.create({
        data: {
          sourceId: source.id,
          externalId: raw.externalId || raw.url,
          itemKind: raw.itemKind,
          game: source.game,
          title: truncate(raw.title, 500) || 'Untitled',
          content: truncate(raw.content, 5000) || raw.title,
          url: normalizeUrl(raw.url),
          authorName: truncate(raw.authorName || source.name, 120),
          authorUrl: truncate(raw.authorUrl, 500),
          coverUrl: truncate(raw.coverUrl, 1000),
          sourceType: source.type,
          contentHash: hash,
          publishedAt: raw.publishedAt || null
        },
        include: {
          source: true
        }
      });

      sourceNewCount++;

      await prisma.notification.create({
        data: {
          type: 'feed_item',
          title: `发现新情报：${item.title.slice(0, 60)}`,
          content: item.content.slice(0, 120),
          feedItemId: item.id
        }
      });

      io?.to(`game:${item.game}`).emit('item:new', item);
      io?.emit('notification', {
        type: 'feed_item',
        title: item.title,
        content: item.content.slice(0, 120),
        feedItemId: item.id,
        importance: 'pending'
      });

      queueAnalysis(item.id, io);
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
        lastSuccessAt: new Date(),
        lastCheckedAt: new Date(),
        lastError: null
      }
    });

    return { newItems: sourceNewCount, failed: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown source error';
    await prisma.source.update({
      where: { id: source.id },
      data: {
        healthStatus: 'failed',
        lastCheckedAt: new Date(),
        lastError: message.slice(0, 500)
      }
    });
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

function queueAnalysis(itemId: string, io?: Server): void {
  setTimeout(() => {
    void analyzeAndNotify(itemId, io).catch(error => {
      console.error(`[GamePulse] analysis failed for item ${itemId}`, error);
    });
  }, 0);
}

async function analyzeAndNotify(itemId: string, io?: Server): Promise<void> {
  const item = await prisma.feedItem.findUnique({
    where: { id: itemId },
    include: { source: true }
  });
  if (!item) return;

  await ensureAnalysis(item);
  const withAnalysis = await prisma.feedItem.findUnique({
    where: { id: item.id },
    include: { source: true, analysis: true }
  });
  if (!withAnalysis) return;

  io?.to(`game:${withAnalysis.game}`).emit('item:analyzed', withAnalysis);
  io?.emit('notification', {
    type: 'analysis',
    title: withAnalysis.title,
    content: withAnalysis.analysis?.summary || withAnalysis.content.slice(0, 120),
    feedItemId: withAnalysis.id,
    importance: withAnalysis.analysis?.importance || 'low'
  });

  if (['high', 'urgent'].includes(withAnalysis.analysis?.importance || '')) {
    await sendFeedItemEmail(withAnalysis);
  }
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

function getSourceCheckConcurrency(): number {
  const parsed = Number(process.env.SOURCE_CHECK_CONCURRENCY);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, 6) : 3;
}
