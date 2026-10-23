import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@prisma/client', () => ({
  PrismaClient: class { constructor() { throw new Error('Real Prisma is forbidden in anonymous collection tests'); } }
}));

let mockSources: Array<{
  id: string; name: string; type: string; game: string; enabled: boolean;
  priority: number; healthStatus: string; uid: string | null; avatar: string | null;
  lastSuccessAt: Date | null; lastCheckedAt: Date | null; lastError: string | null;
}> = [];
interface MockFeedItem {
  id: string;
  sourceId: string;
  identityKey?: string | null;
  contentHash: string;
  externalId?: string | null;
  title?: string;
  content?: string;
  url?: string;
  authorName?: string | null;
  authorUrl?: string | null;
  coverUrl?: string | null;
  publishedAt?: Date | null;
  analysis?: { status: string } | null;
}

let mockFeedItems: MockFeedItem[] = [];
let createdItems: Array<{ sourceId: string; contentHash: string; title: string }> = [];
let mockAnalysisTasks: Array<{ feedItemId: string; dedupeKey: string | null; status: string }> = [];
let createdNotifications: Array<Record<string, unknown>> = [];

vi.mock('../../db.js', () => {
  const mockPrisma = {
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      const snapshot = structuredClone({ mockFeedItems, createdItems, mockAnalysisTasks, createdNotifications });
      try {
        return await callback(mockPrisma);
      } catch (error) {
        mockFeedItems = snapshot.mockFeedItems;
        createdItems = snapshot.createdItems;
        mockAnalysisTasks = snapshot.mockAnalysisTasks;
        createdNotifications = snapshot.createdNotifications;
        throw error;
      }
    }),
    source: {
      findMany: vi.fn(async ({ where }: { where: { enabled: boolean } }) =>
        mockSources.filter(s => s.enabled === where.enabled)
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const source = mockSources.find(s => s.id === where.id);
        if (source) Object.assign(source, data);
        return source;
      })
    },
    sourceHealthLog: {
      create: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 0 }))
    },
    feedItem: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const sourceId = where.sourceId as string;
        const conditions = (where.OR || []) as Array<{ identityKey?: string; contentHash?: string; url?: string }>;
        return mockFeedItems.find(item => item.sourceId === sourceId && conditions.some(condition =>
          (condition.identityKey && item.identityKey === condition.identityKey)
          || (condition.contentHash && item.contentHash === condition.contentHash)
          || (condition.url && item.url === condition.url)
        )) || null;
      }),
      findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const key = where.sourceId_contentHash as { sourceId: string; contentHash: string } | undefined;
        if (key) {
          return mockFeedItems.find(f => f.sourceId === key.sourceId && f.contentHash === key.contentHash) || null;
        }
        return null;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const item = {
          id: `item-${mockFeedItems.length + 1}`,
          sourceId: data.sourceId as string,
          identityKey: data.identityKey as string,
          contentHash: data.contentHash as string,
          externalId: data.externalId as string,
          title: data.title as string,
          content: data.content as string,
          url: data.url as string,
          authorName: data.authorName as string | null,
          authorUrl: data.authorUrl as string | null,
          coverUrl: data.coverUrl as string | null,
          publishedAt: data.publishedAt as Date | null
        };
        mockFeedItems.push(item);
        createdItems.push({
          sourceId: data.sourceId as string,
          contentHash: data.contentHash as string,
          title: data.title as string
        });
        return {
          ...item,
          ...data,
          source: mockSources.find(s => s.id === data.sourceId)
        };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const item = mockFeedItems.find(candidate => candidate.id === where.id);
        if (!item) throw new Error(`Missing mock feed item: ${where.id}`);
        Object.assign(item, data);
        return item;
      }),
      count: vi.fn(async () => mockFeedItems.length),
      deleteMany: vi.fn(async () => ({ count: 0 }))
    },
    analysis: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      updateMany: vi.fn(async ({ where, data }: { where: { feedItemId: string }; data: { status: string } }) => {
        const item = mockFeedItems.find(candidate => candidate.id === where.feedItemId);
        if (!item?.analysis) return { count: 0 };
        Object.assign(item.analysis, data);
        return { count: 1 };
      })
    },
    analysisTask: {
      create: vi.fn(async ({ data }: { data: { feedItemId: string; dedupeKey: string | null; status: string } }) => {
        if (mockAnalysisTasks.some(task => task.dedupeKey && task.dedupeKey === data.dedupeKey)) {
          throw Object.assign(new Error('Duplicate open task'), { code: 'P2002' });
        }
        mockAnalysisTasks.push(data);
        return data;
      }),
      count: vi.fn(async ({ where }: { where: { feedItemId: string } }) =>
        mockAnalysisTasks.filter(task => task.feedItemId === where.feedItemId).length
      )
    },
    notification: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        createdNotifications.push(data);
        return data;
      }),
      deleteMany: vi.fn(async () => ({ count: 0 }))
    }
  };
  return { prisma: mockPrisma };
});

