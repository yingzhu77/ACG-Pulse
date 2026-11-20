import { afterAll, beforeAll, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { join } from 'node:path';
import { applyEventRepair, previewEventRepair } from '../services/eventRepair.js';

const fixture = join(process.env.ACG_PULSE_TEST_TEMP_ROOT!, 'event-repair.db');
const db = new PrismaClient({ datasourceUrl: `file:${fixture}` });
const day = 86_400_000;
const t0 = Date.parse('2026-11-10T02:00:00Z');
const date = (days: number) => new Date(t0 + day * days);
const scope = { since: date(0), until: date(6), game: '修正验收' };
const game = scope.game;
let sourceId: string;

beforeAll(async () => {
  const template = new PrismaClient({ datasourceUrl: process.env.ACG_PULSE_TEST_DATABASE_URL });
  try { await template.$executeRaw`VACUUM INTO ${fixture}`; }
  finally { await template.$disconnect(); }
  const files = await db.$queryRaw<Array<{ file: string }>>`PRAGMA database_list`;
  expect(files[0].file).toBe(fixture);
  sourceId = (await db.source.create({ data: { name: game, game, type: 'rss', isOfficial: true } })).id;
});
afterAll(() => db.$disconnect());

async function event(id: string, days = 0) {
  return db.event.create({ data: { id, game, createdAt: date(days) } });
}
async function add(id: string, eventId: string, title: string, days: number, opts: {
  category?: string; body?: string; progress?: boolean; split?: boolean
} = {}) {
  return db.feedItem.create({ data: {
    id, sourceId, game, eventId, sourceType: 'rss', title,
    url: `https://fixture.test/original/${id}`, contentHash: id,
    content: opts.body ?? '本篇为官方版本公告，开放区域及玩法列表以游戏内更新为准。',
    createdAt: date(days), publishedAt: date(days),
    eventProgress: opts.progress ?? true, eventSplit: opts.split ?? false,
    analysis: { create: { status: 'completed', category: opts.category ?? 'version', visibility: 'public', importance: 'high' } }
  } });
}

it('previews narrowly, preserves originals and manual decisions, keeps old aliases and frozen snapshots', async () => {
  await event('evt_preview');
  await event('evt_old_launch', 1.1);
  await event('evt_protected_preview');
  await event('evt_protected_launch', 1.1);
  await event('evt_manual_preview');
  await event('evt_manual_launch', 1.1);
  await event('evt_outside', -60);
  await event('evt_outside_launch', -59);
  const first = await add('preview', 'evt_preview', '《星港》1.4 版本前瞻', 0, { category: 'pv' });
  const launch = await add('launch', 'evt_old_launch', '《星港》1.4 版本正式上线', 1.1);
  await add('hotfix-one', 'evt_preview', '《星港》1.4 版本热修', 2, { body: '修复车站大门无法开启的问题；更新后可进入北站。' });
  const second = await add('hotfix-two', 'evt_preview', '《星港》1.4 版本热修', 3, {
    progress: false, body: '修复港口电梯无法到达底层的问题；更新后可到达货运区。'
  });
  await add('hotfix-copy', 'evt_preview', '《星港》1.4 版本热修（转载）', 3.1, {
    progress: false, body: '修复港口电梯无法到达底层的问题；更新后可到达货运区。'
  });
  await add('protected-preview', 'evt_protected_preview', '《浮桥》1.8 版本前瞻', 0, { category: 'pv' });
  const protectedLaunch = await add('protected-launch', 'evt_protected_launch', '《浮桥》1.8 版本正式上线', 1.1);
  await add('manual-preview', 'evt_manual_preview', '《海湾》1.7 版本前瞻', 0, { category: 'pv' });
  await add('manual-launch', 'evt_manual_launch', '《海湾》1.7 版本正式上线', 1.1, { split: true });
  await add('old-preview', 'evt_outside', '《远山》1.9 版本前瞻', -60, { category: 'pv' });
  await add('old-launch', 'evt_outside_launch', '《远山》1.9 版本正式上线', -59);
  await db.eventAlias.create({ data: { id: 'story_old_launch', eventId: 'evt_old_launch' } });
  for (const [evidence, editionDate] of [[first, '2026-11-10'], [protectedLaunch, '2026-11-11']] as const) {
    await db.dailyEdition.create({ data: {
      date: editionDate, status: 'published', publishedAt: date(4), health: {},
      entries: { create: { eventId: evidence.eventId!, feedItemId: evidence.id, sourceId, rank: 0, discoveredAt: date(2),
        story: { frozen: evidence.title }, correction: { title: '已人工更正', summary: null }, correctedAt: date(4) } }
    } });
  }
  const snapshots = () => db.dailyEdition.findMany({ orderBy: { date: 'asc' }, include: { entries: true } });
  const frozen = await snapshots();
  const plan = await previewEventRepair(db, scope);
  expect(plan.merges).toEqual([{ oldId: 'evt_old_launch', targetId: 'evt_preview', itemIds: ['launch'] }]);
  expect(plan.promotions).toEqual([{ id: second.id, eventId: 'evt_preview' }]);
  await expect(applyEventRepair(db, scope, 'different')).rejects.toThrow(/fingerprint/i);
  expect(await db.feedItem.findUnique({ where: { id: launch.id } })).toEqual(launch);
  await applyEventRepair(db, scope, plan.fingerprint);
  expect(await db.feedItem.findUnique({ where: { id: launch.id } }))
    .toMatchObject({ eventId: 'evt_preview', eventProgress: true, url: launch.url, content: launch.content, updatedAt: launch.updatedAt });
  expect(await db.feedItem.findUnique({ where: { id: second.id } })).toMatchObject({ eventProgress: true });
  expect(await db.feedItem.findUnique({ where: { id: 'hotfix-copy' } })).toMatchObject({ eventProgress: false });
  expect(await db.feedItem.findUnique({ where: { id: 'manual-launch' } })).toMatchObject({ eventId: 'evt_manual_launch', eventSplit: true });
  expect(await db.eventAlias.findMany({ where: { eventId: 'evt_preview' }, orderBy: { id: 'asc' } }))
    .toEqual([{ id: 'evt_old_launch', eventId: 'evt_preview' }, { id: 'story_old_launch', eventId: 'evt_preview' }]);
  expect(await snapshots()).toEqual(frozen);
  const again = await previewEventRepair(db, scope);
  expect(again).toMatchObject({ merges: [], promotions: [] });
  await applyEventRepair(db, scope, again.fingerprint);
  expect(await snapshots()).toEqual(frozen);
});

it('rejects a repair scope wider than 30 days', async () => {
  await expect(previewEventRepair(db, { since: date(-30), until: date(1) })).rejects.toThrow(/30/);
});
