import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

interface MockRawItem {
  externalId: string;
  itemKind: string;
  title: string;
  content: string;
  url: string;
  publishedAt?: Date;
}

interface ProviderResult {
  analysis: {
    category: string;
    importance: string;
    visibility: string;
    confidence: number;
    summary: string;
    reason: string;
    dedupKeywords: string[];
  };
  provider: string;
  model: string;
}

const mocks = vi.hoisted(() => {
  const providerInputs: Array<{ title: string; content: string }> = [];
  const deferredCalls: Array<{ input: { title: string; content: string }; resolve: (value: ProviderResult) => void }> = [];
  let providerMode: 'success' | 'deferred' | 'reject' = 'success';
  let afterEnsureAnalysis: (() => Promise<void>) | null = null;
  let adapterItems: MockRawItem[] = [];

  const analyzeWithProvider = vi.fn((input: { title: string; content: string }) => {
    providerInputs.push(input);
    const result: ProviderResult = {
      analysis: {
        category: 'announcement',
        importance: 'medium',
        visibility: 'public',
        confidence: 80,
        summary: `已分析:${input.content.slice(0, 24)}`,
        reason: '集成测试模拟结果',
        dedupKeywords: []
      },
      provider: 'mock',
      model: 'mock-model'
    };
    if (providerMode === 'reject') return Promise.reject(new Error('mock provider failure'));
    if (providerMode === 'deferred') {
      return new Promise<ProviderResult>(resolve => deferredCalls.push({ input, resolve }));
    }
    return Promise.resolve(result);
  });

  return {
    providerInputs,
    deferredCalls,
    analyzeWithProvider,
    setProviderMode(mode: 'success' | 'deferred' | 'reject') {
      providerMode = mode;
    },
    setAfterEnsureAnalysis(hook: (() => Promise<void>) | null) {
      afterEnsureAnalysis = hook;
    },
    runAfterEnsureAnalysis() {
      const hook = afterEnsureAnalysis;
      if (!hook) return Promise.resolve();
      afterEnsureAnalysis = null;
      return hook();
    },
    setAdapterItems(items: MockRawItem[]) {
      adapterItems = items;
    },
    getAdapterItems() {
      return adapterItems;
    },
    reset() {
      providerInputs.length = 0;
      deferredCalls.length = 0;
      providerMode = 'success';
      afterEnsureAnalysis = null;
      adapterItems = [];
      analyzeWithProvider.mockClear();
    }
  };
});

vi.mock('../adapters/registry.js', () => ({
  getAdapter: () => ({
    type: 'rss',
    fetch: () => Promise.resolve(mocks.getAdapterItems())
  })
}));

vi.mock('../../services/email.js', () => ({
  sendFeedItemEmail: vi.fn(async () => false)
}));

vi.mock('../ai/provider.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ai/provider.js')>();
  return { ...actual, analyzeWithProvider: mocks.analyzeWithProvider };
});

vi.mock('../ai/analyzer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ai/analyzer.js')>();
  return {
    ...actual,
    ensureAnalysis: async (...args: Parameters<typeof actual.ensureAnalysis>) => {
      const result = await actual.ensureAnalysis(...args);
      await mocks.runAfterEnsureAnalysis();
      return result;
    }
  };
});

vi.mock('../ai/analysisQueue.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ai/analysisQueue.js')>();
  return { ...actual, wakeAnalysisQueue: vi.fn() };
});

import { prisma } from '../../db.js';
import { clearRetryTimerForTest, createAnalysisTaskIfAbsent, processAnalysisQueue } from '../ai/analysisQueue.js';
import { getStalenessInfo, recordCommunitySourceResults } from '../db/communityDb.js';
import { runGamePulseCheck } from '../jobs/checker.js';
import { buildFeedItemIdentityKey } from '../itemIdentity.js';
import { contentHash } from '../utils.js';

