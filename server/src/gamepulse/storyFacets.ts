import type { Prisma } from '@prisma/client';
import type { prisma as prismaClient } from '../db.js';
import { appendAnd, lowValueNoticeExclusionWhere } from './routes/helpers.js';
import type { PrismaWhereClause } from './types.js';

export interface StoryFacets {
  byGame: Record<string, number>;
  byCategory: Record<string, number>;
  byFollowCategory: Record<string, number>;
  byImportance: Record<string, number>;
}

interface StoryFacetFilters {
  followGroup?: string;
  sourceUid?: string;
  visibility?: string;
}

type PrismaClientLike = Pick<typeof prismaClient, 'feedItem' | 'analysis'>;

const FOLLOW_CATEGORIES_SET = new Set(['music', 'trailer', 'movie_trailer', 'creator_video']);
const GAME_CATEGORIES_SET = new Set(['announcement', 'event', 'version', 'character', 'pv', 'game_music', 'community', 'other']);
const ANALYZED_STATUSES = ['completed', 'failed'];

export function buildStoryFacetFeedItemWhere(filters: StoryFacetFilters): PrismaWhereClause {
  const where: PrismaWhereClause = { hidden: false };

  if (filters.followGroup === 'follow') {
    appendAnd(where, { source: { is: { followed: true } } });
  } else if (filters.followGroup === 'game') {
    appendAnd(where, { source: { is: { followed: false } } });
  }

  if (filters.sourceUid) {
    appendAnd(where, { source: { is: { uid: filters.sourceUid } } });
  }

  if (filters.visibility !== 'muted' && filters.visibility !== 'all') {
    appendAnd(where, lowValueNoticeExclusionWhere());
  }

  return where;
}

export async function computeStoryFacets(
  prisma: PrismaClientLike,
  filters: StoryFacetFilters
): Promise<StoryFacets> {
  const baseFeedItemWhere = buildStoryFacetFeedItemWhere(filters);
  const statusWhere = { analysis: { is: { status: { in: ANALYZED_STATUSES } } } };

  const byGameWhere = withAnd(baseFeedItemWhere, [
    statusWhere,
    { source: { is: { followed: false } } }
  ]);
  const gameCategoryWhere = buildAnalysisFacetWhere(baseFeedItemWhere, false, filters.visibility);
  const followCategoryWhere = buildAnalysisFacetWhere(baseFeedItemWhere, true, filters.visibility);
  const importanceWhere = buildAnalysisFacetWhere(baseFeedItemWhere, undefined, filters.visibility);

  const [gameRows, gameCategoryRows, followCategoryRows, importanceRows] = await Promise.all([
    prisma.feedItem.groupBy({
      by: ['game'],
      where: byGameWhere as Prisma.FeedItemWhereInput,
      _count: { _all: true }
    }),
    prisma.analysis.groupBy({
      by: ['category'],
      where: gameCategoryWhere as Prisma.AnalysisWhereInput,
      _count: { _all: true }
    }),
    prisma.analysis.groupBy({
      by: ['category'],
      where: followCategoryWhere as Prisma.AnalysisWhereInput,
      _count: { _all: true }
    }),
    prisma.analysis.groupBy({
      by: ['importance'],
      where: importanceWhere as Prisma.AnalysisWhereInput,
      _count: { _all: true }
    })
  ]);

  return {
    byGame: Object.fromEntries(gameRows.map(row => [row.game, row._count._all])),
    byCategory: categoryRowsToRecord(gameCategoryRows, GAME_CATEGORIES_SET),
    byFollowCategory: categoryRowsToRecord(followCategoryRows, FOLLOW_CATEGORIES_SET),
    byImportance: importanceRowsToRecord(importanceRows)
  };
}

function buildAnalysisFacetWhere(
  feedItemWhere: PrismaWhereClause,
  followed: boolean | undefined,
  visibility?: string
): PrismaWhereClause {
  const where: PrismaWhereClause = {
    status: { in: ANALYZED_STATUSES },
    feedItem: {
      is: followed === undefined
        ? feedItemWhere
        : withAnd(feedItemWhere, [{ source: { is: { followed } } }])
    }
  };

  if (visibility !== 'muted' && visibility !== 'all') {
    appendAnd(where, { category: { not: 'enforcement' } });
  }

  return where;
}

function withAnd(where: PrismaWhereClause, conditions: PrismaWhereClause[]): PrismaWhereClause {
  return {
    ...where,
    AND: [...(where.AND || []), ...conditions]
  };
}

function categoryRowsToRecord(
  rows: Array<{ category: string | null; _count: { _all: number } }>,
  allowed: Set<string>
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const category = row.category || 'other';
    if (!allowed.has(category)) continue;
    counts[category] = (counts[category] || 0) + row._count._all;
  }
  return counts;
}

function importanceRowsToRecord(
  rows: Array<{ importance: string; _count: { _all: number } }>
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const importance = row.importance === 'urgent' ? 'high' : row.importance || 'low';
    counts[importance] = (counts[importance] || 0) + row._count._all;
  }
  return counts;
}
