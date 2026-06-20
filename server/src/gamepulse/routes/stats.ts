import { Router } from 'express';
import { prisma } from '../../db.js';
import { getPublicStats } from '../services/statsService.js';

const router = Router();

/**
 * GET /source-health-history - 获取源健康历史统计
 */
router.get('/source-health-history', async (_req, res) => {
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [recentLogs, failureStats, sourceDetails] = await Promise.all([
      prisma.sourceHealthLog.findMany({
        where: { checkedAt: { gte: oneDayAgo } },
        orderBy: { checkedAt: 'desc' },
        take: 50,
        include: { source: { select: { name: true, game: true } } }
      }),
      prisma.sourceHealthLog.groupBy({
        by: ['sourceId', 'status'],
        where: { checkedAt: { gte: oneDayAgo } },
        _count: { status: true }
      }),
      prisma.source.findMany({
        where: { enabled: true },
        select: {
          id: true, name: true, game: true, healthStatus: true,
          lastSuccessAt: true, lastCheckedAt: true, lastError: true
        }
      })
    ]);

    // 计算每个源的失败率
    const sourceStatsMap = new Map<string, { total: number; failed: number }>();
    for (const stat of failureStats) {
      const prev = sourceStatsMap.get(stat.sourceId) || { total: 0, failed: 0 };
      prev.total += stat._count.status;
      if (stat.status === 'failed') prev.failed += stat._count.status;
      sourceStatsMap.set(stat.sourceId, prev);
    }

    const sourceStats = sourceDetails.map(s => {
      const stats = sourceStatsMap.get(s.id) || { total: 0, failed: 0 };
      return {
        ...s,
        recentChecks: stats.total,
        recentFailures: stats.failed,
        failureRate: stats.total > 0 ? Math.round((stats.failed / stats.total) * 100) : 0
      };
    });

    res.json({
      recentLogs,
      sourceStats,
      totalChecks24h: failureStats.reduce((sum, s) => sum + s._count.status, 0),
      totalFailures24h: failureStats.filter(s => s.status === 'failed').reduce((sum, s) => sum + s._count.status, 0)
    });
  } catch (error) {
    console.error('Source health history failed:', error);
    res.status(500).json({ error: 'Failed to fetch source health history' });
  }
});

/**
 * GET /stats - 获取统计信息
 */
router.get('/stats', async (_req, res) => {
  try {
    res.json(await getPublicStats());
  } catch (error) {
    console.error('Game Pulse stats failed:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

export default router;