const FAIL_TASK_TRIGGER = 'fail_analysis_task_insert';
const previousBatchDelay = process.env.ANALYSIS_BATCH_DELAY_MS;

beforeAll(() => {
  process.env.ANALYSIS_BATCH_DELAY_MS = '0';
});

afterAll(async () => {
  clearRetryTimerForTest();
  if (previousBatchDelay === undefined) delete process.env.ANALYSIS_BATCH_DELAY_MS;
  else process.env.ANALYSIS_BATCH_DELAY_MS = previousBatchDelay;
  await prisma.$disconnect();
});

async function resetDatabase(): Promise<void> {
  await prisma.notification.deleteMany();
  await prisma.sourceHealthLog.deleteMany();
  await prisma.analysisTask.deleteMany();
  await prisma.analysis.deleteMany();
  await prisma.feedItem.deleteMany();
  await prisma.source.deleteMany();
}

beforeEach(async () => {
  mocks.reset();
  await resetDatabase();
});

afterEach(async () => {
  clearRetryTimerForTest();
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${FAIL_TASK_TRIGGER}`);
});

function unique(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function publishedAt(): Date {
  return new Date('2026-10-01T00:00:00.000Z');
}

function rawItem(input: {
  externalId: string;
  url: string;
  title: string;
  content: string;
  publishedAt: Date;
}): MockRawItem {
  return {
    externalId: input.externalId,
    itemKind: 'official_post',
    title: input.title,
    content: input.content,
    url: input.url,
    publishedAt: input.publishedAt
  };
}

async function createSource() {
  return prisma.source.create({
    data: {
      id: unique('source'),
      name: unique('匿名测试源'),
      type: 'rss',
      game: unique('匿名游戏'),
      url: 'https://example.test/feed',
      enabled: true,
      priority: 10
    }
  });
}

async function seedFeedItem(input: {
  sourceId: string;
  game: string;
  externalId: string;
  url: string;
  title: string;
  content: string;
  publishedAt: Date;
}) {
  const identityKey = buildFeedItemIdentityKey({ externalId: input.externalId, url: input.url });
  return prisma.feedItem.create({
    data: {
      id: unique('item'),
      sourceId: input.sourceId,
      externalId: input.externalId,
      itemKind: 'official_post',
      game: input.game,
      title: input.title,
      content: input.content,
      url: input.url,
      authorName: undefined,
      sourceType: 'rss',
      identityKey,
      contentHash: contentHash([identityKey, input.title, input.content, input.publishedAt.toISOString()]),
      publishedAt: input.publishedAt
    }
  });
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 5000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

describe('real SQLite collection and analysis acceptance', () => {
  test('uses only the isolated temp database and never reads a real env file', async () => {
    const databaseUrl = process.env.ACG_PULSE_TEST_DATABASE_URL;
    const testRoot = process.env.ACG_PULSE_TEST_TEMP_ROOT;
    expect(databaseUrl).toBeTruthy();
    expect(testRoot).toBeTruthy();
    expect(process.env.DATABASE_URL).toBe(databaseUrl);

    const expectedDbFile = path.join(path.resolve(testRoot!), 'test.db');
    expect(path.resolve(databaseUrl!.replace(/^file:/, ''))).toBe(expectedDbFile);

    const databaseList = await prisma.$queryRawUnsafe<Array<{ file: string }>>('PRAGMA database_list');
    expect(databaseList).toHaveLength(1);
    expect(path.resolve(databaseList[0].file)).toBe(expectedDbFile);

    // A canary written through Prisma must land in the temp database, not an existing one.
    await prisma.setting.create({ data: { key: 'isolation-canary', value: 'temp-only' } });
    expect(await prisma.setting.findUnique({ where: { key: 'isolation-canary' } }))
      .toMatchObject({ value: 'temp-only' });

    const guard = (globalThis as {
      __ACG_PULSE_ENV_GUARD__?: { blockedExists: number; blockedReads: number; paths: string[] };
    }).__ACG_PULSE_ENV_GUARD__;
    expect(guard).toBeDefined();
    // Prisma probes server/.env while importing; the guard must intercept that probe.
    expect(guard!.blockedExists).toBeGreaterThan(0);
    expect(guard!.blockedReads).toBe(0);
    expect(guard!.paths.every(file => path.basename(file).startsWith('.env'))).toBe(true);
  });

  test('persists degraded community source health in the isolated database', async () => {
    const healthKey = 'COMMUNITY_SOURCE_HEALTH';
    await prisma.setting.deleteMany({ where: { key: healthKey } });
    try {
      await recordCommunitySourceResults([
        { source: 'bilibili', status: 'degraded', error: 'comments: anonymous timeout' },
        { source: 'nga', status: 'healthy' },
        { source: 'xiaoheihe', status: 'healthy' }
      ]);

      const stored = await prisma.setting.findUniqueOrThrow({ where: { key: healthKey } });
      expect(JSON.parse(stored.value)).toContainEqual(expect.objectContaining({
        source: 'bilibili', status: 'degraded', error: 'comments: anonymous timeout'
      }));
      expect(await getStalenessInfo('bilibili')).toMatchObject({ isStale: false, refreshDue: false });
    } finally {
      await prisma.setting.deleteMany({ where: { key: healthKey } });
    }
  });

  test('rolls back a new item when its analysis task cannot be written', async () => {
    const source = await createSource();
    const externalId = unique('external');
    const url = `https://example.test/${externalId}`;
    const fetchedAt = publishedAt();
    mocks.setAdapterItems([
      rawItem({
        externalId,
        url,
        title: '匿名新公告',
        content: '这是一条用于验证采集入队事务整体回滚的匿名公告正文。',
        publishedAt: fetchedAt
      })
    ]);

    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER ${FAIL_TASK_TRIGGER} BEFORE INSERT ON "AnalysisTask" `
      + `BEGIN SELECT RAISE(ABORT, 'forced analysis task failure'); END;`
    );

    const result = await runGamePulseCheck();

    expect(result.failedSources).toBe(1);
    expect(result.newItems).toBe(0);
    expect(await prisma.feedItem.count({ where: { sourceId: source.id } })).toBe(0);
    expect(await prisma.analysisTask.count({ where: { feedItem: { sourceId: source.id } } })).toBe(0);
    expect(await prisma.notification.count({ where: { feedItem: { sourceId: source.id } } })).toBe(0);

    const refreshed = await prisma.source.findUniqueOrThrow({ where: { id: source.id } });
    expect(refreshed.healthStatus).toBe('failed');
    expect(refreshed.lastSuccessAt).toBeNull();
  });

  test('rolls back a body update when its analysis task cannot be written', async () => {
    const source = await createSource();
    const externalId = unique('external');
    const url = `https://example.test/${externalId}`;
    const fetchedAt = publishedAt();
    const originalContent = '原始匿名正文，内容长度足够用于验证任务写入失败时的回滚。';
    const seeded = await seedFeedItem({
      sourceId: source.id,
      game: source.game,
      externalId,
      url,
      title: '匿名更新公告',
      content: originalContent,
      publishedAt: fetchedAt
    });
    mocks.setAdapterItems([
      rawItem({
        externalId,
        url,
        title: '匿名更新公告',
        content: '更新后的匿名正文，内容长度足够用于验证任务写入失败时的回滚。',
        publishedAt: fetchedAt
      })
    ]);

    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER ${FAIL_TASK_TRIGGER} BEFORE INSERT ON "AnalysisTask" `
      + `BEGIN SELECT RAISE(ABORT, 'forced analysis task failure'); END;`
    );

    const result = await runGamePulseCheck();

    expect(result.failedSources).toBe(1);
    const latest = await prisma.feedItem.findUniqueOrThrow({ where: { id: seeded.id } });
    expect(latest.content).toBe(originalContent);
    expect(await prisma.analysisTask.count({ where: { feedItemId: seeded.id } })).toBe(0);
  });

  test('analyzes the latest body when content changes while the provider is waiting', async () => {
    const source = await createSource();
    const externalId = unique('external');
    const url = `https://example.test/${externalId}`;
    const fetchedAt = publishedAt();
    const firstVersion = '第一版匿名正文，包含足够长度以触发完整分析流程。';
    const secondVersion = '第二版匿名正文，在 AI 等待期间更新，必须得到最新分析。';
    const seeded = await seedFeedItem({
      sourceId: source.id,
      game: source.game,
      externalId,
      url,
      title: '匿名版本公告',
      content: firstVersion,
      publishedAt: fetchedAt
    });
    expect(await createAnalysisTaskIfAbsent(seeded.id)).toBe(true);

    mocks.setProviderMode('deferred');
    const processing = processAnalysisQueue();
    await waitFor(() => mocks.deferredCalls.length === 1, 'the first provider call');
    expect(mocks.providerInputs[0].content).toBe(firstVersion);

    mocks.setAdapterItems([
      rawItem({
        externalId,
        url,
        title: '匿名版本公告',
        content: secondVersion,
        publishedAt: fetchedAt
      })
    ]);
    const check = await runGamePulseCheck();
    expect(check.failedSources).toBe(0);
    expect((await prisma.feedItem.findUniqueOrThrow({ where: { id: seeded.id } })).content)
      .toBe(secondVersion);

    const firstCall = mocks.deferredCalls[0];
    firstCall.resolve({
      analysis: {
        category: 'announcement',
        importance: 'low',
        visibility: 'public',
        confidence: 50,
        summary: '第一版过期分析',
        reason: '模拟旧版本结果',
        dedupKeywords: []
      },
      provider: 'mock',
      model: 'mock-model'
    });

    await waitFor(() => mocks.deferredCalls.length === 2, 'the second provider call');
    expect(mocks.providerInputs[1].content).toBe(secondVersion);
    mocks.deferredCalls[1].resolve({
      analysis: {
        category: 'announcement',
        importance: 'medium',
        visibility: 'public',
        confidence: 80,
        summary: '第二版最新分析',
        reason: '模拟最新结果',
        dedupKeywords: []
      },
      provider: 'mock',
      model: 'mock-model'
    });
    await processing;

    const analysis = await prisma.analysis.findUniqueOrThrow({ where: { feedItemId: seeded.id } });
    expect(analysis.status).toBe('completed');
    expect(analysis.summary).toBe('第二版最新分析');
    const task = await prisma.analysisTask.findFirstOrThrow({ where: { feedItemId: seeded.id } });
    expect(task).toMatchObject({ status: 'completed', dedupeKey: null });
  });

  test('does not lose the follow-up analysis when content changes after the result write', async () => {
    const source = await createSource();
    const externalId = unique('external');
    const url = `https://example.test/${externalId}`;
    const fetchedAt = publishedAt();
    const firstVersion = '结果写入阶段的旧正文，长度足够触发完整分析流程。';
    const secondVersion = '结果写入之后更新的新正文，不能遗漏后续分析任务。';
    const seeded = await seedFeedItem({
      sourceId: source.id,
      game: source.game,
      externalId,
      url,
      title: '匿名竞态公告',
      content: firstVersion,
      publishedAt: fetchedAt
    });
    expect(await createAnalysisTaskIfAbsent(seeded.id)).toBe(true);

    let hookRuns = 0;
    mocks.setAfterEnsureAnalysis(async () => {
      hookRuns++;
      mocks.setAdapterItems([
        rawItem({
          externalId,
          url,
          title: '匿名竞态公告',
          content: secondVersion,
          publishedAt: fetchedAt
        })
      ]);
      const check = await runGamePulseCheck();
      expect(check.failedSources).toBe(0);
    });

    await processAnalysisQueue();

    expect(hookRuns).toBe(1);
    expect(mocks.providerInputs.map(input => input.content)).toEqual([firstVersion, secondVersion]);
    const analysis = await prisma.analysis.findUniqueOrThrow({ where: { feedItemId: seeded.id } });
    expect(analysis.status).toBe('completed');
    expect(analysis.summary).toContain(secondVersion.slice(0, 24));
    const task = await prisma.analysisTask.findFirstOrThrow({ where: { feedItemId: seeded.id } });
    expect(task).toMatchObject({ status: 'completed', dedupeKey: null });
  });

  test('dedupes open tasks and does not requeue a terminal failure on a normal recrawl', async () => {
    const source = await createSource();
    const externalId = unique('external');
    const url = `https://example.test/${externalId}`;
    const fetchedAt = publishedAt();
    const content = '终态失败测试正文，内容长度足够触发完整分析流程。';
    const seeded = await seedFeedItem({
      sourceId: source.id,
      game: source.game,
      externalId,
      url,
      title: '匿名终态公告',
      content,
      publishedAt: fetchedAt
    });

    const previousMaxRetries = process.env.ANALYSIS_TASK_MAX_RETRIES;
    process.env.ANALYSIS_TASK_MAX_RETRIES = '0';
    let failedTaskId = '';
    try {
      expect(await createAnalysisTaskIfAbsent(seeded.id)).toBe(true);
      expect(await createAnalysisTaskIfAbsent(seeded.id)).toBe(false);
      await expect(prisma.analysisTask.create({
        data: { feedItemId: seeded.id, dedupeKey: seeded.id }
      })).rejects.toMatchObject({ code: 'P2002' });
      expect(await prisma.analysisTask.count({ where: { feedItemId: seeded.id } })).toBe(1);

      mocks.setProviderMode('reject');
      await processAnalysisQueue();

      const failedTask = await prisma.analysisTask.findFirstOrThrow({ where: { feedItemId: seeded.id } });
      failedTaskId = failedTask.id;
      expect(failedTask).toMatchObject({ status: 'failed', retryCount: 1, dedupeKey: null });
      expect(failedTask.nextRunAt.getUTCFullYear()).toBe(9999);
    } finally {
      if (previousMaxRetries === undefined) delete process.env.ANALYSIS_TASK_MAX_RETRIES;
      else process.env.ANALYSIS_TASK_MAX_RETRIES = previousMaxRetries;
    }

    mocks.setProviderMode('success');
    mocks.setAdapterItems([
      rawItem({ externalId, url, title: '匿名终态公告', content, publishedAt: fetchedAt })
    ]);
    const normalRecrawl = await runGamePulseCheck();
    expect(normalRecrawl.failedSources).toBe(0);
    expect(await prisma.analysisTask.count({ where: { feedItemId: seeded.id } })).toBe(1);

    await processAnalysisQueue();
    const stillFailed = await prisma.analysisTask.findUniqueOrThrow({ where: { id: failedTaskId } });
    expect(stillFailed.status).toBe('failed');
    expect(mocks.providerInputs).toHaveLength(1);

    const secondVersion = '正文变化后的新版本，应当允许普通重抓重新入队分析。';
    mocks.setAdapterItems([
      rawItem({ externalId, url, title: '匿名终态公告', content: secondVersion, publishedAt: fetchedAt })
    ]);
    const contentChange = await runGamePulseCheck();
    expect(contentChange.failedSources).toBe(0);
    expect(await prisma.analysisTask.count({ where: { feedItemId: seeded.id } })).toBe(2);

    await processAnalysisQueue();
    const followUp = await prisma.analysisTask.findFirstOrThrow({
      where: { feedItemId: seeded.id, id: { not: failedTaskId } }
    });
    expect(followUp.status).toBe('completed');
    const analysis = await prisma.analysis.findUniqueOrThrow({ where: { feedItemId: seeded.id } });
    expect(analysis.status).toBe('completed');
    expect(analysis.summary).toContain(secondVersion.slice(0, 24));
  });
});
