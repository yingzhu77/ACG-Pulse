import { beforeEach, describe, expect, test, vi } from 'vitest';

type MockTask = {
  id: string;
  feedItemId: string;
  status: string;
  retryCount: number;
  maxRetries: number;
  lastError: string | null;
  provider: string | null;
  model: string | null;
  durationMs: number | null;
  nextRunAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const tasks: MockTask[] = [];
const analysisRecords = new Map<string, Record<string, unknown>>();

const source = {
  id: 'source-1',
  name: '测试源',
  type: 'rss',
  game: '原神',
  url: null,
  uid: null,
  avatar: null,
  route: null,
  config: null,
  isOfficial: true,
  followed: false,
  enabled: true,
  priority: 50,
  healthStatus: 'healthy',
  lastSuccessAt: null,
  lastCheckedAt: null,
  lastError: null,
  createdAt: new Date(),
  updatedAt: new Date()
};

const feedItem = {
  id: 'item-1',
  sourceId: 'source-1',
  externalId: null,
  itemKind: 'official_post',
  game: '原神',
  title: '原神版本更新公告',
  content: '这里是一段足够长的内容，用于触发 AI 分析。',
  url: 'https://example.com/item',
  authorName: null,
  authorUrl: null,
  coverUrl: null,
  sourceType: 'rss',
  contentHash: 'hash',
  hidden: false,
  publishedAt: null,
  fetchedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
  source
};

function applyTaskUpdate(task: MockTask, data: Partial<MockTask>): MockTask {
  Object.assign(task, data, { updatedAt: new Date() });
  return task;
}

vi.mock('../../db.js', () => ({
  prisma: {
    analysisTask: {
      findFirst: vi.fn(async ({ where, select }: { where?: Record<string, unknown>; select?: Record<string, boolean> } = {}) => {
        let found: MockTask | undefined;
        if (where?.feedItemId) {
          const statuses = ((where.status as { in?: string[] } | undefined)?.in) || [];
          found = tasks.find(task => task.feedItemId === where.feedItemId && statuses.includes(task.status));
        } else {
          const now = new Date();
          found = tasks.find(task =>
            (task.status === 'pending' && task.nextRunAt <= now) ||
            (task.status === 'failed' && task.nextRunAt <= now && task.retryCount < 3)
          );
        }
        if (!found) return null;
        if (!select) return found;
        return Object.fromEntries(Object.keys(select).map(key => [key, found![key as keyof MockTask]]));
      }),
      create: vi.fn(async ({ data }: { data: Partial<MockTask> }) => {
        const task: MockTask = {
          id: `task-${tasks.length + 1}`,
          feedItemId: data.feedItemId || 'item-1',
          status: data.status || 'pending',
          retryCount: 0,
          maxRetries: data.maxRetries || 3,
          lastError: null,
          provider: null,
          model: null,
          durationMs: null,
          nextRunAt: data.nextRunAt || new Date(),
          startedAt: null,
          completedAt: null,
          failedAt: null,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        tasks.push(task);
        return task;
      }),
      update: vi.fn(async ({ where, data, select }: { where: { id: string }; data: Partial<MockTask>; select?: Record<string, boolean> }) => {
        const task = tasks.find(item => item.id === where.id);
        if (!task) throw new Error('Task not found');
        applyTaskUpdate(task, data);
        if (!select) return task;
        return Object.fromEntries(Object.keys(select).map(key => [key, task[key as keyof MockTask]]));
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return tasks.find(task => task.id === where.id) || null;
      }),
      count: vi.fn(async () => {
        const now = new Date();
        return tasks.filter(task =>
          (task.status === 'pending' && task.nextRunAt <= now) ||
          (task.status === 'failed' && task.nextRunAt <= now && task.retryCount < 3)
        ).length;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { status: string }; data: Partial<MockTask> }) => {
        const matched = tasks.filter(task => task.status === where.status);
        matched.forEach(task => applyTaskUpdate(task, data));
        return { count: matched.length };
      }),
      groupBy: vi.fn(async () => {
        const counts = new Map<string, number>();
        tasks.forEach(task => counts.set(task.status, (counts.get(task.status) || 0) + 1));
        return Array.from(counts.entries()).map(([status, count]) => ({ status, _count: { status: count } }));
      }),
      findMany: vi.fn(async () => tasks.map(task => ({
        ...task,
        feedItem: {
          id: feedItem.id,
          title: feedItem.title,
          game: feedItem.game,
          createdAt: feedItem.createdAt,
          source: { name: source.name }
        }
      })))
    },
    feedItem: {
      findUnique: vi.fn(async () => ({
        ...feedItem,
        analysis: analysisRecords.get(feedItem.id) || {
          summary: '测试摘要',
          importance: 'medium'
        }
      }))
    },
    analysis: {
      findUnique: vi.fn(async ({ where }: { where: { feedItemId: string } }) => analysisRecords.get(where.feedItemId) || null),
      upsert: vi.fn(async ({ where, create, update }: { where: { feedItemId: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        analysisRecords.set(where.feedItemId, { ...(analysisRecords.get(where.feedItemId) || create), ...update });
      }),
      update: vi.fn(async ({ where, data }: { where: { feedItemId: string }; data: Record<string, unknown> }) => {
        analysisRecords.set(where.feedItemId, { ...(analysisRecords.get(where.feedItemId) || {}), ...data });
      })
    }
  }
}));

vi.mock('../ai/provider.js', () => ({
  analyzeWithProvider: vi.fn(async () => ({
    analysis: {
      category: 'version',
      importance: 'high',
      visibility: 'public',
      confidence: 90,
      summary: '版本更新',
      reason: '测试',
      dedupKeywords: ['版本']
    },
    provider: 'mock-provider',
    model: 'mock-model'
  })),
  fallbackAnalysis: vi.fn(input => ({
    category: 'other',
    importance: 'medium',
    visibility: 'public',
    confidence: 35,
    summary: input.title,
    reason: '规则兜底分析，未调用 AI',
    dedupKeywords: []
  }))
}));

vi.mock('../../services/email.js', () => ({
  sendFeedItemEmail: vi.fn()
}));

describe('analysis queue', () => {
  beforeEach(() => {
    tasks.length = 0;
    analysisRecords.clear();
    vi.clearAllMocks();
  });

  test('marks a pending task completed with provider metadata', async () => {
    const { enqueueAnalysisTask, getAnalysisQueueOverview } = await import('../ai/analysisQueue.js');

    await enqueueAnalysisTask(feedItem.id);
    await vi.waitFor(() => expect(tasks[0].status).toBe('completed'));

    expect(tasks[0].provider).toBe('mock-provider');
    expect(tasks[0].model).toBe('mock-model');
    expect(tasks[0].durationMs).toEqual(expect.any(Number));

    const overview = await getAnalysisQueueOverview();
    expect(overview.counts.completed).toBe(1);
  });

  test('records failures and allows manual retry', async () => {
    const provider = await import('../ai/provider.js');
    vi.mocked(provider.analyzeWithProvider)
      .mockRejectedValueOnce(new Error('provider timeout'))
      .mockResolvedValueOnce({
        analysis: {
          category: 'version',
          importance: 'high',
          visibility: 'public',
          confidence: 90,
          summary: '版本更新',
          reason: '测试',
          dedupKeywords: ['版本']
        },
        provider: 'mock-provider',
        model: 'mock-model'
      });
    const { enqueueAnalysisTask, retryAnalysisTask } = await import('../ai/analysisQueue.js');

    await enqueueAnalysisTask(feedItem.id);
    await vi.waitFor(() => expect(tasks[0].status).toBe('failed'));

    expect(tasks[0].retryCount).toBe(1);
    expect(tasks[0].lastError).toBe('provider timeout');

    await retryAnalysisTask(tasks[0].id);
    await vi.waitFor(() => expect(tasks[0].status).toBe('completed'));

    expect(tasks[0].lastError).toBeNull();
    expect(tasks[0].retryCount).toBe(1);
  });

  test('short content completes through rules fallback without provider call', async () => {
    const provider = await import('../ai/provider.js');
    const { ensureAnalysis } = await import('../ai/analyzer.js');
    const shortItem = {
      ...feedItem,
      title: '短',
      content: '',
      source
    };

    const result = await ensureAnalysis(shortItem);

    expect(result).toEqual({ status: 'completed', provider: 'rules', model: 'fallback' });
    expect(provider.analyzeWithProvider).not.toHaveBeenCalled();
    expect(analysisRecords.get(feedItem.id)).toMatchObject({
      status: 'completed',
      provider: 'rules',
      model: 'fallback',
      reason: '内容过短，规则兜底分析'
    });
  });
});