vi.mock('../ai/analysisQueue.js', () => ({
  createAnalysisTaskIfAbsent: vi.fn(async (feedItemId: string, tx: {
    analysisTask: { create: (args: { data: { feedItemId: string; dedupeKey: string; status: string } }) => Promise<unknown> }
  }) => {
    try {
      await tx.analysisTask.create({ data: { feedItemId, dedupeKey: feedItemId, status: 'pending' } });
      return true;
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') return false;
      throw error;
    }
  }),
  wakeAnalysisQueue: vi.fn()
}));

vi.mock('../adapters/registry.js', () => ({
  getAdapter: vi.fn(() => ({
    fetch: vi.fn(async () => [])
  }))
}));

vi.mock('../utils.js', () => ({
  contentHash: vi.fn((parts: string[]) => parts.join('|')),
  normalizeUrl: vi.fn((url: string) => url),
  truncate: vi.fn((s: string) => s)
}));

vi.mock('../adapters/bilibiliVideo.js', () => ({
  fetchBilibiliAvatar: vi.fn(async () => null)
}));

describe('checker content dedup', () => {
  function existingItem(input: {
    id: string;
    sourceId?: string;
    externalId: string;
    url: string;
    title: string;
    content: string;
    publishedAt: Date;
  }): MockFeedItem {
    const identityKey = `external:${input.externalId.toLowerCase()}`;
    return {
      id: input.id,
      sourceId: input.sourceId || 'src-1',
      identityKey,
      contentHash: [identityKey, input.title, input.content, input.publishedAt.toISOString()].join('|'),
      externalId: input.externalId,
      title: input.title,
      content: input.content,
      url: input.url,
      authorName: null,
      authorUrl: null,
      coverUrl: null,
      publishedAt: input.publishedAt
    };
  }

  beforeEach(() => {
    mockSources = [
      { id: 'src-1', name: '测试源', type: 'rss', game: '原神', enabled: true, priority: 50, healthStatus: 'unknown', uid: null, avatar: null, lastSuccessAt: null, lastCheckedAt: null, lastError: null }
    ];
    mockFeedItems = [];
    createdItems = [];
    mockAnalysisTasks = [];
    createdNotifications = [];
    vi.clearAllMocks();
  });

  test('skips items with duplicate contentHash', async () => {
    const date1 = new Date('2026-06-15T00:00:00Z');
    const date2 = new Date('2026-06-16T00:00:00Z');
    mockFeedItems.push(existingItem({
      id: 'existing-1', externalId: 'ext-1', url: 'http://url', title: '标题', content: '内容', publishedAt: date1
    }));

    const adapter = await import('../adapters/registry.js');
    vi.mocked(adapter.getAdapter).mockReturnValue({
      fetch: vi.fn(async () => [
        { externalId: 'ext-1', url: 'http://url', title: '标题', content: '内容', publishedAt: date1 },
        { externalId: 'ext-2', url: 'http://url2', title: '新标题', content: '新内容', publishedAt: date2 }
      ])
    } as never);

    const { runGamePulseCheck } = await import('../jobs/checker.js');
    const result = await runGamePulseCheck();

    // Only the new item should be created
    expect(result.newItems).toBe(1);
    expect(createdItems.length).toBe(1);
    expect(createdItems[0].title).toBe('新标题');
  });

  test('skips the same source URL when externalId formats differ', async () => {
    const publishedAt = new Date('2026-06-21T10:29:46Z');
    const adapter = await import('../adapters/registry.js');
    vi.mocked(adapter.getAdapter).mockReturnValue({
      fetch: vi.fn(async () => [
        {
          externalId: 'https://www.bilibili.com/video/BV1JEjt6QEuN',
          url: 'https://bilibili.com/video/BV1JEjt6QEuN',
          title: '魔法少女奈叶 PV2',
          content: 'first',
          publishedAt
        },
        {
          externalId: 'BV1JEjt6QEuN',
          url: 'https://bilibili.com/video/BV1JEjt6QEuN',
          title: '魔法少女奈叶 PV2',
          content: 'second',
          publishedAt
        }
      ])
    } as never);

    const { runGamePulseCheck } = await import('../jobs/checker.js');
    const result = await runGamePulseCheck();

    expect(result.newItems).toBe(1);
    expect(createdItems).toHaveLength(1);
  });

  test('creates all items when no duplicates exist', async () => {
    const adapter = await import('../adapters/registry.js');
    vi.mocked(adapter.getAdapter).mockReturnValue({
      fetch: vi.fn(async () => [
        { externalId: 'ext-a', url: 'http://a', title: '标题A', content: '内容A', publishedAt: new Date('2026-06-15T00:00:00Z') },
        { externalId: 'ext-b', url: 'http://b', title: '标题B', content: '内容B', publishedAt: new Date('2026-06-16T00:00:00Z') },
        { externalId: 'ext-c', url: 'http://c', title: '标题C', content: '内容C', publishedAt: new Date('2026-06-17T00:00:00Z') }
      ])
    } as never);

    const { runGamePulseCheck } = await import('../jobs/checker.js');
    const result = await runGamePulseCheck();

    expect(result.newItems).toBe(3);
    expect(createdItems.length).toBe(3);
  });

  test('skips all items when all are duplicates', async () => {
    const date1 = new Date('2026-06-15T00:00:00Z');
    const date2 = new Date('2026-06-16T00:00:00Z');
    // Pre-populate with all matching items
    mockFeedItems.push(
      existingItem({ id: 'existing-1', externalId: 'ext-1', url: 'http://url1', title: '标题1', content: '内容1', publishedAt: date1 }),
      existingItem({ id: 'existing-2', externalId: 'ext-2', url: 'http://url2', title: '标题2', content: '内容2', publishedAt: date2 })
    );

    const adapter = await import('../adapters/registry.js');
    vi.mocked(adapter.getAdapter).mockReturnValue({
      fetch: vi.fn(async () => [
        { externalId: 'ext-1', url: 'http://url1', title: '标题1', content: '内容1', publishedAt: date1 },
        { externalId: 'ext-2', url: 'http://url2', title: '标题2', content: '内容2', publishedAt: date2 }
      ])
    } as never);

    const { runGamePulseCheck } = await import('../jobs/checker.js');
    const result = await runGamePulseCheck();

    expect(result.newItems).toBe(0);
    expect(createdItems.length).toBe(0);
  });

  test('different sources can have items with same contentHash', async () => {
    mockSources.push({
      id: 'src-2', name: '测试源2', type: 'rss', game: '原神', enabled: true, priority: 50,
      healthStatus: 'unknown', uid: null, avatar: null, lastSuccessAt: null, lastCheckedAt: null, lastError: null
    });

    const date1 = new Date('2026-06-15T00:00:00Z');
    // Same contentHash exists for src-1 but not src-2
    mockFeedItems.push(existingItem({
      id: 'existing-1', externalId: 'ext-1', url: 'http://url', title: '标题', content: '内容', publishedAt: date1
    }));

    const adapter = await import('../adapters/registry.js');
    vi.mocked(adapter.getAdapter).mockReturnValue({
      fetch: vi.fn(async () => [
        { externalId: 'ext-1', url: 'http://url', title: '标题', content: '内容', publishedAt: date1 }
      ])
    } as never);

    const { runGamePulseCheck } = await import('../jobs/checker.js');
    const result = await runGamePulseCheck();

    // src-1 skips (duplicate), src-2 creates (new)
    expect(result.newItems).toBe(1);
    expect(createdItems.length).toBe(1);
    expect(createdItems[0].sourceId).toBe('src-2');
  });

  test('correctly counts newItems across multiple sources', async () => {
    mockSources.push({
      id: 'src-2', name: '测试源2', type: 'rss', game: '崩坏', enabled: true, priority: 50,
      healthStatus: 'unknown', uid: null, avatar: null, lastSuccessAt: null, lastCheckedAt: null, lastError: null
    });

    const date1 = new Date('2026-06-15T00:00:00Z');
    const date2 = new Date('2026-06-16T00:00:00Z');
    // src-1 has 1 existing item, src-2 has none
    mockFeedItems.push(existingItem({
      id: 'existing-1', externalId: 'ext-1', url: 'http://url', title: '标题', content: '内容', publishedAt: date1
    }));

    const adapter = await import('../adapters/registry.js');
    const fetchMock = vi.fn(async (source: { id: string }) => {
      if (source.id === 'src-1') {
        return [
          { externalId: 'ext-1', url: 'http://url', title: '标题', content: '内容', publishedAt: date1 },
          { externalId: 'ext-2', url: 'http://url2', title: '新标题', content: '新内容', publishedAt: date2 }
        ];
      }
      return [
        { externalId: 'ext-3', url: 'http://url3', title: '崩坏标题', content: '崩坏内容', publishedAt: date1 }
      ];
    });
    vi.mocked(adapter.getAdapter).mockReturnValue({ fetch: fetchMock } as never);

    const { runGamePulseCheck } = await import('../jobs/checker.js');
    const result = await runGamePulseCheck();

    // src-1: 1 new (ext-1 skipped), src-2: 1 new = total 2
    expect(result.newItems).toBe(2);
    expect(result.checkedSources).toBe(2);
  });

  test('rolls back a new item when its durable analysis task cannot be created', async () => {
    const { prisma } = await import('../../db.js');
    vi.mocked(prisma.analysisTask.create).mockRejectedValueOnce(new Error('anonymous task write failure'));
    const adapter = await import('../adapters/registry.js');
    vi.mocked(adapter.getAdapter).mockReturnValue({
      fetch: vi.fn(async () => [{ externalId: 'anonymous-1', url: 'https://example.test/article/1', title: '匿名公告', content: '匿名公告正文' }])
    } as never);

    const { runGamePulseCheck } = await import('../jobs/checker.js');
    const result = await runGamePulseCheck();

    expect(result.failedSources).toBe(1);
    expect(mockFeedItems).toHaveLength(0);
    expect(mockAnalysisTasks).toHaveLength(0);
    expect(createdNotifications).toHaveLength(0);
  });

  test('keeps a persisted analysis task when the later notification write fails', async () => {
    const { prisma } = await import('../../db.js');
    vi.mocked(prisma.notification.create).mockRejectedValueOnce(new Error('anonymous notification write failure'));
    const adapter = await import('../adapters/registry.js');
    vi.mocked(adapter.getAdapter).mockReturnValue({
      fetch: vi.fn(async () => [{ externalId: 'anonymous-1', url: 'https://example.test/article/1', title: '匿名公告', content: '匿名公告正文' }])
    } as never);

    const { runGamePulseCheck } = await import('../jobs/checker.js');
    await runGamePulseCheck();

    expect(mockFeedItems).toHaveLength(1);
    expect(mockAnalysisTasks).toHaveLength(1);
    expect(mockAnalysisTasks[0].feedItemId).toBe(mockFeedItems[0].id);
  });

  test('rolls back a body update if the replacement analysis task cannot be persisted', async () => {
    const publishedAt = new Date('2026-06-15T00:00:00Z');
    mockFeedItems.push(existingItem({ id: 'anonymous-existing', externalId: 'anonymous-1', url: 'https://example.test/article/1', title: '匿名公告', content: '原始匿名正文', publishedAt }));
    const { prisma } = await import('../../db.js');
    vi.mocked(prisma.analysisTask.create).mockRejectedValueOnce(new Error('anonymous task write failure'));
    const adapter = await import('../adapters/registry.js');
    vi.mocked(adapter.getAdapter).mockReturnValue({
      fetch: vi.fn(async () => [{ externalId: 'anonymous-1', url: 'https://example.test/article/1', title: '匿名公告', content: '更新后的匿名正文', publishedAt }])
    } as never);

    const { runGamePulseCheck } = await import('../jobs/checker.js');
    const result = await runGamePulseCheck();

    expect(result.failedSources).toBe(1);
    expect(mockFeedItems[0].content).toBe('原始匿名正文');
    expect(mockAnalysisTasks).toHaveLength(0);
  });

  test('leaves an exhausted task alone until the same article body changes', async () => {
    const publishedAt = new Date('2026-06-15T00:00:00Z');
    mockFeedItems.push(existingItem({ id: 'anonymous-existing', externalId: 'anonymous-1', url: 'https://example.test/article/1', title: '匿名公告', content: '原始匿名正文', publishedAt }));
    mockFeedItems[0].analysis = { status: 'failed' };
    mockAnalysisTasks.push({ feedItemId: 'anonymous-existing', dedupeKey: null, status: 'failed' });
    let content = '原始匿名正文';
    const adapter = await import('../adapters/registry.js');
    vi.mocked(adapter.getAdapter).mockReturnValue({
      fetch: vi.fn(async () => [{ externalId: 'anonymous-1', url: 'https://example.test/article/1', title: '匿名公告', content, publishedAt }])
    } as never);
    const { runGamePulseCheck } = await import('../jobs/checker.js');

    await runGamePulseCheck();
    expect(mockAnalysisTasks).toHaveLength(1);
    content = '更新后的匿名正文';
    await runGamePulseCheck();
    expect(mockAnalysisTasks).toHaveLength(2);
    expect(mockAnalysisTasks[1]).toMatchObject({ feedItemId: 'anonymous-existing', status: 'pending' });
  });
});
