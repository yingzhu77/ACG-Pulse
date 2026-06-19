import { beforeEach, describe, expect, test, vi } from 'vitest';

let mockSources: Array<{
  id: string; name: string; type: string; game: string; enabled: boolean;
  priority: number; healthStatus: string; uid: string | null; avatar: string | null;
  lastSuccessAt: Date | null; lastCheckedAt: Date | null; lastError: string | null;
}> = [];
let mockFeedItems: Array<{ id: string; sourceId: string; contentHash: string }> = [];
let createdItems: Array<{ sourceId: string; contentHash: string; title: string }> = [];

vi.mock('../../db.js', () => ({
  prisma: {
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
          contentHash: data.contentHash as string
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
      count: vi.fn(async () => mockFeedItems.length),
      deleteMany: vi.fn(async () => ({ count: 0 }))
    },
    analysis: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    notification: { create: vi.fn(async () => ({})), deleteMany: vi.fn(async () => ({ count: 0 })) }
  }
}));

vi.mock('../ai/analysisQueue.js', () => ({
  enqueueAnalysisTask: vi.fn(async () => {})
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
  beforeEach(() => {
    mockSources = [
      { id: 'src-1', name: '测试源', type: 'rss', game: '原神', enabled: true, priority: 50, healthStatus: 'unknown', uid: null, avatar: null, lastSuccessAt: null, lastCheckedAt: null, lastError: null }
    ];
    mockFeedItems = [];
    createdItems = [];
    vi.clearAllMocks();
  });

  test('skips items with duplicate contentHash', async () => {
    const date1 = new Date('2026-06-15T00:00:00Z');
    const date2 = new Date('2026-06-16T00:00:00Z');
    // Pre-existing item — contentHash must match what the mock contentHash() produces
    const existingHash = ['ext-1', 'http://url', '标题', date1.toISOString()].join('|');
    mockFeedItems.push({ id: 'existing-1', sourceId: 'src-1', contentHash: existingHash });

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
      { id: 'existing-1', sourceId: 'src-1', contentHash: ['ext-1', 'http://url1', '标题1', date1.toISOString()].join('|') },
      { id: 'existing-2', sourceId: 'src-1', contentHash: ['ext-2', 'http://url2', '标题2', date2.toISOString()].join('|') }
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
    mockFeedItems.push({ id: 'existing-1', sourceId: 'src-1', contentHash: ['ext-1', 'http://url', '标题', date1.toISOString()].join('|') });

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
    mockFeedItems.push({ id: 'existing-1', sourceId: 'src-1', contentHash: ['ext-1', 'http://url', '标题', date1.toISOString()].join('|') });

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
});
