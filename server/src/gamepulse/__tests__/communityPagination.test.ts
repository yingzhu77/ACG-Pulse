import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findMany, count, groupBy, aggregate } = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
  groupBy: vi.fn(),
  aggregate: vi.fn()
}));

vi.mock('../../db.js', () => ({
  prisma: {
    communityTopic: { findMany, count, groupBy, aggregate }
  }
}));

import { loadTopicPage } from '../db/communityDb.js';

const topic = {
  id: 'xhh-123',
  title: 'Topic',
  sentiment: 'positive',
  sentimentScore: 0.8,
  heatScore: 88,
  category: 'gameplay',
  source: 'xiaoheihe',
  trend: '[70,88]',
  summary: 'Summary',
  url: 'https://xiaoheihe.cn/bbs/app/share/detail/123',
  publishedAt: new Date('2026-06-21T08:00:00Z')
};

describe('community topic pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findMany.mockResolvedValue([topic]);
    count.mockResolvedValue(31);
    groupBy.mockResolvedValue([{ sentiment: 'positive', _count: { _all: 31 } }]);
    aggregate.mockResolvedValue({ _avg: { heatScore: 72.4 } });
  });

  it('applies filters, latest ordering, skip and take in the database query', async () => {
    const result = await loadTopicPage({
      sentiment: 'positive',
      source: 'xiaoheihe',
      page: 2,
      limit: 30,
      sort: 'latest'
    });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { sentiment: 'positive', source: 'xiaoheihe' },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      skip: 30,
      take: 30
    }));
    expect(result.total).toBe(31);
    expect(result.avgHeat).toBe(72);
    expect(result.sentimentCounts.positive).toBe(31);
    expect(result.topics[0].url).toBe(
      'https://api.xiaoheihe.cn/v3/bbs/app/api/web/share?link_id=123'
    );
  });

  it('uses deterministic heat ordering by default choice', async () => {
    await loadTopicPage({ page: 1, limit: 30, sort: 'heat' });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ heatScore: 'desc' }, { publishedAt: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: 30
    }));
  });
});
