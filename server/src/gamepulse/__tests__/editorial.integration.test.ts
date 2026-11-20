import { copyFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../db.js', async () => {
  const { PrismaClient } = await import('@prisma/client');
  const root = process.env.ACG_PULSE_TEST_TEMP_ROOT!;
  const db = path.join(root, 'editorial.db');
  const source = path.join(root, 'test.db');
  copyFileSync(source, db);
  return { prisma: new PrismaClient({ datasourceUrl: `file:${db}` }) };
});

import { prisma } from '../../db.js';
import reportsRouter, { adminReportsRouter } from '../routes/reports.js';
import { createAdminToken, requireAdmin } from '../auth.js';
import { editionRange, publishDailyEdition, readDailyEdition, readFeatured, shanghaiDate } from '../reports/editorial.js';

const GAME = '示例作品';
const body = '本则公告明确列出资格、开放时段、参与条件、持续时间以及完整操作方式，请关注公告后续说明。';
const date = (value: string) => new Date(value);
const firstClose = date('2026-11-19T16:10:00.000Z');
const secondClose = date('2026-11-20T16:10:00.000Z');
const previously = '2026-11-19';
const next = '2026-11-20';

async function source(id: string, healthStatus = 'unknown') {
  return prisma.source.create({ data: {
    id, name: `Fixture ${id}`, game: GAME, type: 'official_site', isOfficial: true,
    healthStatus, createdAt: date('2026-11-01T00:00:00Z')
  } });
}

async function check(sourceId: string, status: string, time: string) {
  await prisma.sourceHealthLog.create({ data: { sourceId, status, checkedAt: date(time) } });
}

async function item(options: {
  id: string; title: string; discovered: string; published?: string | null; sourceId?: string;
  text?: string; backfill?: boolean; status?: string; analyzedAt?: string; importance?: string; game?: string; provider?: string;
}) {
  const { id, title, discovered, published = discovered, sourceId = 'primary', text = body, backfill = false,
    status = 'completed', analyzedAt = discovered, importance = 'high', game = GAME, provider } = options;
  return prisma.feedItem.create({
    data: {
      id, sourceId, title, game, sourceType: 'official_site', itemKind: 'official_post', content: text,
      url: `https://example.test/original/${id}`, contentHash: id, identityKey: id, isSourceBackfill: backfill,
      createdAt: date(discovered), fetchedAt: date(discovered), publishedAt: published ? date(published) : null,
      analysis: { create: {
        status, category: 'version', visibility: 'public', importance, provider,
        summary: '样本摘要：公告提供开放时段、资格和参与条件。', reason: '开放时段会影响参与安排。',
        analyzedAt: status === 'completed' ? date(analyzedAt) : null
      } }
    }
  });
}

