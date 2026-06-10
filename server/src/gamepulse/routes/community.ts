/**
 * Community hot topics API endpoint.
 * Returns sentiment-analyzed community topics from Bilibili.
 */

import { Router } from 'express';
import { aggregateCommunityTopics, type CommunityTopic } from '../adapters/community.js';

const router = Router();

// In-memory cache
let cachedTopics: CommunityTopic[] = [];
let lastFetchTime = 0;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

router.get('/topics', async (req, res) => {
  try {
    const now = Date.now();

    // Refresh cache if expired
    if (now - lastFetchTime > CACHE_TTL_MS || cachedTopics.length === 0) {
      cachedTopics = await aggregateCommunityTopics();
      lastFetchTime = now;
    }

    const { sentiment, category, source, page = '1', limit = '50' } = req.query;

    let filtered = [...cachedTopics];

    // Filter by sentiment
    if (sentiment && sentiment !== 'all') {
      filtered = filtered.filter(t => t.sentiment === sentiment);
    }

    // Filter by category
    if (category && category !== 'all') {
      filtered = filtered.filter(t => t.category === category);
    }

    // Filter by source
    if (source && source !== 'all') {
      filtered = filtered.filter(t => t.source === source);
    }

    // Pagination
    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 50));
    const total = filtered.length;
    const start = (pageNum - 1) * limitNum;
    const paged = filtered.slice(start, start + limitNum);

    // Summary stats (from full dataset, not filtered)
    const sentimentCounts = { positive: 0, negative: 0, neutral: 0 };
    let totalHeat = 0;
    for (const t of cachedTopics) {
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
        avgHeat: cachedTopics.length > 0 ? Math.round(totalHeat / cachedTopics.length) : 0,
        totalTopics: cachedTopics.length
      },
      lastUpdated: new Date(lastFetchTime).toISOString()
    });
  } catch (error) {
    console.error('[Community] Error:', error);
    res.status(500).json({ error: 'Failed to fetch community topics' });
  }
});

export default router;
