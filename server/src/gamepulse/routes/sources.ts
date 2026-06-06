import { Router } from 'express';
import { prisma } from '../../db.js';

const router = Router();

/**
 * GET /sources - 获取公开源列表
 */
router.get('/sources', async (_req, res) => {
  try {
    const sources = await prisma.source.findMany({
      where: { enabled: true },
      orderBy: [{ game: 'asc' }, { priority: 'asc' }],
      select: {
        id: true,
        name: true,
        type: true,
        game: true,
        isOfficial: true,
        followed: true,
        uid: true,
        avatar: true,
        url: true,
        healthStatus: true,
        lastSuccessAt: true,
        lastCheckedAt: true,
        lastError: true,
        _count: {
          select: { feedItems: true }
        }
      }
    });
    res.json(sources);
  } catch (error) {
    console.error('Game Pulse public sources failed:', error);
    res.status(500).json({ error: 'Failed to fetch sources' });
  }
});

export default router;
