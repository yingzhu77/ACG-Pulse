/**
 * Database operations for community topics.
 * Handles persistence, trend tracking, and cleanup.
 */

import { prisma } from '../../db.js';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { COMMUNITY_REFRESH_INTERVAL_MS, COMMUNITY_SOURCES, type CommunitySource, type CommunitySourceHealth, type CommunitySourceResult, type CommunityTopic } from '../community/types.js';
import { normalizeCommunityTopicUrl } from '../communityUrls.js';

const VALID_SENTIMENTS = new Set(['positive', 'negative', 'neutral', 'unknown']);
const SOURCE_HEALTH_KEY = 'COMMUNITY_SOURCE_HEALTH';
const SourceHealthSchema = z.array(z.object({
  source: z.enum(COMMUNITY_SOURCES),
  status: z.enum(['healthy', 'degraded', 'failed']),
  error: z.string().optional(),
  checkedAt: z.number().nonnegative(),
  lastSuccessAt: z.number().nonnegative().nullable()
}));
type CommunityPersistenceClient = Pick<Prisma.TransactionClient, 'communityTopic' | 'setting'>;

function safeParseTrend(raw: string, id: string): number[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    console.warn(`[CommunityDB] Corrupted trend data for topic ${id}, resetting to []`);
    return [];
  }
}

function safeSentiment(raw: string): CommunityTopic['sentiment'] {
  return VALID_SENTIMENTS.has(raw) ? (raw as CommunityTopic['sentiment']) : 'unknown';
}

export type CommunityTopicSort = 'heat' | 'latest';

export interface CommunityTopicPageOptions {
  sentiment?: string;
  category?: string;
  source?: string;
  page: number;
  limit: number;
  sort: CommunityTopicSort;
}

export async function loadTopicPage(options: CommunityTopicPageOptions) {
  const where: Prisma.CommunityTopicWhereInput = {};
  if (options.sentiment) {
    where.sentiment = options.sentiment;
    where.sentimentStatus = 'completed';
  }
  if (options.category) where.category = options.category;
  if (options.source) where.source = options.source;

  const orderBy: Prisma.CommunityTopicOrderByWithRelationInput[] = options.sort === 'latest'
    ? [{ publishedAt: 'desc' }, { id: 'desc' }]
    : [{ heatScore: 'desc' }, { publishedAt: 'desc' }, { id: 'desc' }];

  const [rows, total, sentimentGroups, heatAggregate] = await Promise.all([
    prisma.communityTopic.findMany({
      where,
      orderBy,
      skip: (options.page - 1) * options.limit,
      take: options.limit
    }),
    prisma.communityTopic.count({ where }),
    prisma.communityTopic.groupBy({
      by: ['sentiment', 'sentimentStatus'],
      where,
      _count: { _all: true }
    }),
    prisma.communityTopic.aggregate({ where, _avg: { heatScore: true } })
  ]);

  const sentimentCounts = { positive: 0, negative: 0, neutral: 0, unknown: 0 };
  for (const group of sentimentGroups) {
    if (group.sentimentStatus !== 'completed') {
      sentimentCounts.unknown += group._count._all;
    } else if (group.sentiment in sentimentCounts) {
      sentimentCounts[group.sentiment as keyof typeof sentimentCounts] = group._count._all;
    }
  }

  return {
    topics: rows.map(rowToTopic),
    total,
    sentimentCounts,
    avgHeat: Math.round(heatAggregate._avg.heatScore ?? 0)
  };
}

/** Load all topics (for summary computation) */
export async function loadAllTopics(): Promise<CommunityTopic[]> {
  const rows = await prisma.communityTopic.findMany({
    orderBy: { heatScore: 'desc' }
  });
  return rows.map(rowToTopic);
}

