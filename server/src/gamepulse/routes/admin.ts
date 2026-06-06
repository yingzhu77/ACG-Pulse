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

export function createAdminRouter(io: Server): Router {
  const router = Router();

  router.post('/login', (req, res) => {
    if (!isValidAdminPassword(req.body?.password)) {
      return res.status(401).json({ error: 'Invalid password or ADMIN_PASSWORD is not configured' });
    }
    res.json({ token: createAdminToken() });
  });

  router.use(requireAdmin);

  router.get('/sources', async (_req, res) => {
    const sources = await prisma.source.findMany({
      orderBy: [{ enabled: 'desc' }, { game: 'asc' }, { priority: 'asc' }],
      include: {
        _count: {
          select: { feedItems: true }
        }
      }
    });
    res.json(sources);
  });

  router.post('/sources', async (req, res) => {
    try {
      const data = normalizeSourceInput(req.body);
      const source = await prisma.source.create({ data });
      res.status(201).json(source);
    } catch (error) {
      console.error('Create source failed:', error);
      res.status(400).json({ error: 'Failed to create source' });
    }
  });

  router.put('/sources/:id', async (req, res) => {
    try {
      const source = await prisma.source.update({
        where: { id: req.params.id },
        data: normalizeSourceInput(req.body, true)
      });
      res.json(source);
    } catch (error) {
      console.error('Update source failed:', error);
      res.status(400).json({ error: 'Failed to update source' });
    }
  });

  router.patch('/sources/:id/toggle', async (req, res) => {
    const current = await prisma.source.findUnique({ where: { id: req.params.id } });
    if (!current) return res.status(404).json({ error: 'Source not found' });
    const source = await prisma.source.update({
      where: { id: req.params.id },
      data: { enabled: !current.enabled }
    });
    res.json(source);
  });

  router.delete('/sources/:id', async (req, res) => {
    await prisma.source.delete({ where: { id: req.params.id } });
    res.status(204).send();
  });

  router.post('/sources/seed-defaults', async (_req, res) => {
    const sources = await seedDefaultSources();
    res.json({ count: sources.length, sources });
  });

  router.post('/sources/follow-url', async (req, res) => {
    try {
      const rawUrl = String(req.body?.url || '').trim();
      const uidMatch = rawUrl.match(/space\.bilibili\.com\/(\d+)/);
      if (!uidMatch) {
        return res.status(400).json({ error: '无法解析 B站 URL，格式应为 https://space.bilibili.com/UID' });
      }
      const uid = uidMatch[1];
      const name = String(req.body?.name || '').trim() || `UP主-${uid}`;

      const existing = await prisma.source.findFirst({
        where: { type: 'bilibili_video', uid }
      });
      if (existing) {
        const updated = await prisma.source.update({
          where: { id: existing.id },
          data: { followed: true, name: req.body?.name ? name : existing.name }
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
    const item = await prisma.feedItem.update({
      where: { id: req.params.id },
      data: { hidden: Boolean(req.body?.hidden) },
      include: { source: true, analysis: true }
    });
    res.json(item);
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
      const limit = Math.min(500, Math.max(1, Number(req.body?.limit) || 100));
      const items = await prisma.feedItem.findMany({
        where: { hidden: false },
        include: { source: true, analysis: true },
        orderBy: { createdAt: 'desc' },
        take: limit
      });

      // 立即返回任务开始
      res.json({ total: items.length, status: 'started' });

      // 后台执行重新分类
      let analyzed = 0;
      let failed = 0;
      for (const item of items) {
        try {
          await ensureAnalysis(item, { force: true });
          analyzed++;
        } catch (error) {
          console.error(`[Reanalyze] Failed for item ${item.id}:`, error);
          failed++;
        }

        // 每处理 10 条推送一次进度
        if (analyzed % 10 === 0 || analyzed + failed === items.length) {
          io.emit('reanalyze:progress', {
            total: items.length,
            analyzed,
            failed,
            percent: Math.round(((analyzed + failed) / items.length) * 100)
          });
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
    const entries = Object.entries(req.body || {});
    for (const [key, value] of entries) {
      await prisma.setting.upsert({
        where: { key },
        create: { key, value: String(value) },
        update: { value: String(value) }
      });
    }
    res.status(204).send();
  });

  return router;
}

/** Source data shape compatible with Prisma create/update. */
interface NormalizedSourceData {
  name?: string;
  type?: string;
  game?: string;
  url?: string | null;
  uid?: string | null;
  route?: string | null;
  isOfficial?: boolean;
  followed?: boolean;
  enabled?: boolean;
  priority?: number;
  config?: string | null;
}

/** Full source data with required fields for create operations. */
interface NormalizedSourceDataFull extends NormalizedSourceData {
  name: string;
  type: string;
  game: string;
}

function normalizeSourceInput(input: Record<string, unknown>): NormalizedSourceDataFull;
function normalizeSourceInput(input: Record<string, unknown>, partial: true): NormalizedSourceData;
function normalizeSourceInput(input: Record<string, unknown>, partial = false): NormalizedSourceData {
  const data: NormalizedSourceData = {};
  const assign = <K extends keyof NormalizedSourceData>(
    key: K,
    transform: (value: unknown) => NormalizedSourceData[K]
  ): void => {
    if (input[key] !== undefined) {
      data[key] = transform(input[key]);
    }
  };

  assign('name', value => String(value).trim());
  assign('type', value => String(value).trim());
  assign('game', value => String(value).trim());
  assign('url', value => optionalString(value));
  assign('uid', value => optionalString(value));
  assign('route', value => optionalString(value));
  assign('isOfficial', value => Boolean(value));
  assign('followed', value => Boolean(value));
  assign('enabled', value => Boolean(value));
  assign('priority', value => Number(value) || 50);
  assign('config', value => typeof value === 'string' ? optionalString(value) : JSON.stringify(value || {}));

  if (!partial) {
    for (const key of ['name', 'type', 'game'] as const) {
      if (!data[key]) throw new Error(`${key} is required`);
    }
  }

  return data;
}

function optionalString(value: unknown): string | null {
  const normalized = String(value || '').trim();
  return normalized ? normalized : null;
}
