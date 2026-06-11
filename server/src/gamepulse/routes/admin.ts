import { Router } from 'express';
import type { Server } from 'socket.io';
import { prisma } from '../../db.js';
import { createAdminToken, isValidAdminPassword, requireAdmin } from '../auth.js';
import { seedDefaultSources } from '../defaultSources.js';
import { ensureAnalysis } from '../ai/analyzer.js';
import { runGamePulseCheck } from '../jobs/checker.js';
import type { PrismaWhereClause } from '../types.js';
import {
  CreateSourceSchema,
  UpdateSourceSchema,
  FollowUrlSchema,
  ReanalyzeSchema,
  HideItemSchema,
  LoginSchema,
  UpdateSettingsSchema,
  validateOrThrow
} from '../validation.js';

// Login brute-force protection
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export function createAdminRouter(io: Server): Router {
  const router = Router();

  router.post('/login', (req, res) => {
    let credentials: { password: string };
    try {
      credentials = validateOrThrow(LoginSchema, req.body, 'login');
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid login input' });
    }

    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const record = loginAttempts.get(ip);

    if (record && record.resetAt > now && record.count >= LOGIN_MAX_ATTEMPTS) {
      return res.status(429).json({ error: 'Too many login attempts, try again in 15 minutes' });
    }

    if (!record || record.resetAt <= now) {
      loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    } else {
      record.count++;
    }

    if (!isValidAdminPassword(credentials.password)) {
      return res.status(401).json({ error: 'Invalid password or ADMIN_PASSWORD is not configured' });
    }

    // Reset on successful login
    loginAttempts.delete(ip);
    res.json({ token: createAdminToken() });
  });

  router.use(requireAdmin);

  router.get('/sources', async (_req, res) => {
    try {
      const sources = await prisma.source.findMany({
        orderBy: [{ enabled: 'desc' }, { game: 'asc' }, { priority: 'asc' }],
        include: {
          _count: {
            select: { feedItems: true }
          }
        }
      });
      res.json(sources);
    } catch (error) {
      console.error('Fetch sources failed:', error);
      res.status(500).json({ error: 'Failed to fetch sources' });
    }
  });

  router.post('/sources', async (req, res) => {
    try {
      const data = validateOrThrow(CreateSourceSchema, req.body, 'source');
      const source = await prisma.source.create({ data });
      res.status(201).json(source);
    } catch (error) {
      console.error('Create source failed:', error);
      res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to create source' });
    }
  });

  router.put('/sources/:id', async (req, res) => {
    try {
      const data = validateOrThrow(UpdateSourceSchema, req.body, 'source');
      const source = await prisma.source.update({
        where: { id: req.params.id },
        data
      });
      res.json(source);
    } catch (error) {
      console.error('Update source failed:', error);
      res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to update source' });
    }
  });

  router.patch('/sources/:id/toggle', async (req, res) => {
    try {
      const current = await prisma.source.findUnique({ where: { id: req.params.id } });
      if (!current) return res.status(404).json({ error: 'Source not found' });
      const source = await prisma.source.update({
        where: { id: req.params.id },
        data: { enabled: !current.enabled }
      });
      res.json(source);
    } catch (error) {
      console.error('Toggle source failed:', error);
      res.status(400).json({ error: 'Failed to toggle source' });
    }
  });

  router.delete('/sources/:id', async (req, res) => {
    try {
      await prisma.source.delete({ where: { id: req.params.id } });
      res.status(204).send();
    } catch (error) {
      console.error('Delete source failed:', error);
      res.status(400).json({ error: 'Failed to delete source' });
    }
  });

  router.post('/sources/seed-defaults', async (_req, res) => {
    try {
      const sources = await seedDefaultSources();
      res.json({ count: sources.length, sources });
    } catch (error) {
      console.error('Seed defaults failed:', error);
      res.status(500).json({ error: 'Failed to seed defaults' });
    }
  });

  router.post('/sources/follow-url', async (req, res) => {
    try {
      const input = validateOrThrow(FollowUrlSchema, req.body, 'follow url');
      const rawUrl = input.url;
      const uidMatch = rawUrl.match(/space\.bilibili\.com\/(\d+)/);
      if (!uidMatch) {
        return res.status(400).json({ error: '无法解析 B站 URL，格式应为 https://space.bilibili.com/UID' });
      }
      const uid = uidMatch[1];
      const name = input.name || `UP主-${uid}`;

      const existing = await prisma.source.findFirst({
        where: { type: 'bilibili_video', uid }
      });
      if (existing) {
        const updated = await prisma.source.update({
          where: { id: existing.id },
          data: { followed: true, name: input.name ? name : existing.name }
        });
        return res.json(updated);
      }

      const source = await prisma.source.create({
        data: {
          name,
          type: 'bilibili_video',
          game: '',
          url: `https://space.bilibili.com/${uid}`,
          uid,
          followed: true,
          isOfficial: false,
          priority: 60,
          config: JSON.stringify({ itemKind: 'creator_video', rssHubRoutes: [`/bilibili/user/video/${uid}`] })
        }
      });
      res.status(201).json(source);
    } catch (error) {
      console.error('Follow URL failed:', error);
      res.status(400).json({ error: '添加关注失败' });
    }
  });

  router.get('/items', async (req, res) => {
    const { hidden, page = '1', limit = '30' } = req.query;
    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(80, Math.max(1, parseInt(String(limit), 10) || 30));
    const where: PrismaWhereClause = {};
    if (hidden !== undefined && hidden !== '') where.hidden = String(hidden) === 'true';

    const [data, total] = await Promise.all([
      prisma.feedItem.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        include: { source: true, analysis: true }
      }),
      prisma.feedItem.count({ where })
    ]);
    res.json({ data, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) } });
  });

  router.patch('/items/:id/hide', async (req, res) => {
    try {
      const input = validateOrThrow(HideItemSchema, req.body, 'hide item');
      const item = await prisma.feedItem.update({
        where: { id: req.params.id },
        data: { hidden: input.hidden },
        include: { source: true, analysis: true }
      });
      res.json(item);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to update item visibility' });
    }
  });

  router.post('/items/:id/analyze', async (req, res) => {
    const item = await prisma.feedItem.findUnique({
      where: { id: req.params.id },
      include: { source: true }
    });
    if (!item) return res.status(404).json({ error: 'Item not found' });
    await ensureAnalysis(item, { force: true });
    const updated = await prisma.feedItem.findUnique({
      where: { id: item.id },
      include: { source: true, analysis: true }
    });
    res.json(updated);
  });

  router.post('/check', async (_req, res) => {
    const result = await runGamePulseCheck(io);
    res.json(result);
  });

  router.post('/reanalyze-all', async (req, res) => {
    try {
      const { limit } = validateOrThrow(ReanalyzeSchema, req.body, 'reanalyze');
      const items = await prisma.feedItem.findMany({
        where: { hidden: false },
        include: { source: true, analysis: true },
        orderBy: { createdAt: 'desc' },
        take: limit
      });

      // 立即返回任务开始
      res.json({ total: items.length, status: 'started' });

      // 后台逐条执行重新分类，带延迟避免限流
      let analyzed = 0;
      let failed = 0;
      const ITEM_DELAY = 3000;
      for (let i = 0; i < items.length; i++) {
        try {
          await ensureAnalysis(items[i], { force: true });
          analyzed++;
        } catch (error) {
          console.error(`[Reanalyze] Failed for item ${items[i].id}:`, error);
          failed++;
        }

        // 每 5 条推送进度
        if ((analyzed + failed) % 5 === 0 || analyzed + failed === items.length) {
          io.emit('reanalyze:progress', {
            total: items.length,
            analyzed,
            failed,
            percent: Math.round(((analyzed + failed) / items.length) * 100)
          });
        }

        // 逐条延迟避免 API 限流
        if (i < items.length - 1) {
          await new Promise(r => setTimeout(r, ITEM_DELAY));
        }
      }

      // 推送完成事件
      io.emit('reanalyze:done', { total: items.length, analyzed, failed });
    } catch (error) {
      console.error('Reanalyze all failed:', error);
      io.emit('reanalyze:error', { error: 'Failed to reanalyze' });
    }
  });

  router.get('/settings', async (_req, res) => {
    const settings = await prisma.setting.findMany();
    res.json(Object.fromEntries(settings.map(item => [item.key, item.value])));
  });

  router.put('/settings', async (req, res) => {
    try {
      const input = validateOrThrow(UpdateSettingsSchema, req.body || {}, 'settings');
      const entries = Object.entries(input);
      for (const [key, value] of entries) {
        await prisma.setting.upsert({
          where: { key },
          create: { key, value: String(value) },
          update: { value: String(value) }
        });
      }
      res.status(204).send();
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to update settings' });
    }
  });

  return router;
}