/** Upsert topics: insert new ones, update existing ones' trend/heat */
export async function upsertTopics(topics: CommunityTopic[], client: CommunityPersistenceClient = prisma): Promise<void> {
  if (topics.length === 0) return;
  const now = new Date();

  // Batch fetch existing topics (1 query instead of N)
  const topicIds = topics.map(t => t.id);
  const existingRows = await client.communityTopic.findMany({
    where: { id: { in: topicIds } },
    select: {
      id: true,
      trend: true,
      rawHeatTrend: true,
      sentiment: true,
      sentimentScore: true,
      sentimentStatus: true,
      sentimentMethod: true,
      sentimentConfidence: true,
      sentimentVersion: true,
      sentimentAnalyzedAt: true
    }
  });
  const existingMap = new Map(existingRows.map(r => [r.id, r]));

  const toCreate: CommunityTopic[] = [];
  const toUpdate: { topic: CommunityTopic; existing: typeof existingRows[0] }[] = [];

  for (const topic of topics) {
    const existing = existingMap.get(topic.id);
    if (existing) {
      toUpdate.push({ topic, existing });
    } else {
      toCreate.push(topic);
    }
  }

  // Batch insert new topics
  if (toCreate.length > 0) {
    try {
      await client.communityTopic.createMany({
        data: toCreate.map(topic => topicCreateData(topic, now))
      });
    } catch (err) {
      if (!isUniqueConstraintError(err)) throw err;
      console.warn('[CommunityDB] Concurrent topic insert; retrying topics individually');
      for (const topic of toCreate) {
        try {
          await client.communityTopic.create({
            data: topicCreateData(topic, now)
          });
        } catch (itemError) {
          if (isUniqueConstraintError(itemError)) continue;
          throw itemError;
        }
      }
    }
  }

  // Update existing topics (individual updates needed for trend merge)
  for (const { topic, existing } of toUpdate) {
    const oldTrend = safeParseTrend(existing.trend, topic.id);
    const oldRawHeatTrend = safeParseTrend(existing.rawHeatTrend, topic.id);
    const mergedTrend = [...oldTrend, topic.heatScore].slice(-24);
    const mergedRawHeatTrend = [...oldRawHeatTrend, topic.rawHeatScore].slice(-24);

    const updateData: Record<string, unknown> = {
      heatScore: topic.heatScore,
      rawHeatScore: topic.rawHeatScore,
      trend: JSON.stringify(mergedTrend),
      rawHeatTrend: JSON.stringify(mergedRawHeatTrend),
      summary: topic.summary,
      url: topic.url,
      fetchedAt: now,
      lastSeenAt: now
    };
    updateData.sentiment = topic.sentiment;
    updateData.sentimentScore = topic.sentimentScore;
    updateData.sentimentStatus = topic.sentimentStatus;
    updateData.sentimentMethod = topic.sentimentMethod;
    updateData.sentimentConfidence = topic.sentimentConfidence;
    updateData.sentimentVersion = topic.sentimentVersion;
    updateData.sentimentAnalyzedAt = topic.sentimentAnalyzedAt
      ? new Date(topic.sentimentAnalyzedAt)
      : null;

    await client.communityTopic.update({
      where: { id: topic.id },
      data: updateData
    });
  }
}

