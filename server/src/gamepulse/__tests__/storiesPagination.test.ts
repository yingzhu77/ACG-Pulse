import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedItemWithRelations } from '../types.js';

const { findMany } = vi.hoisted(() => ({
  findMany: vi.fn()
}));

vi.mock('../../db.js', () => ({
  prisma: {
    feedItem: { findMany }
  }
}));

vi.mock('../search.js', () => ({
  isFTS5Ready: vi.fn(async () => false),
  searchFeedItems: vi.fn()
}));

import storiesRouter from '../routes/stories.js';

function makeItem(index: number): FeedItemWithRelations {
  const publishedAt = new Date(Date.UTC(2026, 5, 1, 12, 0, 0) - index * 60_000);
  return {
    id: `item-${index}`,
    sourceId: 'source-1',
    externalId: `external-${index}`,
    itemKind: 'official_post',
    game: 'Game A',
    title: `Unique story ${index}`,
    content: `Content for unique story ${index}`,
    url: `https://example.com/items/${index}`,
    authorName: null,
    authorUrl: null,
    coverUrl: null,
    sourceType: 'rss',
    hidden: false,
    publishedAt,
    fetchedAt: publishedAt,
    createdAt: publishedAt,
    updatedAt: publishedAt,
    source: {
      id: 'source-1',
      name: 'Source 1',
      type: 'rss',
      game: 'Game A',
      isOfficial: true,
      followed: false,
      healthStatus: 'healthy'
    },
    analysis: {
      id: `analysis-${index}`,
      status: 'completed',
      category: 'announcement',
      importance: 'medium',
      visibility: 'public',
      confidence: 1,
      summary: null,
      reason: null,
      dedupKeywords: '[]',
      provider: null,
      model: null,
      error: null,
      analyzedAt: publishedAt
    }
  };
}

function invokeStories(query: Record<string, string | string[]>): Promise<{ statusCode: number; payload: unknown }> {
  return new Promise((resolve, reject) => {
    const req = {
      method: 'GET',
      url: '/stories',
      originalUrl: '/stories',
      baseUrl: '',
      path: '/stories',
      query,
      headers: {},
      params: {}
    };
    const res = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        resolve({ statusCode: this.statusCode, payload });
        return this;
      },
      setHeader: vi.fn(),
      getHeader: vi.fn(),
      end: vi.fn()
    };

    (storiesRouter as unknown as {
      handle: (req: unknown, res: unknown, next: (error?: unknown) => void) => void;
    }).handle(req, res, reject);
  });
}

describe('public stories pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not truncate total or later pages at the first 500 candidates', async () => {
    const items = Array.from({ length: 520 }, (_, i) => makeItem(i + 1));
    findMany.mockImplementation(async ({ take, cursor }: { take: number; cursor?: { id: string } }) => {
      const start = cursor ? items.findIndex(item => item.id === cursor.id) + 1 : 0;
      return items.slice(start, start + take);
    });

    const result = await invokeStories({ page: '26', limit: '20', includeFacets: 'false' });

    expect(result.statusCode).toBe(200);
    expect(result.payload).toMatchObject({
      pagination: {
        page: 26,
        limit: 20,
        total: 520,
        totalPages: 26
      }
    });
    expect((result.payload as { data: unknown[] }).data).toHaveLength(20);
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ take: 500 }));
    expect(findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ take: 500 }));
  });

  it('keeps public story filters in the batched candidate query', async () => {
    findMany.mockResolvedValueOnce([makeItem(1)]);

    await invokeStories({
      page: '1',
      limit: '20',
      game: ['Game A', 'Game B'],
      sourceId: 'source-1',
      itemKind: 'official_post',
      category: ['announcement', 'event'],
      followGroup: 'follow',
      sourceUid: ['uid-1', 'uid-2'],
      official: 'true',
      includeFacets: 'false'
    });

    const query = findMany.mock.calls[0][0];
    expect(query).toMatchObject({
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: 500,
      include: {
        source: {
          select: expect.objectContaining({
            followed: true,
            healthStatus: true
          })
        },
        analysis: true
      },
      where: expect.objectContaining({
        hidden: false,
        game: { in: ['Game A', 'Game B'] },
        sourceId: 'source-1',
        itemKind: 'official_post',
        source: { isOfficial: true }
      })
    });
    expect(query.where.AND).toEqual(expect.arrayContaining([
      { source: { is: { followed: true } } },
      { source: { is: { uid: { in: ['uid-1', 'uid-2'] } } } },
      { analysis: { is: { category: { in: ['announcement', 'event'] }, visibility: 'public' } } },
      expect.objectContaining({ NOT: expect.any(Object) })
    ]));
  });
});
