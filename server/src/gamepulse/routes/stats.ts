import { Router } from 'express';
import { prisma } from '../../db.js';
import { publicVisibilityWhere, andWhere } from './helpers.js';

const router = Router();

/**
 * GET /stats - 获取统计信息
 */
router.get('/stats', async (_req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const publicWhere = publicVisibilityWhere();

    const [total, todayCount, highCount, byGame, byKind, sourceHealth] = await Promise.all([
      prisma.feedItem.count({ where: publicWhere }),
      prisma.feedItem.count({ where: andWhere(publicWhere, { createdAt: { gte: today } }) }),
      prisma.feedItem.count({
        where: andWhere(publicWhere, {
          analysis: { is: { importance: { in: ['high', 'urgent'] } } }
        })
      }),
      prisma.feedItem.groupBy({
        by: ['game'],
        where: publicWhere,
        _count: { game: true }
      }),
      prisma.feedItem.groupBy({
        by: ['itemKind'],
        where: publicWhere,
        _count: { itemKind: true }
      }),
      prisma.source.groupBy({
        by: ['healthStatus'],
        _count: { healthStatus: true }
      })
    ]);

    // 计算近 24 小时的时间线数据
    const now = new Date();
    const hourlyData: Array<{ hour: string; count: number }> = [];
    for (let i = 23; i >= 0; i--) {
      const hourStart = new Date(now);
      hourStart.setHours(now.getHours() - i, 0, 0, 0);
      const hourEnd = new Date(hourStart);
      hourEnd.setHours(hourStart.getHours() + 1);

      const count = await prisma.feedItem.count({
        where: andWhere(publicWhere, {
          createdAt: {
            gte: hourStart,
            lt: hourEnd
          }
        })
      });

      hourlyData.push({
        hour: hourStart.toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
        count
      });
    }

    res.json({
      total,
      today: todayCount,
      high: highCount,
      byGame: Object.fromEntries(byGame.map(item => [item.game, item._count.game])),
      byKind: Object.fromEntries(byKind.map(item => [item.itemKind, item._count.itemKind])),
      sourceHealth: Object.fromEntries(sourceHealth.map(item => [item.healthStatus, item._count.healthStatus])),
      hourlyTrend: hourlyData
    });
  } catch (error) {
    console.error('Game Pulse stats failed:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

export default router;
