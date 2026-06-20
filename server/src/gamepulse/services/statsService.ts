import { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import { getStatsCacheTtlMs } from '../config.js';
import { andWhere, publicVisibilityWhere } from '../routes/helpers.js';

const GAME_INTELLIGENCE_CATEGORIES = new Set(['announcement', 'event', 'version', 'character', 'pv', 'game_music', 'community', 'other']);
const FOLLOW_CATEGORIES = new Set(['music', 'trailer', 'movie_trailer', 'creator_video']);

export interface AnalysisGroupRow {
  category: string | null;
  importance: string;
  followed: bigint | number;
  count: bigint | number;
}

export interface PublicStatsResult {
  total: number;
  today: number;
  high: number;
  byGame: Record<string, number>;
  byKind: Record<string, number>;
  sourceHealth: Record<string, number>;
  hourlyTrend: Array<{ hour: string; count: number }>;
  byCategory: Record<string, number>;
  byFollowCategory: Record<string, number>;
  byImportance: Record<string, number>;
}

let cachedStats: { value: PublicStatsResult; expiresAt: number } | null = null;
let statsPromise: Promise<PublicStatsResult> | null = null;

export function buildHourlyTrend(createdAtValues: Date[], now = new Date()): Array<{ hour: string; count: number }> {
  const firstHour = new Date(now);
  firstHour.setHours(now.getHours() - 23, 0, 0, 0);
  const counts = new Array<number>(24).fill(0);

  for (const createdAt of createdAtValues) {
    const index = Math.floor((createdAt.getTime() - firstHour.getTime()) / (60 * 60 * 1000));
    if (index >= 0 && index < counts.length) counts[index]++;
  }

  return counts.map((count, index) => {
    const hour = new Date(firstHour);
    hour.setHours(firstHour.getHours() + index);
    return {
      hour: hour.toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      count,
    };
  });
}

export function buildAnalysisBreakdown(rows: AnalysisGroupRow[]) {
  const byCategory: Record<string, number> = {};
  const byFollowCategory: Record<string, number> = {};
  const byImportance: Record<string, number> = {};

  for (const row of rows) {
    const category = row.category || 'other';
    const count = Number(row.count);
    const isFollow = Boolean(Number(row.followed));
    if (isFollow && FOLLOW_CATEGORIES.has(category)) {
      byFollowCategory[category] = (byFollowCategory[category] || 0) + count;
    } else if (!isFollow && GAME_INTELLIGENCE_CATEGORIES.has(category)) {
      byCategory[category] = (byCategory[category] || 0) + count;
    }
    const importance = row.importance === 'urgent' ? 'high' : row.importance || 'low';
    byImportance[importance] = (byImportance[importance] || 0) + count;
  }

  return { byCategory, byFollowCategory, byImportance };
}

async function computePublicStats(now = new Date()): Promise<PublicStatsResult> {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const firstTrendHour = new Date(now);
  firstTrendHour.setHours(now.getHours() - 23, 0, 0, 0);
  const publicWhere = publicVisibilityWhere();

  const [total, todayCount, highCount, byGame, byKind, sourceHealth, analysisGroups, recentItems] = await Promise.all([
    prisma.feedItem.count({ where: publicWhere }),
    prisma.feedItem.count({ where: andWhere(publicWhere, { createdAt: { gte: today } }) }),
    prisma.feedItem.count({
      where: andWhere(publicWhere, { analysis: { is: { importance: { in: ['high', 'urgent'] } } } }),
    }),
    prisma.feedItem.groupBy({ by: ['game'], where: publicWhere, _count: { game: true } }),
    prisma.feedItem.groupBy({ by: ['itemKind'], where: publicWhere, _count: { itemKind: true } }),
    prisma.source.groupBy({ by: ['healthStatus'], where: { enabled: true }, _count: { healthStatus: true } }),
    prisma.$queryRaw<AnalysisGroupRow[]>(Prisma.sql`
      SELECT a.category, a.importance, s.followed, COUNT(*) AS count
      FROM Analysis a
      INNER JOIN FeedItem f ON f.id = a.feedItemId
      INNER JOIN Source s ON s.id = f.sourceId
      WHERE a.status = 'completed'
      GROUP BY a.category, a.importance, s.followed
    `),
    prisma.feedItem.findMany({
      where: andWhere(publicWhere, { createdAt: { gte: firstTrendHour } }),
      select: { createdAt: true },
    }),
  ]);

  const breakdown = buildAnalysisBreakdown(analysisGroups);
  return {
    total,
    today: todayCount,
    high: highCount,
    byGame: Object.fromEntries(byGame.map(item => [item.game, item._count.game])),
    byKind: Object.fromEntries(byKind.map(item => [item.itemKind, item._count.itemKind])),
    sourceHealth: Object.fromEntries(sourceHealth.map(item => [item.healthStatus, item._count.healthStatus])),
    hourlyTrend: buildHourlyTrend(recentItems.map(item => item.createdAt), now),
    ...breakdown,
  };
}

export async function getPublicStats(): Promise<PublicStatsResult> {
  const now = Date.now();
  if (cachedStats && cachedStats.expiresAt > now) return cachedStats.value;
  if (statsPromise) return statsPromise;

  statsPromise = computePublicStats().then(value => {
    cachedStats = { value, expiresAt: Date.now() + getStatsCacheTtlMs() };
    return value;
  }).finally(() => {
    statsPromise = null;
  });
  return statsPromise;
}

export function invalidatePublicStatsCache(): void {
  cachedStats = null;
}
