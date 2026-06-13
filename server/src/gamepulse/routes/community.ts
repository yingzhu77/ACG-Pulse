/**
 * Community hot topics API endpoint.
 * Returns sentiment-analyzed community topics from Bilibili + NGA + Xiaoheihe.
 * Data is persisted in SQLite; fetched lazily with 30-min TTL.
 * On refresh failure, falls back to stale DB data.
 */

import { Router } from 'express';
import { getStalenessInfo, loadTopics, loadAllTopics } from '../db/communityDb.js';
import { refreshCommunityData } from '../services/communityService.js';
import { asyncHandler } from './asyncHandler.js';

const router = Router();

const VALID_SENTIMENTS = new Set(['positive', 'negative', 'neutral']);
const VALID_SOURCES = new Set(['bilibili', 'nga', 'xiaoheihe']);

router.get('/topics', asyncHandler(async (req, res) => {
  // Check staleness without blocking — always return DB snapshot immediately
  let isRefreshing = false;
  const { isStale, lastFetchTime } = await getStalenessInfo();

  // Fire background refresh if data is stale (fire-and-forget, deduped by communityService)
  if (isStale) {
    isRefreshing = true;
    refreshCommunityData().catch(err => {
      console.error('[Community] Background refresh failed:', err);
    });
  }

  const { sentiment, category, source, page = '1', limit = '100' } = req.query;

  const filters = {
    sentiment: sentiment && sentiment !== 'all' && VALID_SENTIMENTS.has(String(sentiment)) ? String(sentiment) : undefined,
    category: category && category !== 'all' ? String(category) : undefined,
    source: source && source !== 'all' && VALID_SOURCES.has(String(source)) ? String(source) : undefined
  };

  // Load all matching topics (sorted by heatScore desc)
  const allFiltered = await loadTopics(filters);

  // Pagination
  const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(String(limit), 10) || 100));
  const total = allFiltered.length;
  const start = (pageNum - 1) * limitNum;
  const paged = allFiltered.slice(start, start + limitNum);

  // Summary stats — computed from the same dataset the client sees
  const sentimentCounts = { positive: 0, negative: 0, neutral: 0 };
  let totalHeat = 0;
  for (const t of allFiltered) {
    sentimentCounts[t.sentiment]++;
    totalHeat += t.heatScore;
  }

  res.json({
    data: paged,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum)
    },
    summary: {
      sentimentCounts,
      avgHeat: allFiltered.length > 0 ? Math.round(totalHeat / allFiltered.length) : 0,
      totalTopics: allFiltered.length
    },
    lastUpdated: lastFetchTime > 0 ? new Date(lastFetchTime).toISOString() : null,
    isRefreshing,
    isStale,
    stale: isStale || undefined  // backwards compat
  });
}));

// GET /api/community/insights — aggregated data for the InsightsPage "社区风向" section
router.get('/insights', asyncHandler(async (_req, res) => {
  let isRefreshing = false;
  const { isStale, lastFetchTime } = await getStalenessInfo();

  if (isStale) {
    isRefreshing = true;
    refreshCommunityData().catch(err => {
      console.error('[Community] Background refresh failed:', err);
    });
  }

  const allTopics = await loadAllTopics();

  // Top 8 topics by heatScore
  const topTopics = allTopics.slice(0, 8).map(t => ({
    id: t.id,
    title: t.title,
    heatScore: t.heatScore,
    sentiment: t.sentiment,
    source: t.source,
    category: t.category,
    url: t.url
  }));

  // Source share: count + total heat per source, then percent
  const sourceMap = new Map<string, { count: number; heatScore: number }>();
  for (const t of allTopics) {
    const entry = sourceMap.get(t.source) || { count: 0, heatScore: 0 };
    entry.count++;
    entry.heatScore += t.heatScore;
    sourceMap.set(t.source, entry);
  }
  const totalHeat = allTopics.reduce((s, t) => s + t.heatScore, 0) || 1;
  const sourceShare = [...sourceMap.entries()].map(([source, v]) => ({
    source,
    count: v.count,
    heatScore: v.heatScore,
    percent: Math.round((v.heatScore / totalHeat) * 100)
  })).sort((a, b) => b.heatScore - a.heatScore);

  // Heat trend: aggregate topic trend arrays by right-aligning their latest points.
  const trendLen = Math.max(...allTopics.map(t => t.trend.length), 0);
  const heatTrend: Array<{ index: number; heatScore: number; topicCount: number }> = [];
  for (let i = 0; i < trendLen; i++) {
    let sum = 0;
    let count = 0;
    for (const t of allTopics) {
      const offset = trendLen - t.trend.length;
      const topicIndex = i - offset;
      if (topicIndex >= 0 && topicIndex < t.trend.length) {
        sum += t.trend[topicIndex];
        count++;
      }
    }
    heatTrend.push({
      index: i,
      heatScore: count > 0 ? Math.round(sum / count) : 0,
      topicCount: count
    });
  }

  res.json({
    topTopics,
    sourceShare,
    heatTrend,
    meta: {
      totalTopics: allTopics.length,
      lastUpdated: lastFetchTime > 0 ? new Date(lastFetchTime).toISOString() : null,
      isStale,
      isRefreshing
    }
  });
}));

export default router;