describe('editorial reading cycle with isolated SQLite migrations', () => {
  let server: Server;
  let base: string;
  let savedSecret: string | undefined;

  beforeAll(async () => {
    savedSecret = process.env.ADMIN_JWT_SECRET;
    process.env.ADMIN_JWT_SECRET = 'isolated-test-secret-not-a-real-secret';
    const app = express();
    app.use(express.json());
    app.use('/reports', reportsRouter);
    app.use('/admin/reports', requireAdmin, adminReportsRouter);
    server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await prisma.$disconnect();
    if (savedSecret === undefined) delete process.env.ADMIN_JWT_SECRET;
    else process.env.ADMIN_JWT_SECRET = savedSecret;
  });

  beforeEach(async () => {
    await prisma.dailyEdition.deleteMany();
    await prisma.source.deleteMany();
    await prisma.event.deleteMany();
    await prisma.setting.deleteMany();
  });

  test('applies Shanghai midnight, leaves old backfill/unknown/future articles out and carries late evidence forward', async () => {
    await source('primary');
    await source('broken');
    await check('primary', 'healthy', '2026-11-19T15:40:00Z');
    await check('primary', 'healthy', '2026-11-19T16:05:00Z');
    await check('broken', 'failed', '2026-11-19T16:06:00Z');

    await item({ id: 'before', title: '服务器异常调查公告', discovered: '2026-11-19T15:58:00Z' });
    await item({ id: 'late', title: '版本 1.3《新雾》更新公告', discovered: '2026-11-19T16:01:00Z', published: '2026-11-19T15:00:00Z' });
    await item({ id: 'backfill', title: '版本 1.2《旧雾》更新公告', discovered: '2026-11-19T16:02:00Z', published: '2026-11-16T15:00:00Z', backfill: true });
    await item({ id: 'backfill-recent', title: '版本 1.0《回填》更新公告', discovered: '2026-11-19T16:02:00Z', backfill: true });
    await item({ id: 'unknown', title: '版本 1.8《未知》更新公告', discovered: '2026-11-19T16:03:00Z', published: null });
    await item({ id: 'future', title: '版本 1.9《未来》更新公告', discovered: '2026-11-19T16:03:00Z', published: '2026-11-19T17:00:00Z' });
    await item({ id: 'delayed', title: '「归潮模式」新增系统详解', discovered: '2026-11-19T15:57:00Z', analyzedAt: '2026-11-19T16:01:00Z' });
    await item({ id: 'title-only', title: '停止运营通知', discovered: '2026-11-19T16:03:00Z', text: '停止运营通知' });
    await item({ id: 'failed', title: '部分玩家无法登录说明', discovered: '2026-11-19T16:04:00Z', status: 'failed' });
    await item({ id: 'no-key', title: '服务端停服时间调整', discovered: '2026-11-19T16:06:00Z', provider: 'fallback' });
    expect(shanghaiDate(firstClose)).toBe(next);
    expect(editionRange(previously).end.toISOString()).toBe('2026-11-19T15:59:59.999Z');
    await expect(publishDailyEdition(next, firstClose)).rejects.toThrow('Only completed Shanghai days');
    expect(await publishDailyEdition(previously, firstClose)).toBe('published');

    const prior = await readDailyEdition(previously);
    expect(prior.stories.map(card => card.sources[0].itemId)).toEqual(['before']);
    const today = await readFeatured(firstClose);
    expect(today.health).toMatchObject({ failedSources: 1, uncheckedSources: 0, failedAnalysis: 1, unavailableAnalysis: 1 });
    expect(today.stories.map(card => card.sources[0].itemId).sort()).toEqual(['delayed', 'failed', 'late', 'no-key', 'title-only']);
    const cards = new Map(today.stories.map(card => [card.sources[0].itemId, card]));
    expect(cards.get('late')?.editorial).toMatchObject({
      late: true, publishedAt: '2026-11-19T15:00:00.000Z', discoveredAt: '2026-11-19T16:01:00.000Z', selectedAt: null
    });
    expect(cards.get('title-only')).toMatchObject({ summary: null, editorial: { summaryStatus: 'insufficient', impact: null } });
    expect(cards.get('failed')).toMatchObject({ summary: null, editorial: { summaryStatus: 'failed', impact: null } });
    expect(cards.get('no-key')).toMatchObject({ summary: null, editorial: { summaryStatus: 'unavailable', impact: null } });
    expect(cards.get('late')).not.toHaveProperty('progress');
    expect(cards.get('late')?.items).toEqual([]);
  });

  test('publishes one snapshot per date and event, folds duplicates, and records a later substantiated report', async () => {
    await source('primary');
    await source('mirror');
    await item({ id: 'preview', title: '版本 1.3《巡海》前瞻', discovered: '2026-11-19T05:00:00Z' });
    await item({ id: 'duplicate', title: '版本 1.3《巡海》前瞻', sourceId: 'mirror', discovered: '2026-11-19T08:00:00Z' });
    await item({ id: 'another', title: '版本 1.4《灯塔》前瞻', discovered: '2026-11-19T05:00:01Z' });
    expect(await Promise.all([
      publishDailyEdition(previously, firstClose), publishDailyEdition(previously, firstClose)
    ])).toEqual(['published', 'published']);
    const sealed = await readDailyEdition(previously);
    expect(sealed.stories).toHaveLength(2);
    const first = sealed.stories.find(card => card.sources[0].itemId === 'preview')!;
    expect(first.editorial.selectedAt).toBe(firstClose.toISOString());
    expect(await prisma.dailyEdition.count()).toBe(1);

    await item({ id: 'duplicate-late', title: '版本 1.3《巡海》前瞻', sourceId: 'mirror', discovered: '2026-11-20T01:00:00Z' });
    await item({ id: 'release', title: '版本 1.3《巡海》更新公告', discovered: '2026-11-20T05:00:00Z' });
    expect(await publishDailyEdition(next, secondClose)).toBe('published');
    const update = (await readDailyEdition(next)).stories;
    expect(update).toHaveLength(1);
    expect(update[0]).toMatchObject({ id: first.id, editorial: { kind: 'update' }, sources: [{ itemId: 'release' }] });
    await prisma.feedItem.update({ where: { id: 'preview' }, data: { title: '后续标题修改' } });
    await prisma.feedItem.delete({ where: { id: 'preview' } });
    await prisma.$disconnect(); // Subsequent query reconnects with only persisted state.
    expect(await publishDailyEdition(previously, secondClose)).toBe('published');
    expect(await readDailyEdition(previously)).toEqual(sealed);
    expect(await prisma.dailyEdition.count()).toBe(2);
  });

  test('separates source/analysis failure and preserves a first successful empty snapshot across retries', async () => {
    await source('primary', 'failed');
    await check('primary', 'failed', '2026-11-19T06:00:00Z');
    expect(await publishDailyEdition(previously, firstClose)).toBe('failed');
    expect(await readDailyEdition(previously)).toMatchObject({ status: 'failed', publishedAt: null, health: { failedSources: 1 } });
    await check('primary', 'healthy', '2026-11-19T07:00:00Z');
    expect(await publishDailyEdition(previously, firstClose)).toBe('empty');
    await item({ id: 'post-seal', title: '服务器异常', discovered: '2026-11-19T03:00:00Z' });
    expect(await publishDailyEdition(previously, secondClose)).toBe('empty');
    expect(await readDailyEdition(previously)).toMatchObject({ status: 'empty', stories: [] });
  });

  test('returns the same ranked and visible view in both formats, including correction and withdrawal overlays', async () => {
    await source('primary');
    await item({ id: 'art-one', title: '版本 1.3《巡海》更新公告', discovered: '2026-11-19T05:00:00Z' });
    await item({ id: 'art-two', title: '版本 1.4《灯塔》更新公告', game: '另一作品', discovered: '2026-11-19T06:00:00Z' });
    await publishDailyEdition(previously, firstClose);
    const query = `date=${previously}&game=${encodeURIComponent(GAME)}&importance=high`;
    const jsonUrl = `${base}/reports/daily?${query}`;
    const mdUrl = `${base}/reports/export?${query}`;
    const result = await fetch(jsonUrl);
    const json = await result.json();
    const markdownResponse = await fetch(mdUrl);
    const markdown = await markdownResponse.text();
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(json).toMatchObject({ date: previously, meta: { timezone: 'Asia/Shanghai' }, summary: { total: 1 } });
    expect(markdownResponse.headers.get('content-type')).toContain('text/markdown');
    expect(markdown).toContain(json.stories[0].canonicalTitle);
    expect(markdown).toContain(json.stories[0].sources[0].url);
    expect(markdown).not.toContain('灯塔');
    expect(await fetch(mdUrl).then(resp => resp.text())).toBe(markdown);

    const moderator = `${base}/admin/reports/editions/${previously}/entries/${json.stories[0].id}`;
    const input = JSON.stringify({ action: 'correct', title: '更正后的标题', summary: '已核对原文。' });
    expect((await fetch(moderator, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: input })).status).toBe(401);
    expect((await fetch(moderator, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${createAdminToken()}` }, body: input
    })).status).toBe(204);
    expect(await fetch(jsonUrl).then(response => response.json())).toMatchObject({
      stories: [{ canonicalTitle: '更正后的标题', editorial: { correctedAt: expect.any(String) } }]
    });
    expect(await fetch(mdUrl).then(resp => resp.text())).toContain('更正后的标题');

    await prisma.feedItem.update({ where: { id: 'art-one' }, data: { hidden: true } });
    await prisma.feedItem.delete({ where: { id: 'art-one' } });
    expect(await fetch(jsonUrl).then(response => response.json())).toMatchObject({ withdrawnCount: 1, stories: [] });
    const retracted = await fetch(mdUrl).then(resp => resp.text());
    expect(retracted).toContain('已撤回');
    expect(retracted).not.toMatch(/巡海|更正后的标题|example\.test\/original\/art-one/);
    expect((await fetch(`${base}/reports/daily?date=2026-02-31`)).status).toBe(400);
    expect((await fetch(`${base}/reports/export?date=2000-01-01`)).status).toBe(409);
    expect(await prisma.dailyEdition.count()).toBe(1); // public reads never generate editions
  });

  test('caps selection at eight without treating official identity as sufficient', async () => {
    await source('primary');
    for (let i = 0; i < 10; i++) {
      await item({
        id: `rank-${i}`, title: `版本 2.${i}《独立情报${i}》更新公告`,
        discovered: `2026-11-19T07:0${i}:00Z`
      });
    }
    await item({ id: 'birthday', title: '角色卡塔莉娜生日贺图', discovered: '2026-11-19T08:00:00Z' });
    await item({ id: 'other-game', title: '《另一作品》开服公告', game: '另一作品', discovered: '2026-11-19T07:00:00Z' });
    const filtered = await readFeatured(date('2026-11-19T12:00:00Z'), { game: '另一作品' });
    expect(filtered.stories.map(entry => entry.sources[0].itemId)).toEqual(['other-game']);
    await publishDailyEdition(previously, firstClose);
    const issue = await readDailyEdition(previously);
    expect(issue.stories).toHaveLength(8);
    expect(issue.stories.map(entry => entry.sources[0].itemId)).toEqual([
      'rank-9', 'rank-8', 'rank-7', 'rank-6', 'rank-5', 'rank-4', 'rank-3', 'rank-2'
    ]);
  });
  test('prefers grounded first-day corroboration and never promotes the same stage the next day', async () => {
    const headline = '版本 2.2《霜雾》更新公告';
    await source('primary');
    await source('mirror');
    await item({ id: 'weak', title: headline, sourceId: 'mirror', discovered: '2026-11-19T05:00:00Z', text: headline });
    await item({ id: 'grounded', title: headline, discovered: '2026-11-19T06:00:00Z' });
    await publishDailyEdition(previously, firstClose);
    expect((await readDailyEdition(previously)).stories).toMatchObject([{
      editorial: { kind: 'new', summaryStatus: 'available' }, sources: [{ itemId: 'grounded' }]
    }]);
    await item({ id: 'mirror-next', title: headline, sourceId: 'mirror', discovered: '2026-11-20T05:00:00Z' });
    expect((await readFeatured(date('2026-11-20T09:00:00Z'))).stories).toHaveLength(0);
  });

  test('labels material follow-up as progress even when the older event was never in an issue', async () => {
    await source('primary');
    await item({ id: 'historical-guide', title: '版本 1.5《无风》版本指南', discovered: '2026-11-19T07:00:00Z', backfill: true });
    await item({ id: 'new-notice', title: '版本 1.5《无风》更新公告', discovered: '2026-11-20T06:00:00Z' });
    const live = await readFeatured(date('2026-11-20T10:00:00Z'));
    expect(live.stories).toMatchObject([{ editorial: { kind: 'update' }, sources: [{ itemId: 'new-notice' }] }]);
  });
});
