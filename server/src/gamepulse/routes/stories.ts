import { Router } from 'express';
import { prisma } from '../../db.js';
import { aggregateFeedItemsToStories, toPublicFeedItem } from '../storyAggregation.js';
import { normalizeImportance } from '../storyAggregation.js';
import { getStoryFacets } from '../storyFacets.js';
import type { PrismaWhereClause } from '../types.js';
import {
  toArray,
  appendAnd,
  applyAnalysisFilters,
  applyLowValueNoticeFilter
} from './helpers.js';
import {
  PublicItemsQuerySchema,
  PublicStoriesQuerySchema,
  validateOrThrow
} from '../validation.js';
import { searchFeedItems, isFTS5Ready } from '../search.js';

const router = Router();

// Stories 聚合缓存：相同查询条件 60s 内直接返回缓存结果
const storiesCache = new Map<string, { data: unknown; expires: number }>();
const STORIES_CACHE_TTL = 60_000;
const STORIES_CANDIDATE_LIMIT = 500;

function getStoriesCacheKey(params: Record<string, unknown>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : v}`)
    .join('&');
}

function getCachedStories(key: string): unknown | null {
  const entry = storiesCache.get(key);
  if (entry && Date.now() < entry.expires) return entry.data;
  if (entry) storiesCache.delete(key);
  return null;
}

function setCachedStories(key: string, data: unknown): void {
  storiesCache.set(key, { data, expires: Date.now() + STORIES_CACHE_TTL });
  // 防止缓存无限增长
  if (storiesCache.size > 100) {
    const oldest = storiesCache.keys().next().value;
    if (oldest) storiesCache.delete(oldest);
  }
}

/**
 * GET /items - 获取公开情报列表
 */
router.get('/items', async (req, res) => {
  try {
    const {
      page,
      limit,
      game,
      sourceId,
      itemKind,
      category,
      importance,
      visibility,
      official,
      q
    } = validateOrThrow(PublicItemsQuerySchema, req.query, 'items query');

    const pageNum = page;
    const limitNum = limit;
    const where: PrismaWhereClause = { hidden: false };

    if (game) where.game = String(game);
    if (sourceId) where.sourceId = String(sourceId);
    if (itemKind) where.itemKind = String(itemKind);
    if (official !== undefined && official !== '') {
      where.source = { isOfficial: String(official) === 'true' };
    }

    // FTS5 search: use FTS if available, fallback to LIKE
    const FTS_RECALL_LIMIT = 10000;
    let ftsIds: string[] | null = null;
    if (q) {
      const ftsReady = await isFTS5Ready();
      if (ftsReady) {
        const ftsResult = await searchFeedItems(String(q), { limit: FTS_RECALL_LIMIT, offset: 0 });
        ftsIds = ftsResult.feedItemIds;
        if (ftsIds.length === 0) {
          // FTS returned no results, return empty
          res.json({ data: [], pagination: { page: pageNum, limit: limitNum, total: 0, totalPages: 0 } });
          return;
        }
        where.id = { in: ftsIds };
      } else {
        // Fallback to LIKE
        where.OR = [
          { title: { contains: String(q) } },
          { content: { contains: String(q) } },
          { authorName: { contains: String(q) } }
        ];
      }
    }

    applyAnalysisFilters(where, { category, importance, visibility });
    applyLowValueNoticeFilter(where, visibility);

    const [data, prismaTotal] = await Promise.all([
      prisma.feedItem.findMany({
        where,
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        include: {
          source: {
            select: {
              id: true,
              name: true,
              type: true,
              game: true,
              isOfficial: true,
              healthStatus: true
            }
          },
          analysis: true
        }
      }),
      prisma.feedItem.count({ where })
    ]);

    // Prisma count is accurate for the filtered result set (bounded by FTS_RECALL_LIMIT).
    const total = prismaTotal;

    res.json({
      data: data.map(toPublicFeedItem),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Game Pulse public items failed:', error);
    if (error instanceof Error && error.message.startsWith('Validation failed')) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

/**
 * GET /stories - 获取聚合故事列表
 */
router.get('/stories', async (req, res) => {
  try {
    const {
      page,
      limit,
      game,
      sourceId,
      itemKind,
      category,
      importance,
      visibility,
      official,
      q,
      followGroup,
      sourceUid,
      includeFacets
    } = validateOrThrow(PublicStoriesQuerySchema, req.query, 'stories query');

    const pageNum = page;
    const limitNum = limit;
    const gameArr = toArray(game);
    const categoryArr = toArray(category);
    const importanceArr = toArray(importance);
    const sourceUidArr = toArray(sourceUid);
    const group = followGroup ? String(followGroup) : '';

    // 检查缓存（仅第 1 页且无搜索词时缓存，搜索结果不缓存）
    const cacheKey = getStoriesCacheKey({ page, limit, game, sourceId, itemKind, category, importance, visibility, official, followGroup, sourceUid, includeFacets });
    if (pageNum === 1 && !q) {
      const cached = getCachedStories(cacheKey);
      if (cached) {
        res.json(cached);
        return;
      }
    }

    // Build WHERE
    const where: PrismaWhereClause = { hidden: false };
    if (gameArr.length === 1) where.game = gameArr[0];
    else if (gameArr.length > 1) where.game = { in: gameArr };
    if (sourceId) where.sourceId = String(sourceId);
    if (itemKind) where.itemKind = String(itemKind);
    if (official !== undefined && official !== '') {
      where.source = { isOfficial: String(official) === 'true' };
    }

    // FTS5 search: use FTS if available, fallback to LIKE
    const FTS_RECALL_LIMIT = 10000;
    let ftsIds: string[] | null = null;
    if (q) {
      const ftsReady = await isFTS5Ready();
      if (ftsReady) {
        const ftsResult = await searchFeedItems(String(q), { limit: FTS_RECALL_LIMIT, offset: 0 });
        ftsIds = ftsResult.feedItemIds;
        if (ftsIds.length === 0) {
          // FTS returned no results, return empty
          res.json({
            data: [],
            pagination: { page: pageNum, limit: limitNum, total: 0, totalPages: 0 },
            facets: { byGame: {}, byCategory: {}, byFollowCategory: {}, byImportance: {} }
          });
          return;
        }
        where.id = { in: ftsIds };
      } else {
        // Fallback to LIKE
        where.OR = [
          { title: { contains: String(q) } },
          { content: { contains: String(q) } },
          { authorName: { contains: String(q) } }
        ];
      }
    }

    // followGroup: 'follow' = only followed sources, 'game' = only non-followed sources
    if (group === 'follow') {
      appendAnd(where, { source: { is: { followed: true } } });
    } else if (group === 'game') {
      appendAnd(where, { source: { is: { followed: false } } });
    }

    // sourceUid: filter by specific followed UP主
    if (sourceUidArr.length === 1) {
      appendAnd(where, { source: { is: { uid: sourceUidArr[0] } } });
    } else if (sourceUidArr.length > 1) {
      appendAnd(where, { source: { is: { uid: { in: sourceUidArr } } } });
    }

    // Category filter with group awareness
    const catFilter = categoryArr.length === 1 ? categoryArr[0] : undefined;
    applyAnalysisFilters(where, { category: catFilter, importance: undefined, visibility });
    if (categoryArr.length > 1) {
      appendAnd(where, { analysis: { is: { category: { in: categoryArr }, visibility: 'public' } } });
    }
    applyLowValueNoticeFilter(where, visibility);

    const [items, facets] = await Promise.all([
      prisma.feedItem.findMany({
        where,
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        // Every page must aggregate the same candidate window or totals and boundaries drift.
        take: q && ftsIds ? Math.min(ftsIds.length, FTS_RECALL_LIMIT) : STORIES_CANDIDATE_LIMIT,
        include: {
          source: {
            select: {
              id: true,
              name: true,
              type: true,
              game: true,
              isOfficial: true,
              followed: true,
              healthStatus: true
            }
          },
          analysis: true
        }
      }),
      includeFacets
        ? getStoryFacets(prisma, {
            followGroup: group,
            sourceUids: sourceUidArr,
            visibility: visibility ? String(visibility) : undefined
          })
        : Promise.resolve({ byGame: {}, byCategory: {}, byFollowCategory: {}, byImportance: {} })
    ]);

    // Aggregate stories for display
    const allStories = aggregateFeedItemsToStories(items);

    // Apply importance filter for display
    const importanceSet = importanceArr.length > 0
      ? new Set(importanceArr.map(v => normalizeImportance(v)))
      : null;
    const stories = importanceSet
      ? allStories.filter(s => importanceSet.has(s.importance))
      : allStories;

    const data = stories.slice((pageNum - 1) * limitNum, pageNum * limitNum);

    const result = {
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: stories.length,
        totalPages: Math.ceil(stories.length / limitNum)
      },
      facets
    };

    // 缓存第 1 页非搜索结果
    if (pageNum === 1 && !q) {
      setCachedStories(cacheKey, result);
    }

    res.json(result);
  } catch (error) {
    console.error('Game Pulse public stories failed:', error);
    if (error instanceof Error && error.message.startsWith('Validation failed')) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to fetch stories' });
  }
});

export default router;
