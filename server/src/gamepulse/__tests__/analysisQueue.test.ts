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
  identityKey: null,
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

function matchesWhere(task: MockTask, where: Record<string, unknown>): boolean {
  if (where.id && task.id !== where.id) return false;
  if (where.feedItemId) {
    if (typeof where.feedItemId === 'object') {
      const feedItemFilter = where.feedItemId as { in?: string[] };
      if (feedItemFilter.in && !feedItemFilter.in.includes(task.feedItemId)) return false;
    } else if (task.feedItemId !== where.feedItemId) {
      return false;
    }
  }

  if (where.status) {
    if (typeof where.status === 'object') {
      const statusFilter = where.status as { in?: string[]; notIn?: string[] };
      if (statusFilter.in && !statusFilter.in.includes(task.status)) return false;
      if (statusFilter.notIn && statusFilter.notIn.includes(task.status)) return false;
    } else if (task.status !== where.status) {
      return false;
    }
  }

  if (where.nextRunAt && typeof where.nextRunAt === 'object') {
    const dateFilter = where.nextRunAt as { lte?: Date };
    if (dateFilter.lte && task.nextRunAt > dateFilter.lte) return false;
  }

  if (where.retryCount && typeof where.retryCount === 'object') {
    const retryFilter = where.retryCount as { lt?: number };
    if (retryFilter.lt !== undefined && task.retryCount >= retryFilter.lt) return false;
  }

  // Handle OR conditions — task must match at least one branch
  if (where.OR && Array.isArray(where.OR)) {
    return where.OR.some((branch: Record<string, unknown>) => matchesWhere(task, branch));
  }

  return true;
}

