import { Prisma } from '@prisma/client';
import type { prisma as prismaClient } from '../db.js';
import { LOW_VALUE_NOTICE_PHRASES } from './routes/helpers.js';
import type { PublicStory } from './storyAggregation.js';

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

type PrismaClientLike = Pick<typeof prismaClient, '$queryRaw'>;

const FOLLOW_CATEGORIES_SET = new Set(['music', 'trailer', 'movie_trailer', 'creator_video']);
const GAME_CATEGORIES_SET = new Set(['announcement', 'event', 'version', 'character', 'pv', 'game_music', 'community', 'other']);
const ANALYZED_STATUSES = ['completed', 'failed'];
const FACET_CACHE_TTL_MS = 60_000;
const FACET_CACHE_LIMIT = 20;

interface StoryFacetGroupRow {
  game: string;
  category: string | null;
  importance: string;
  followed: bigint | number | boolean;
  count: bigint | number;
}

const facetCache = new Map<string, { value: StoryFacets; expiresAt: number }>();
const facetPromises = new Map<string, Promise<StoryFacets>>();

function facetCacheKey(filters: StoryFacetFilters): string {
  return `${filters.followGroup || ''}|${filters.sourceUid || ''}|${filters.visibility || ''}`;
}

function trimFacetCache(): void {
  if (facetCache.size <= FACET_CACHE_LIMIT) return;
  const oldestKey = facetCache.keys().next().value;
  if (oldestKey) facetCache.delete(oldestKey);
}

export async function getStoryFacets(
  prisma: PrismaClientLike,
  filters: StoryFacetFilters
): Promise<StoryFacets> {
  const key = facetCacheKey(filters);
  const cached = facetCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) facetCache.delete(key);

  const pending = facetPromises.get(key);
  if (pending) return pending;

  const promise = queryStoryFacets(prisma, filters)
    .then(value => {
      facetCache.set(key, { value, expiresAt: Date.now() + FACET_CACHE_TTL_MS });
      trimFacetCache();
      return value;
    })
    .finally(() => facetPromises.delete(key));
  facetPromises.set(key, promise);
  return promise;
}

export async function queryStoryFacets(
  prisma: PrismaClientLike,
  filters: StoryFacetFilters
): Promise<StoryFacets> {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`f.hidden = 0`,
    Prisma.sql`a.status IN (${Prisma.join(ANALYZED_STATUSES)})`
  ];

  if (filters.followGroup === 'follow') conditions.push(Prisma.sql`s.followed = ${true}`);
  if (filters.followGroup === 'game') conditions.push(Prisma.sql`s.followed = ${false}`);
  if (filters.sourceUid) conditions.push(Prisma.sql`s.uid = ${filters.sourceUid}`);
  if (filters.visibility !== 'muted' && filters.visibility !== 'all') {
    conditions.push(Prisma.sql`a.category <> 'enforcement'`);
    for (const phrase of LOW_VALUE_NOTICE_PHRASES) {
      const pattern = `%${phrase}%`;
      conditions.push(Prisma.sql`f.title NOT LIKE ${pattern} AND f.content NOT LIKE ${pattern}`);
    }
  }

  const rows = await prisma.$queryRaw<StoryFacetGroupRow[]>(Prisma.sql`
    SELECT f.game, a.category, a.importance, s.followed, COUNT(*) AS count
    FROM Analysis a
    INNER JOIN FeedItem f ON f.id = a.feedItemId
    INNER JOIN Source s ON s.id = f.sourceId
    WHERE ${Prisma.join(conditions, ' AND ')}
    GROUP BY f.game, a.category, a.importance, s.followed
  `);

  const byGame: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const byFollowCategory: Record<string, number> = {};
  const byImportance: Record<string, number> = {};

  for (const row of rows) {
    const count = Number(row.count);
    const followed = Boolean(Number(row.followed));
    const category = row.category || 'other';
    const importance = row.importance === 'urgent' ? 'high' : row.importance || 'low';
    if (!followed) {
      byGame[row.game] = (byGame[row.game] || 0) + count;
      if (GAME_CATEGORIES_SET.has(category)) byCategory[category] = (byCategory[category] || 0) + count;
    } else if (FOLLOW_CATEGORIES_SET.has(category)) {
      byFollowCategory[category] = (byFollowCategory[category] || 0) + count;
    }
    byImportance[importance] = (byImportance[importance] || 0) + count;
  }

  return {
    byGame,
    byCategory,
    byFollowCategory,
    byImportance
  };
}

export function resetStoryFacetCache(): void {
  facetCache.clear();
  facetPromises.clear();
}

/**
 * Compute facets directly from aggregated stories (post-dedup).
 * This ensures facet counts match the actual story list displayed to users.
 */
export function computeStoryFacetsFromStories(stories: PublicStory[]): StoryFacets {
  const byGame: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const byFollowCategory: Record<string, number> = {};
  const byImportance: Record<string, number> = {};

  const FOLLOW_CATEGORIES = new Set(['music', 'trailer', 'movie_trailer', 'creator_video']);

  for (const story of stories) {
    // Game counts
    const game = story.game || '其他';
    byGame[game] = (byGame[game] || 0) + 1;

    // Category counts: split into game vs follow based on category type
    const cat = story.category || 'other';
    if (FOLLOW_CATEGORIES.has(cat)) {
      byFollowCategory[cat] = (byFollowCategory[cat] || 0) + 1;
    } else {
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    }

    // Importance counts
    const imp = story.importance || 'low';
    byImportance[imp] = (byImportance[imp] || 0) + 1;
  }

  return { byGame, byCategory, byFollowCategory, byImportance };
}
