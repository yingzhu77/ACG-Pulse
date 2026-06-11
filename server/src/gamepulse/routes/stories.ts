import { Router } from 'express';
import { prisma } from '../../db.js';
import { aggregateFeedItemsToStories, toPublicFeedItem } from '../storyAggregation.js';
import { normalizeImportance } from '../storyAggregation.js';
import type { PrismaWhereClause } from '../types.js';
import {
  toArray,
  appendAnd,
  applyAnalysisFilters,
  applyLowValueNoticeFilter,
  publicVisibilityRelationWhere
} from './helpers.js';
import {
  PublicItemsQuerySchema,
  PublicStoriesQuerySchema,
  validateOrThrow
} from '../validation.js';

const router = Router();

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
    if (q) {
      where.OR = [
        { title: { contains: String(q) } },
        { content: { contains: String(q) } },
        { authorName: { contains: String(q) } }
      ];
    }
    applyAnalysisFilters(where, { category, importance, visibility });
    applyLowValueNoticeFilter(where, visibility);

    const [data, total] = await Promise.all([
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

const FOLLOW_CATEGORIES_SET = new Set(['music', 'trailer', 'movie_trailer', 'creator_video']);
const GAME_CATEGORIES_SET = new Set(['announcement', 'event', 'version', 'character', 'pv', 'game_music', 'community', 'other']);

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
      sourceUid
    } = validateOrThrow(PublicStoriesQuerySchema, req.query, 'stories query');

    const pageNum = page;
    const limitNum = limit;
    const candidateLimit = Math.min(1000, Math.max(300, pageNum * limitNum * 4));
    const gameArr = toArray(game);
    const categoryArr = toArray(category);
    const importanceArr = toArray(importance);
    const group = followGroup ? String(followGroup) : '';

    // Build WHERE
    const where: PrismaWhereClause = { hidden: false };
    if (gameArr.length === 1) where.game = gameArr[0];
    else if (gameArr.length > 1) where.game = { in: gameArr };
    if (sourceId) where.sourceId = String(sourceId);
    if (itemKind) where.itemKind = String(itemKind);
    if (official !== undefined && official !== '') {
      where.source = { isOfficial: String(official) === 'true' };
    }
    if (q) {
      where.OR = [
        { title: { contains: String(q) } },
        { content: { contains: String(q) } },
        { authorName: { contains: String(q) } }
      ];
    }

    // followGroup: 'follow' = only followed sources, 'game' = only non-followed sources
    if (group === 'follow') {
      appendAnd(where, { source: { is: { followed: true } } });
    } else if (group === 'game') {
      appendAnd(where, { source: { is: { followed: false } } });
    }

    // sourceUid: filter by specific followed UP主
    if (sourceUid) {
      appendAnd(where, { source: { is: { uid: String(sourceUid) } } });
    }

    // Category filter with group awareness
    const catFilter = categoryArr.length === 1 ? categoryArr[0] : undefined;
    applyAnalysisFilters(where, { category: catFilter, importance: undefined, visibility });
    if (categoryArr.length > 1) {
      appendAnd(where, { analysis: { is: { category: { in: categoryArr }, visibility: 'public' } } });
    }
    applyLowValueNoticeFilter(where, visibility);

    const items = await prisma.feedItem.findMany({
      where,
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      take: candidateLimit,
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
    });

    // Aggregate stories for display
    const allStories = aggregateFeedItemsToStories(items);

    // Compute facets from the same base items as stories (no visibility filter to keep counts aligned)
    const facetWhere = { hidden: false };
    appendAnd(facetWhere, { analysis: { status: { in: ['completed', 'failed'] } } });
    applyLowValueNoticeFilter(facetWhere, visibility);

    // Apply followGroup filter to facets
    if (group === 'follow') {
      appendAnd(facetWhere, { source: { is: { followed: true } } });
    } else if (group === 'game') {
      appendAnd(facetWhere, { source: { is: { followed: false } } });
    }

    const allItems = await prisma.feedItem.findMany({
      where: facetWhere,
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
    });

    // Compute facets from all items (not stories) to show total counts
    const byGame: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    const byFollowCategory: Record<string, number> = {};
    const byImportance: Record<string, number> = {};
    for (const item of allItems) {
      const isFollow = item.source.followed === true;
      const cat = item.analysis?.category || 'other';
      const importance = item.analysis?.importance || 'low';

      if (isFollow) {
        if (FOLLOW_CATEGORIES_SET.has(cat)) {
          byFollowCategory[cat] = (byFollowCategory[cat] || 0) + 1;
        }
      } else {
        if (item.game) {
          byGame[item.game] = (byGame[item.game] || 0) + 1;
        }
        if (GAME_CATEGORIES_SET.has(cat)) {
          byCategory[cat] = (byCategory[cat] || 0) + 1;
        }
      }
      byImportance[importance] = (byImportance[importance] || 0) + 1;
    }

    // Apply importance filter for display
    const importanceSet = importanceArr.length > 0
      ? new Set(importanceArr.map(v => normalizeImportance(v)))
      : null;
    const stories = importanceSet
      ? allStories.filter(s => importanceSet.has(s.importance))
      : allStories;

    const data = stories.slice((pageNum - 1) * limitNum, pageNum * limitNum);

    res.json({
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: stories.length,
        totalPages: Math.ceil(stories.length / limitNum)
      },
      facets: { byGame, byCategory, byFollowCategory, byImportance }
    });
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
