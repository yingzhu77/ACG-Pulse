/**
 * Database operations for community topics.
 * Handles persistence, trend tracking, and cleanup.
 */

import { prisma } from '../../db.js';
import type { CommunityTopic } from '../adapters/community.js';

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const VALID_SENTIMENTS = new Set(['positive', 'negative', 'neutral']);

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
  return VALID_SENTIMENTS.has(raw) ? (raw as CommunityTopic['sentiment']) : 'neutral';
}

/** Check if DB has data fresher than TTL */
export async function hasRecentData(): Promise<boolean> {
  const latest = await prisma.communityTopic.findFirst({
    orderBy: { fetchedAt: 'desc' },
    select: { fetchedAt: true }
  });
  if (!latest) return false;
  return Date.now() - latest.fetchedAt.getTime() < CACHE_TTL_MS;
}

/** Load topics from DB with optional filters */
export async function loadTopics(filters?: {
  sentiment?: string;
  category?: string;
  source?: string;
}): Promise<CommunityTopic[]> {
  const where: { sentiment?: string; category?: string; source?: string } = {};
  if (filters?.sentiment && filters.sentiment !== 'all') where.sentiment = filters.sentiment;
  if (filters?.category && filters.category !== 'all') where.category = filters.category;
  if (filters?.source && filters.source !== 'all') where.source = filters.source;

  const rows = await prisma.communityTopic.findMany({
    where,
    orderBy: { heatScore: 'desc' }
  });

  return rows.map(rowToTopic);
}

/** Load all topics (for summary computation) */
export async function loadAllTopics(): Promise<CommunityTopic[]> {
  const rows = await prisma.communityTopic.findMany({
    orderBy: { heatScore: 'desc' }
  });
  return rows.map(rowToTopic);
}

/** Upsert topics: insert new ones, update existing ones' trend/heat */
export async function upsertTopics(topics: CommunityTopic[]): Promise<void> {
  if (topics.length === 0) return;
  const now = new Date();

  // Batch fetch existing topics (1 query instead of N)
  const topicIds = topics.map(t => t.id);
  const existingRows = await prisma.communityTopic.findMany({
    where: { id: { in: topicIds } },
    select: { id: true, trend: true, sentiment: true, sentimentScore: true }
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
      await prisma.communityTopic.createMany({
        data: toCreate.map(topic => topicCreateData(topic, now))
      });
    } catch (err) {
      console.warn('[CommunityDB] Batch create failed; retrying topics individually:', err);
      for (const topic of toCreate) {
        try {
          await prisma.communityTopic.create({
            data: topicCreateData(topic, now)
          });
        } catch (itemError) {
          if (isUniqueConstraintError(itemError)) continue;
          console.error(`[CommunityDB] Failed to create topic ${topic.id}:`, itemError);
        }
      }
    }
  }

  // Update existing topics (individual updates needed for trend merge)
  for (const { topic, existing } of toUpdate) {
    try {
      const oldTrend = safeParseTrend(existing.trend, topic.id);
      const mergedTrend = [...oldTrend, ...topic.trend].slice(-24);

      const updateData: Record<string, unknown> = {
        heatScore: topic.heatScore,
        trend: JSON.stringify(mergedTrend),
        summary: topic.summary,
        lastSeenAt: now
      };
      // Only overwrite sentiment if the new value is a real analysis (not the placeholder)
      if (topic.sentiment !== 'neutral' || topic.sentimentScore !== 0) {
        updateData.sentiment = topic.sentiment;
        updateData.sentimentScore = topic.sentimentScore;
      }

      await prisma.communityTopic.update({
        where: { id: topic.id },
        data: updateData
      });
    } catch (err) {
      console.error(`[CommunityDB] Failed to update topic ${topic.id}:`, err);
    }
  }
}

function topicCreateData(topic: CommunityTopic, now: Date) {
  return {
    id: topic.id,
    title: topic.title,
    sentiment: topic.sentiment,
    sentimentScore: topic.sentimentScore,
    heatScore: topic.heatScore,
    category: topic.category,
    source: topic.source,
    trend: JSON.stringify(topic.trend),
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
export async function cleanupStale(maxAgeHours = 48): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
  const result = await prisma.communityTopic.deleteMany({
    where: { lastSeenAt: { lt: cutoff } }
  });
  return result.count;
}

/** Get the latest fetchedAt timestamp */
export async function getLastFetchTime(): Promise<number> {
  const latest = await prisma.communityTopic.findFirst({
    orderBy: { fetchedAt: 'desc' },
    select: { fetchedAt: true }
  });
  return latest?.fetchedAt.getTime() ?? 0;
}

export interface StalenessInfo {
  hasData: boolean;
  isStale: boolean;
  lastFetchTime: number;
}

/** Check if data exists and whether it is stale (beyond TTL) */
export async function getStalenessInfo(): Promise<StalenessInfo> {
  const latest = await prisma.communityTopic.findFirst({
    orderBy: { fetchedAt: 'desc' },
    select: { fetchedAt: true }
  });
  if (!latest) return { hasData: false, isStale: true, lastFetchTime: 0 };
  const lastFetchTime = latest.fetchedAt.getTime();
  const isStale = Date.now() - lastFetchTime >= CACHE_TTL_MS;
  return { hasData: true, isStale, lastFetchTime };
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
  heatScore: number;
  category: string;
  source: string;
  trend: string;
  summary: string;
  url: string;
  publishedAt: Date;
}): CommunityTopic {
  return {
    id: row.id,
    title: row.title,
    sentiment: safeSentiment(row.sentiment),
    sentimentScore: row.sentimentScore,
    heatScore: row.heatScore,
    category: row.category,
    source: row.source,
    trend: safeParseTrend(row.trend, row.id),
    summary: row.summary,
    url: row.url,
    publishedAt: row.publishedAt.toISOString()
  };
}