function topicCreateData(topic: CommunityTopic, now: Date) {
  return {
    id: topic.id,
    title: topic.title,
    sentiment: topic.sentiment,
    sentimentScore: topic.sentimentScore,
    sentimentStatus: topic.sentimentStatus,
    sentimentMethod: topic.sentimentMethod,
    sentimentConfidence: topic.sentimentConfidence,
    sentimentVersion: topic.sentimentVersion,
    sentimentAnalyzedAt: topic.sentimentAnalyzedAt ? new Date(topic.sentimentAnalyzedAt) : null,
    heatScore: topic.heatScore,
    rawHeatScore: topic.rawHeatScore,
    category: topic.category,
    source: topic.source,
    trend: JSON.stringify(topic.trend.length > 0 ? topic.trend : [topic.heatScore]),
    rawHeatTrend: JSON.stringify(topic.rawHeatTrend.length > 0 ? topic.rawHeatTrend : [topic.rawHeatScore]),
    summary: topic.summary,
    url: topic.url,
    publishedAt: new Date(topic.publishedAt),
    fetchedAt: now,
    lastSeenAt: now
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'P2002';
}

/** Delete topics not seen in the last N hours */
export async function cleanupStale(maxAgeHours = 48, sources?: CommunitySource[]): Promise<number> {
  if (sources?.length === 0) return 0;
  const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
  const result = await prisma.communityTopic.deleteMany({
    where: { lastSeenAt: { lt: cutoff }, ...(sources ? { source: { in: sources } } : {}) }
  });
  return result.count;
}

/** Get the latest fetchedAt timestamp */
export async function getLastFetchTime(): Promise<number> {
  return (await getStalenessInfo()).lastFetchTime;
}

async function loadSourceHealth(client: CommunityPersistenceClient = prisma): Promise<CommunitySourceHealth[] | null> {
  const setting = await client.setting.findUnique({ where: { key: SOURCE_HEALTH_KEY } });
  return setting ? SourceHealthSchema.parse(JSON.parse(setting.value)) : null;
}

/** Successful empty responses also advance freshness; failed sources keep their last success. */
export async function recordCommunitySourceResults(results: CommunitySourceResult[], client: CommunityPersistenceClient = prisma): Promise<void> {
  const previous = await loadSourceHealth(client);
  const now = Date.now();
  const health: CommunitySourceHealth[] = [];
  for (const result of results) {
    let lastSuccessAt = previous?.find(source => source.source === result.source)?.lastSuccessAt ?? null;
    if (result.status !== 'failed') {
      lastSuccessAt = now;
    } else if (!previous) {
      const legacy = await client.communityTopic.findFirst({
        where: { source: result.source }, orderBy: { fetchedAt: 'desc' }, select: { fetchedAt: true }
      });
      lastSuccessAt = legacy?.fetchedAt.getTime() ?? null;
    }
    health.push({ ...result, checkedAt: now, lastSuccessAt });
  }
  const value = JSON.stringify(health);
  await client.setting.upsert({
    where: { key: SOURCE_HEALTH_KEY }, create: { key: SOURCE_HEALTH_KEY, value }, update: { value }
  });
}

/** Keep topic timestamps and source health in the same commit. Fetching/AI happens before this transaction. */
export async function persistCommunityRefresh(topics: CommunityTopic[], sources: CommunitySourceResult[]): Promise<void> {
  await prisma.$transaction(async tx => {
    await upsertTopics(topics, tx);
    await recordCommunitySourceResults(sources, tx);
  });
}

export interface StalenessInfo {
  hasData: boolean;
  isStale: boolean;
  refreshDue: boolean;
  lastFetchTime: number;
}

/** Check if data exists and whether it is stale (beyond TTL) */
export async function getStalenessInfo(source?: CommunitySource): Promise<StalenessInfo> {
  const [latest, health] = await Promise.all([
    prisma.communityTopic.findFirst({
      ...(source ? { where: { source } } : {}),
      orderBy: { fetchedAt: 'desc' }, select: { fetchedAt: true }
    }),
    loadSourceHealth()
  ]);
  if (health) {
    const relevant = (source ? [source] : COMMUNITY_SOURCES).map(name => health.find(result => result.source === name));
    const lastFetchTime = Math.min(...relevant.map(result => result?.lastSuccessAt ?? 0));
    const isStale = relevant.some(result => !result || result.status === 'failed')
      || !lastFetchTime || Date.now() - lastFetchTime >= COMMUNITY_REFRESH_INTERVAL_MS;
    const refreshDue = relevant.some(result => !result || Date.now() - result.checkedAt >= COMMUNITY_REFRESH_INTERVAL_MS);
    return { hasData: Boolean(latest), isStale: Boolean(isStale), refreshDue, lastFetchTime };
  }
  // Existing installations keep their topic-derived timestamp until their first recorded refresh.
  if (!latest) return { hasData: false, isStale: true, refreshDue: true, lastFetchTime: 0 };
  const lastFetchTime = latest.fetchedAt.getTime();
  const isStale = Date.now() - lastFetchTime >= COMMUNITY_REFRESH_INTERVAL_MS;
  return { hasData: true, isStale, refreshDue: isStale, lastFetchTime };
}

/** Get IDs of topics already in DB (for incremental update) */
export async function getExistingIds(ids: string[]): Promise<Set<string>> {
  const rows = await prisma.communityTopic.findMany({
    where: { id: { in: ids } },
    select: { id: true }
  });
  return new Set(rows.map(r => r.id));
}

function rowToTopic(row: {
  id: string;
  title: string;
  sentiment: string;
  sentimentScore: number;
  sentimentStatus: string;
  sentimentMethod: string;
  sentimentConfidence: number;
  sentimentVersion: string | null;
  sentimentAnalyzedAt: Date | null;
  heatScore: number;
  rawHeatScore?: number | null;
  category: string;
  source: string;
  trend: string;
  rawHeatTrend?: string | null;
  summary: string;
  url: string;
  publishedAt: Date;
}): CommunityTopic {
  const sentimentStatus = safeSentimentStatus(row.sentimentStatus);
  const rawHeatTrend = row.rawHeatTrend ? safeParseTrend(row.rawHeatTrend, row.id) : [];
  const rawHeatScore = row.rawHeatScore ?? (rawHeatTrend.length > 0 ? rawHeatTrend[rawHeatTrend.length - 1] : row.heatScore);
  return {
    id: row.id,
    title: row.title,
    sentiment: sentimentStatus === 'completed' ? safeSentiment(row.sentiment) : 'unknown',
    sentimentScore: row.sentimentScore,
    sentimentStatus,
    sentimentMethod: safeSentimentMethod(row.sentimentMethod),
    sentimentConfidence: Math.max(0, Math.min(1, row.sentimentConfidence)),
    sentimentVersion: row.sentimentVersion,
    sentimentAnalyzedAt: row.sentimentAnalyzedAt?.toISOString() || null,
    heatScore: row.heatScore,
    rawHeatScore,
    category: row.category,
    source: row.source,
    trend: safeParseTrend(row.trend, row.id),
    rawHeatTrend,
    summary: row.summary,
    url: normalizeCommunityTopicUrl(row),
    publishedAt: row.publishedAt.toISOString()
  };
}

function safeSentimentStatus(raw: string): CommunityTopic['sentimentStatus'] {
  return ['completed', 'failed', 'unavailable', 'legacy'].includes(raw)
    ? raw as CommunityTopic['sentimentStatus']
    : 'legacy';
}

function safeSentimentMethod(raw: string): CommunityTopic['sentimentMethod'] {
  return ['ai', 'keyword', 'none'].includes(raw)
    ? raw as CommunityTopic['sentimentMethod']
    : 'none';
}
