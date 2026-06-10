/**
 * Community hot topics API endpoint.
 * Returns sentiment-analyzed community topics from Bilibili + NGA.
 */

import { Router } from 'express';
import { aggregateCommunityTopics, type CommunityTopic } from '../adapters/community.js';

const router = Router();

// In-memory cache with concurrency lock
let cachedTopics: CommunityTopic[] = [];
let lastFetchTime = 0;
let fetchPromise: Promise<CommunityTopic[]> | null = null;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

const VALID_SENTIMENTS = new Set(['positive', 'negative', 'neutral']);
const VALID_SOURCES = new Set(['bilibili', 'nga', 'xiaoheihe']);

router.get('/topics', async (req, res) => {
  try {
    const now = Date.now();

    // Refresh cache if expired (with concurrency lock)
    if (now - lastFetchTime > CACHE_TTL_MS || cachedTopics.length === 0) {
      if (!fetchPromise) {
        fetchPromise = aggregateCommunityTopics().finally(() => { fetchPromise = null; });
      }
      cachedTopics = await fetchPromise;
      lastFetchTime = Date.now();
    }

    const { sentiment, category, source, page = '1', limit = '50' } = req.query;

    let filtered = [...cachedTopics];

    // Filter with validation
    if (sentiment && sentiment !== 'all' && VALID_SENTIMENTS.has(String(sentiment))) {
      filtered = filtered.filter(t => t.sentiment === sentiment);
    }
    if (category && category !== 'all') {
      filtered = filtered.filter(t => t.category === category);
    }
    if (source && source !== 'all' && VALID_SOURCES.has(String(source))) {
      filtered = filtered.filter(t => t.source === source);
    }

    // Pagination
    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 50));
    const total = filtered.length;
    const start = (pageNum - 1) * limitNum;
    const paged = filtered.slice(start, start + limitNum);

    // Summary stats (from full dataset)
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
