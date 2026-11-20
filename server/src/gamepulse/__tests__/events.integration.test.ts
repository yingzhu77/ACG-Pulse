import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { vi } from 'vitest';

vi.mock('../../db.js', async () => {
  const { PrismaClient } = await import('@prisma/client');
  const { join } = await import('node:path');
  const base = process.env.ACG_PULSE_TEST_DATABASE_URL!;
  const target = join(process.env.ACG_PULSE_TEST_TEMP_ROOT!, 'events.db');
  const template = new PrismaClient({ datasourceUrl: base });
  try {
    await template.$executeRaw`VACUUM INTO ${target}`;
  } finally {
    await template.$disconnect();
  }
  return { prisma: new PrismaClient({ datasourceUrl: `file:${target}` }) };
});

import { prisma } from '../../db.js';
import { archiveFeedOverflow, eventProjection, splitEventItem, syncEvents } from '../services/events.js';
import { aggregateFeedItemsToStories } from '../storyAggregation.js';
import storiesRouter from '../routes/stories.js';

const game = '终末地-事件验收';
const run = randomUUID();
const start = Date.parse('2026-11-15T01:00:00Z');
const at = (hour: number) => new Date(start + hour * 3_600_000);
let sourceId: string;
let secondSourceId: string;
let server: ReturnType<ReturnType<typeof express>['listen']>;
let base: string;

async function add(input: { n: string; title: string; hour: number; url?: string; source?: string; body?: string }) {
  return prisma.feedItem.create({ data: {
    sourceId: input.source || sourceId,
    game,
    sourceType: 'rss',
    externalId: input.n,
    title: input.title,
    content: input.body || `测试材料：${input.title}。玩家需要完成序章后查看新增区域。`,
    url: input.url || `https://fixture.example/edition/${input.n}`,
    contentHash: `${run}-${input.n}`,
    publishedAt: at(input.hour),
    createdAt: at(input.hour + 0.01),
    fetchedAt: at(input.hour + 0.01),
    analysis: { create: {
      status: 'completed', category: 'version', importance: 'high', visibility: 'public',
      summary: '区域开放前需要完成序章。', reason: '影响玩家前往新区域',
      dedupKeywords: '["官方","公告","版本","更新"]'
    } }
  }, include: { source: true, analysis: true } });
}

beforeAll(async () => {
  const files = await prisma.$queryRawUnsafe<Array<{ file: string }>>('PRAGMA database_list');
  expect(files[0].file).toBe(join(process.env.ACG_PULSE_TEST_TEMP_ROOT!, 'events.db'));
  // The clone is separate, so remove any unrelated rows snapshotted from shared tests.
  await prisma.source.deleteMany();
  await prisma.event.deleteMany();
  await prisma.setting.deleteMany({ where: { key: 'persistent_event_legacy_bridge_v1' } });
  sourceId = (await prisma.source.create({ data: { name: `官方 ${run}`, game, type: 'rss', isOfficial: true } })).id;
  secondSourceId = (await prisma.source.create({ data: { name: `社区转述 ${run}`, game, type: 'rss' } })).id;
  const app = express();
  app.use(storiesRouter);
  server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve());
  await prisma.$disconnect();
});

describe('persistent events and archive', () => {
  it('keeps IDs across new same-event coverage, title edits, filters, and DB reconnect', async () => {
    const primary = await add({ n: 'preview', title: '《丹青渡》1.1 版本前瞻', hour: 0 });
    const legacy = aggregateFeedItemsToStories([primary])[0].id;
    await Promise.all([syncEvents(), syncEvents()]);
    const id = (await prisma.feedItem.findUniqueOrThrow({ where: { id: primary.id } })).eventId!;
    expect(id).toMatch(/^evt_/);
    expect(await eventProjection(legacy)).toMatchObject({ id, progress: [], lastProgressAt: null });

    const copied = await add({
      n: 'repost', title: '不同标题的转述', hour: 1,
      url: `${primary.url}?utm_source=repost`, source: secondSourceId
    });
    const patch = await add({ n: 'patch', title: '《丹青渡》1.1 版本更新说明', hour: 26 });
    const unrelated = await add({ n: 'contest', title: '《丹青渡》1.1 创作者征集活动', hour: 27 });
    const differentEvent = await add({ n: 'different', title: '《海风港》1.1 版本活动指南', hour: 28 });
    await Promise.all([syncEvents(), syncEvents()]);
    await prisma.feedItem.update({ where: { id: primary.id }, data: { title: '《丹青渡》1.1 版本前瞻（标题更正）' } });

    const members = await prisma.feedItem.findMany({ where: { source: { game } } });
    expect(members.find(item => item.id === copied.id)).toMatchObject({ eventId: id, eventProgress: false });
    expect(members.find(item => item.id === patch.id)).toMatchObject({ eventId: id, eventProgress: true });
    expect(members.find(item => item.id === unrelated.id)?.eventId).not.toBe(id);
    expect(members.find(item => item.id === differentEvent.id)?.eventId).not.toBe(id);
    const first = await (await fetch(`${base}/stories?sourceId=${sourceId}`)).json();
    const second = await (await fetch(`${base}/stories?sourceId=${secondSourceId}`)).json();
    expect(first.data.some((row: { id: string }) => row.id === id)).toBe(true);
    expect(second.data).toHaveLength(1);
    expect(second.data[0].id).toBe(id);

    const independent = new PrismaClient({ datasourceUrl: `file:${join(process.env.ACG_PULSE_TEST_TEMP_ROOT!, 'events.db')}` });
    try {
      expect((await independent.feedItem.findUniqueOrThrow({ where: { id: primary.id } })).eventId).toBe(id);
      expect(await independent.event.count({ where: { game } })).toBe(3);
    } finally {
      await independent.$disconnect();
    }
    const detail = await (await fetch(`${base}/stories/${id}`)).json();
    expect(detail.data).toMatchObject({ id, itemCount: 2, firstPublishedAt: at(0).toISOString(), lastProgressAt: at(26).toISOString() });
    expect(detail.data.progress.map((item: { id: string }) => item.id)).toEqual([patch.id]);

    await archiveFeedOverflow(1);
    expect(await prisma.feedItem.count({ where: { game, eventArchived: false, hidden: false } })).toBe(1);
    expect((await eventProjection(legacy))?.id).toBe(id);
    expect((await eventProjection(id))?.sources.map(source => source.url)).toContain(primary.url);
    expect((await eventProjection(id))?.progress.map(item => item.id)).toContain(patch.id);
    expect(await prisma.feedItem.findUnique({ where: { id: copied.id } })).toBeNull();

    const newId = await splitEventItem(patch.id);
    expect(newId).not.toBe(id);
    expect(await splitEventItem(patch.id)).toBe(newId);
    expect((await eventProjection(id))?.items.map(item => item.id)).toEqual([primary.id]);
    expect(await eventProjection(legacy)).toBeNull();
    const correctedCopy = await add({ n: 'corrected-copy', title: '转述更新说明', hour: 30, url: patch.url, source: secondSourceId });
    await syncEvents();
    expect(await prisma.feedItem.findUnique({ where: { id: correctedCopy.id } })).toMatchObject({
      eventId: newId,
      eventProgress: false
    });

    await prisma.feedItem.update({ where: { id: primary.id }, data: { hidden: true } });
    expect((await fetch(`${base}/stories/${id}`)).status).toBe(404);
  });
});
