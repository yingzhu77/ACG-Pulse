import { Router } from 'express';
import { prisma } from '../../db.js';
import { toPublicFeedItem } from '../storyAggregation.js';
import { attachLegacyEventIds, eventProjection, listEventMembers, syncEvents } from '../services/events.js';
import { normalizeImportance } from '../storyAggregation.js';
import { computeStoryFacetsFromStories, emptyStoryFacets } from '../storyFacets.js';
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
import { getMaxFeedItems } from '../config.js';
import type { FeedItemWithRelations } from '../types.js';

const router = Router();

const STORIES_BATCH_SIZE = 500;
const FTS_RECALL_LIMIT = 10000;

const storyCandidateInclude = {
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
} as const;

async function fetchStoryCandidateItems(where: PrismaWhereClause, maxItems: number): Promise<Array<FeedItemWithRelations & { eventId: string | null; eventProgress: boolean }>> {
  const items: Array<FeedItemWithRelations & { eventId: string | null; eventProgress: boolean }> = [];
  let cursor: { id: string } | undefined;

  while (items.length < maxItems) {
    const take = Math.min(STORIES_BATCH_SIZE, maxItems - items.length);
    const batch = await prisma.feedItem.findMany({
      where,
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      ...(cursor ? { cursor, skip: 1 } : {}),
      take,
      include: storyCandidateInclude
    });

    items.push(...batch);
    if (batch.length < take) break;
    cursor = { id: batch[batch.length - 1].id };
  }

  return items;
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
    const where: PrismaWhereClause = { hidden: false, eventArchived: false };

    if (game) where.game = String(game);
    if (sourceId) where.sourceId = String(sourceId);
    if (itemKind) where.itemKind = String(itemKind);
    if (official !== undefined && official !== '') {
      where.source = { isOfficial: String(official) === 'true' };
    }

    // FTS5 search: use FTS if available, fallback to LIKE
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

    // Build WHERE
    const where: PrismaWhereClause = { hidden: false, eventArchived: false };
    if (gameArr.length === 1) where.game = gameArr[0];
    else if (gameArr.length > 1) where.game = { in: gameArr };
    if (sourceId) where.sourceId = String(sourceId);
    if (itemKind) where.itemKind = String(itemKind);
    if (official !== undefined && official !== '') {
      where.source = { isOfficial: String(official) === 'true' };
    }

    // FTS5 search: use FTS if available, fallback to LIKE
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
            facets: emptyStoryFacets()
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

    const maxCandidates = q && ftsIds
      ? Math.min(ftsIds.length, FTS_RECALL_LIMIT, getMaxFeedItems())
      : getMaxFeedItems();
    await syncEvents();
    const items = await fetchStoryCandidateItems(where, maxCandidates);

    // Query filters can change which reports are displayed, not persisted identity.
    const allStories = listEventMembers(items);

    // Apply importance filter for display
    const importanceSet = importanceArr.length > 0
      ? new Set(importanceArr.map(v => normalizeImportance(v)))
      : null;
    const stories = importanceSet
      ? allStories.filter(s => importanceSet.has(s.importance))
      : allStories;
    const facets = includeFacets ? computeStoryFacetsFromStories(stories) : emptyStoryFacets();

    const data = stories.slice((pageNum - 1) * limitNum, pageNum * limitNum);
    await attachLegacyEventIds(data);

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

router.get('/stories/:id', async (req, res) => {
  const id = req.params.id;
  if (!/^evt_[\da-f-]{36}$|^story_[\da-f]{16}$/i.test(id)) {
    res.status(404).json({ error: '事件不存在或已下架' });
    return;
  }
  try {
    res.setHeader('Cache-Control', 'no-store');
    const event = await eventProjection(id);
    if (!event) {
      res.status(404).json({ error: id.startsWith('story_') ? '旧收藏无法可靠匹配，请从动态列表重新查找' : '事件不存在或已下架' });
      return;
    }
    res.json({ data: event });
  } catch (error) {
    console.error('Game Pulse event detail failed:', error);
    res.status(500).json({ error: '暂时无法读取事件' });
  }
});

export default router;
