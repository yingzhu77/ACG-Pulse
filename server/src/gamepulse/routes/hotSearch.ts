/**
 * Hot search API endpoint.
 * Returns trending topics from Bilibili and Weibo.
 */

import { Router } from 'express';
import { fetchAllHotSearch, classifyHotTopic } from '../adapters/hotSearch.js';

const router = Router();

// In-memory cache
let cachedData: any[] = [];
let lastFetchTime = 0;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * GET /hot-search - Get trending topics
 * Query params:
 *   - tag: Filter by tag (game, anime, ai, movie)
 *   - limit: Max items to return (default 50)
 */
router.get('/hot-search', async (req, res) => {
  try {
    const { tag, limit } = req.query;

    // Check cache
    const now = Date.now();
    if (now - lastFetchTime > CACHE_TTL_MS || cachedData.length === 0) {
      cachedData = await fetchAllHotSearch();
      lastFetchTime = now;
      console.log(`[HotSearch] Fetched ${cachedData.length} items`);
    }

    // Classify and filter
    let items = cachedData.map(item => ({
      ...item,
      tags: classifyHotTopic(item.title)
    }));

    // Filter by tag if specified
    if (tag && tag !== 'all') {
      items = items.filter(item => item.tags.includes(String(tag)));
    }

    // Sort: items with heat first, then by heat descending
    items.sort((a, b) => {
      if (a.heat > 0 && b.heat === 0) return -1;
      if (a.heat === 0 && b.heat > 0) return 1;
      return b.heat - a.heat;
    });

    // Apply limit: 50 for no tag, 20 for specific tag
    const limitNum = tag && tag !== 'all'
      ? Math.min(20, Math.max(1, parseInt(String(limit)) || 20))
      : Math.min(50, Math.max(1, parseInt(String(limit)) || 50));

    items = items.slice(0, limitNum);

    res.json({
      data: items,
      total: items.length,
      lastUpdated: new Date(lastFetchTime).toISOString()
    });
  } catch (error) {
    console.error('[HotSearch] Error:', error);
    res.status(500).json({ error: 'Failed to fetch hot search' });
  }
});

export default router;
