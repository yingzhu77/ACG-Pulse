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
import { ensureFTS5, isFTS5Ready } from '../search.js';

const game = '终末地-事件验收';
const run = randomUUID();
const start = Date.parse('2026-11-15T01:00:00Z');
const at = (hour: number) => new Date(start + hour * 3_600_000);
let sourceId: string;
let secondSourceId: string;
let server: ReturnType<ReturnType<typeof express>['listen']>;
let base: string;

async function add(input: { n: string; title: string; hour: number; url?: string; source?: string; body?: string; category?: string; itemKind?: string }) {
  return prisma.feedItem.create({ data: {
    sourceId: input.source || sourceId,
    game,
    sourceType: 'rss',
    itemKind: input.itemKind || 'official_post',
    externalId: input.n,
    title: input.title,
    content: input.body || `测试材料：${input.title}。玩家需要完成序章后查看新增区域。`,
    url: input.url || `https://fixture.example/edition/${input.n}`,
    contentHash: `${run}-${input.n}`,
    publishedAt: at(input.hour),
    createdAt: at(input.hour + 0.01),
    fetchedAt: at(input.hour + 0.01),
    analysis: { create: {
      status: 'completed', category: input.category || 'version', importance: 'high', visibility: 'public',
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

  it('keeps materially different official hotfix reports in one event without repeated bulletins', async () => {
    const launch = await add({ n: 'hotfix-anchor', title: '《极昼》2.1 版本更新说明', hour: 40 });
    await syncEvents();
    const one = await add({ n: 'hotfix-first', title: '《极昼》2.1 版本热修公告', hour: 44,
      body: '修复了在中继站接取护送任务时无法进入极昼港的问题。' });
    const two = await add({ n: 'hotfix-second', title: '《极昼》2.1 版本热修公告', hour: 51,
      body: '背景说明。'.repeat(65) + '修复了切换无障碍设置后无法打开仓库的问题，恢复领取补给奖励。' });
    const copy = await add({ n: 'hotfix-copy', title: '《极昼》2.1 版本热修同步公告', hour: 55,
      body: '修复了切换无障碍设置后无法打开仓库的问题，恢复领取补给奖励！' });
    const vague = await add({ n: 'hotfix-vague', title: '《极昼》2.1 版本热修公告', hour: 59,
      body: '请以官方公告为准，感谢您的支持。' });
    const thirdParty = await add({ n: 'hotfix-not-official', title: '《极昼》2.1 热修小道消息', hour: 61,
      body: '传闻今日还修复了边境地图坠落问题。', source: secondSourceId });
    const sameOrigin = await add({ n: 'hotfix-retry', title: '《极昼》2.1 版本热修（标题调整）', hour: 63,
      body: '修复了边境地图坠落问题。', url: `${two.url}?utm_source=retry` });
    const generic = await add({ n: 'hotfix-generic', title: '《极昼》2.1 版本热修', hour: 65,
      body: '这次我们修复了玩家们反馈的部分已知问题。' });
    await syncEvents();
    const id = (await prisma.feedItem.findUniqueOrThrow({ where: { id: launch.id } })).eventId!;
    const reads = await Promise.all([one, two, copy, vague, thirdParty, sameOrigin, generic]
      .map(row => prisma.feedItem.findUniqueOrThrow({ where: { id: row.id } })));
    expect(reads.map(row => [row.eventId, row.eventProgress])).toEqual([
      [id, true], [id, true], [id, false], [id, false], [id, false], [id, false], [id, false]
    ]);
    expect((await eventProjection(id))?.progress.map(item => item.id)).toEqual([two.id, one.id]);
  });

  it('links an explicit official version PV to launch but does not absorb character PV, creator campaigns or another version', async () => {
    const pv = await add({ n: 'version-pv', title: '《星港》1.4 版本前瞻', category: 'pv', hour: 72 });
    const launch = await add({ n: 'version-launch', title: '《星港》1.4 版本正式上线公告', hour: 98 });
    const character = await add({ n: 'character-pv', title: '《星港》1.4 版本角色PV · 涟漪', category: 'pv', hour: 99 });
    const creator = await add({ n: 'version-creator', title: '《星港》1.4 版本创作者征集活动', category: 'event', hour: 100 });
    const otherVersion = await add({ n: 'other-version', title: '《星港》1.5 版本正式上线公告', hour: 101 });
    const unofficial = await add({ n: 'unofficial-version-pv', title: '《星港》1.4 版本PV二次解析',
      category: 'pv', source: secondSourceId, itemKind: 'creator_video', hour: 102 });
    const vague = await add({ n: 'vague-pv', title: '终末地 · 特别PV', category: 'pv', hour: 103 });
    const otherCampaign = await add({ n: 'other-campaign', title: '《回声》1.4 版本PV', category: 'pv', hour: 104 });
    await syncEvents();
    const id = (await prisma.feedItem.findUniqueOrThrow({ where: { id: pv.id } })).eventId!;
    expect(await prisma.feedItem.findUniqueOrThrow({ where: { id: launch.id } }))
      .toMatchObject({ eventId: id, eventProgress: true });
    const unrelated = await Promise.all([character, creator, otherVersion, unofficial, vague, otherCampaign]
      .map(row => prisma.feedItem.findUniqueOrThrow({ where: { id: row.id } })));
    expect(unrelated.every(row => row.eventId && row.eventId !== id)).toBe(true);
    expect((await eventProjection(id))?.progress.map(item => item.id)).toEqual([launch.id]);
  });


  it('compares concrete repeatable facts rather than date, wording or bulletin URLs', async () => {
    const launch = await add({ n: 'land-anchor', title: '《风洞》4.1 版本更新说明', hour: 109 });
    const notices = await Promise.all([
      add({ n: 'land-refund', title: '《风洞》4.1 版本补偿公告', hour: 110, body: '给受影响玩家补偿 300 嵌晶玉。' }),
      add({ n: 'land-refund-copy', title: '《风洞》4.1 版本补偿同步', hour: 111, body: '发放：嵌晶玉 × 300。' }),
      add({ n: 'land-refund-addition', title: '《风洞》4.1 版本追加补偿', hour: 112, body: '对仍无法登录的玩家发放 500 嵌晶玉。' }),
      add({ n: 'land-delay', title: '《风洞》4.1 版本延期公告', hour: 113, body: '将北门开放延期至11月20日14:00。' }),
      add({ n: 'land-delay-copy', title: '《风洞》4.1 版本延期说明', hour: 114, body: '将北门开放推迟至 11月20日 14：00。' }),
      add({ n: 'land-delay-again', title: '《风洞》4.1 版本延期调整', hour: 115, body: '将北门开放顺延至 11月21日 10:00。' }),
      add({ n: 'land-correct', title: '《风洞》4.1 版本公告更正', hour: 116, body: '将仓库入口改为物资页。' }),
      add({ n: 'land-correct-again', title: '《风洞》4.1 版本更正公告', hour: 117, body: '将故障补偿发放时间更正为11月22日 14:00。' })
    ]);
    await syncEvents();
    const id = (await prisma.feedItem.findUniqueOrThrow({ where: { id: launch.id } })).eventId!;
    const rows = await Promise.all(notices.map(row => prisma.feedItem.findUniqueOrThrow({ where: { id: row.id } })));
    expect(rows.every(row => row.eventId === id)).toBe(true);
    expect(rows.map(row => row.eventProgress)).toEqual([true, false, true, true, false, true, true, true]);
  });

  it('finds literal Chinese fragments alongside indexed tokens while keeping public visibility and pagination', async () => {
    const channel = await prisma.source.create({ data: {
      name: '北港通讯编辑部', game, type: 'rss', isOfficial: true
    } });
    const fragment = await add({ n: 'harbor-fragment', title: '《北弦计划》9.2 雾钟码头入口推迟开放',
      body: '计划代号 Pier_17，修复进度达到 95%。', hour: 160, source: channel.id });
    await add({ n: 'harbor-complete', title: '「雾钟码头」灯塔建筑设计稿', hour: 161, source: channel.id });
    const hidden = await add({ n: 'harbor-hide', title: '「雾钟码头」未公开报道', hour: 162, source: channel.id });
    await prisma.feedItem.update({ where: { id: hidden.id }, data: { hidden: true } });
    await ensureFTS5();
    expect(await isFTS5Ready()).toBe(true);
    const request = async (path: string, q: string, page = 1) => {
      const params = new URLSearchParams({ sourceId: channel.id, q, limit: '1', page: String(page) });
      const response = await fetch(`${base}/${path}?${params}`);
      expect(response.status).toBe(200);
      return response.json();
    };
    for (const path of ['items', 'stories']) {
      const first = await request(path, '雾钟码头');
      const second = await request(path, '雾钟码头', 2);
      expect(first.pagination).toMatchObject({ total: 2, totalPages: 2 });
      expect(second.data[0].title ?? second.data[0].canonicalTitle).toBe(fragment.title);
      expect(first.data[0].id).not.toBe(second.data[0].id);
      expect((await request(path, '通讯编辑')).pagination.total).toBe(2);
      expect((await request(path, fragment.title)).pagination.total).toBe(1);
      expect((await request(path, '%')).pagination.total).toBe(1);
      expect((await request(path, '_')).pagination.total).toBe(1);
    }
  });

});