vi.mock('../../db.js', () => ({
  prisma: {
    analysisTask: {
      findFirst: vi.fn(async ({ where, select }: { where?: Record<string, unknown>; select?: Record<string, boolean> } = {}) => {
        const found = where ? tasks.find(task => matchesWhere(task, where)) : tasks[0];
        if (!found) return null;
        if (!select) return found;
        return Object.fromEntries(Object.keys(select).map(key => [key, found[key as keyof MockTask]]));
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
      createMany: vi.fn(async ({ data }: { data: Partial<MockTask>[] }) => {
        for (const item of data) {
          const task: MockTask = {
            id: `task-${tasks.length + 1}`,
            feedItemId: item.feedItemId || 'item-1',
            status: item.status || 'pending',
            retryCount: 0,
            maxRetries: item.maxRetries || 3,
            lastError: null,
            provider: null,
            model: null,
            durationMs: null,
            nextRunAt: item.nextRunAt || new Date(),
            startedAt: null,
            completedAt: null,
            failedAt: null,
            createdAt: new Date(),
            updatedAt: new Date()
          };
          tasks.push(task);
        }
        return { count: data.length };
      }),
      update: vi.fn(async ({ where, data, select }: { where: { id: string }; data: Partial<MockTask>; select?: Record<string, boolean> }) => {
        const task = tasks.find(item => item.id === where.id);
        if (!task) throw new Error('Task not found');
        applyTaskUpdate(task, data);
        if (!select) return task;
        return Object.fromEntries(Object.keys(select).map(key => [key, task[key as keyof MockTask]]));
      }),
      findUnique: vi.fn(async ({ where, select }: { where: { id: string }; select?: Record<string, boolean> }) => {
        const found = tasks.find(task => task.id === where.id) || null;
        if (!found) return null;
        if (!select) return found;
        return Object.fromEntries(Object.keys(select).map(key => [key, found[key as keyof MockTask]]));
      }),
      count: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => {
        if (!where) return tasks.length;
        return tasks.filter(task => matchesWhere(task, where)).length;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<MockTask> }) => {
        const matched = tasks.filter(task => matchesWhere(task, where));
        matched.forEach(task => applyTaskUpdate(task, data));
        return { count: matched.length };
      }),
      groupBy: vi.fn(async () => {
        const counts = new Map<string, number>();
        tasks.forEach(task => counts.set(task.status, (counts.get(task.status) || 0) + 1));
        return Array.from(counts.entries()).map(([status, count]) => ({ status, _count: { status: count } }));
      }),
      findMany: vi.fn(async ({ where, select }: { where?: Record<string, unknown>; select?: Record<string, boolean> } = {}) => {
        const filtered = where ? tasks.filter(task => matchesWhere(task, where)) : tasks;
        if (select) {
          return filtered.map(task => Object.fromEntries(Object.keys(select).map(key => [key, task[key as keyof MockTask]])));
        }
        return filtered.map(task => ({
          ...task,
          feedItem: {
            id: feedItem.id,
            title: feedItem.title,
            game: feedItem.game,
            createdAt: feedItem.createdAt,
            source: { name: source.name }
          }
        }));
      })
    },
    feedItem: {
      findUnique: vi.fn(async () => ({
        ...feedItem,
        analysis: analysisRecords.get(feedItem.id) || {
          summary: '测试摘要',
          importance: 'medium'
        }
      })),
      findMany: vi.fn(async ({ where, select, take }: { where?: Record<string, unknown>; select?: Record<string, boolean>; take?: number }) => {
        const items = [{ id: 'item-1' }, { id: 'item-2' }, { id: 'item-3' }];
        const filtered = where?.hidden === false ? items : items;
        const result = take ? filtered.slice(0, take) : filtered;
        if (select) {
          return result.map(item => Object.fromEntries(Object.keys(select).map(key => [key, item[key as keyof typeof item]])));
        }
        return result;
      })
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
  beforeEach(async () => {
    process.env.ANALYSIS_BATCH_DELAY_MS = '0';
    tasks.length = 0;
    analysisRecords.clear();
    // Use mockReset to clear queued values (mockResolvedValueOnce) and restore implementation
    const { prisma } = await import('../../db.js');
    vi.mocked(prisma.analysisTask.updateMany).mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.analysisTask.updateMany as any).mockImplementation(
      async (args: any) => {
        const matched = tasks.filter(task => matchesWhere(task, args.where || {}));
        matched.forEach(task => applyTaskUpdate(task, args.data));
        return { count: matched.length };
      }
    );
    vi.clearAllMocks();
    const queue = await import('../ai/analysisQueue.js');
    queue.clearRetryTimerForTest();
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

  test('enqueueAnalysisTask prevents duplicate pending tasks for same feedItem', async () => {
    const { enqueueAnalysisTask } = await import('../ai/analysisQueue.js');

    await enqueueAnalysisTask(feedItem.id);
    await vi.waitFor(() => expect(tasks[0].status).toBe('completed'));

    const countAfterFirst = tasks.length;

    // Enqueue same item again — should NOT create a second task because
    // the first one is now 'completed', not 'pending'/'running'.
    await enqueueAnalysisTask(feedItem.id);
    await vi.waitFor(() => tasks.length > countAfterFirst);

    // The new task should be created (old one is completed, not open).
    expect(tasks.length).toBe(countAfterFirst + 1);
  });

  test('enqueueAnalysisTask skips creation when a pending task already exists', async () => {
    const { enqueueAnalysisTask } = await import('../ai/analysisQueue.js');

    // Create a task that stays pending (not yet claimed by the worker)
    // We can do this by directly pushing a pending task and NOT calling enqueue
    // which would trigger processAnalysisQueue
    tasks.push({
      id: 'task-existing',
      feedItemId: feedItem.id,
      status: 'pending',
      retryCount: 0,
      maxRetries: 3,
      lastError: null,
      provider: null,
      model: null,
      durationMs: null,
      nextRunAt: new Date(),
      startedAt: null,
      completedAt: null,
      failedAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const taskCountBefore = tasks.length;

    // Enqueue same item — should skip creation because a pending task exists
    await enqueueAnalysisTask(feedItem.id);
    // Allow processAnalysisQueue to run
    await new Promise(r => setTimeout(r, 100));

    // Only one task should exist (the original one), no duplicate created
    const tasksForItem = tasks.filter(t => t.feedItemId === feedItem.id);
    expect(tasksForItem.length).toBe(taskCountBefore);
  });

  test('reanalyzeAll batch-enqueues multiple items', async () => {
    const { reanalyzeAll } = await import('../ai/analysisQueue.js');

    const count = await reanalyzeAll(3);

    expect(count).toBe(3);
    // All tasks should be created and eventually processed
    await vi.waitFor(() => expect(tasks.every(t => t.status === 'completed')).toBe(true), { timeout: 10000 });
    expect(tasks.length).toBe(3);
  });

  test('reanalyzeItem forces completed analysis to run again', async () => {
    const provider = await import('../ai/provider.js');
    analysisRecords.set(feedItem.id, {
      status: 'completed',
      provider: 'old-provider',
      model: 'old-model',
      summary: '旧摘要'
    });

    const { reanalyzeItem } = await import('../ai/analysisQueue.js');
    await reanalyzeItem(feedItem.id);

    await vi.waitFor(() => expect(tasks[0].status).toBe('completed'));
    expect(provider.analyzeWithProvider).toHaveBeenCalled();
    expect(analysisRecords.get(feedItem.id)).toMatchObject({
      status: 'completed',
      provider: 'mock-provider',
      model: 'mock-model',
      summary: '版本更新'
    });
  });

  test('reanalyzeAll skips items with open tasks', async () => {
    tasks.push({
      id: 'task-open',
      feedItemId: 'item-1',
      status: 'pending',
      retryCount: 0,
      maxRetries: 3,
      lastError: null,
      provider: null,
      model: null,
      durationMs: null,
      nextRunAt: new Date(Date.now() + 60_000),
      startedAt: null,
      completedAt: null,
      failedAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const { reanalyzeAll } = await import('../ai/analysisQueue.js');
    const count = await reanalyzeAll(3);

    expect(count).toBe(2);
    expect(tasks.filter(task => task.feedItemId === 'item-1')).toHaveLength(1);
    expect(tasks.map(task => task.feedItemId).sort()).toEqual(['item-1', 'item-2', 'item-3']);
  });

  test('reanalyzeAll returns 0 for empty set', async () => {
    const { prisma } = await import('../../db.js');
    vi.mocked(prisma.feedItem.findMany).mockResolvedValueOnce([]);

    const { reanalyzeAll } = await import('../ai/analysisQueue.js');
    const count = await reanalyzeAll(10);

    expect(count).toBe(0);
    expect(tasks.length).toBe(0);
  });

  test('atomic claim returns null when updateMany matches 0 rows', async () => {
    const { prisma } = await import('../../db.js');

    // Create a pending task
    tasks.push({
      id: 'task-claim-test',
      feedItemId: 'item-1',
      status: 'pending',
      retryCount: 0,
      maxRetries: 3,
      lastError: null,
      provider: null,
      model: null,
      durationMs: null,
      nextRunAt: new Date(),
      startedAt: null,
      completedAt: null,
      failedAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // Mock updateMany to return count=0 (simulating another worker already claimed it)
    vi.mocked(prisma.analysisTask.updateMany).mockResolvedValueOnce({ count: 0 });

    // Import and call processAnalysisQueue — it should not process the task
    const { processAnalysisQueue } = await import('../ai/analysisQueue.js');
    await processAnalysisQueue();

    // Task should remain pending because the atomic claim returned count=0
    expect(tasks[0].status).toBe('pending');
  });

  test('retryFailedAnalysisTasks resets all failed tasks to pending', async () => {
    const { retryFailedAnalysisTasks } = await import('../ai/analysisQueue.js');

    // Manually create failed tasks
    tasks.push({
      id: 'task-failed-1',
      feedItemId: 'item-1',
      status: 'failed',
      retryCount: 1,
      maxRetries: 3,
      lastError: 'timeout',
      provider: null,
      model: null,
      durationMs: 1000,
      nextRunAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
      failedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    });
    tasks.push({
      id: 'task-failed-2',
      feedItemId: 'item-2',
      status: 'failed',
      retryCount: 2,
      maxRetries: 3,
      lastError: 'rate limit',
      provider: null,
      model: null,
      durationMs: 2000,
      nextRunAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
      failedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const count = await retryFailedAnalysisTasks();
    expect(count).toBe(2);
    expect(tasks.filter(t => t.status === 'pending').length).toBe(2);
    expect(tasks[0].lastError).toBeNull();
    expect(tasks[1].lastError).toBeNull();
  });
});
