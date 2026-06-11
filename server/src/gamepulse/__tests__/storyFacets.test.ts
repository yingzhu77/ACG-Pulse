import { describe, expect, test, vi } from 'vitest';
import { buildStoryFacetFeedItemWhere, computeStoryFacets } from '../storyFacets.js';

describe('story facets', () => {
  test('builds facet feed item filters for follow source uid and low-value exclusion', () => {
    const where = buildStoryFacetFeedItemWhere({
      followGroup: 'follow',
      sourceUid: '123456',
      visibility: 'public'
    });

    expect(where.hidden).toBe(false);
    expect(where.AND).toEqual(expect.arrayContaining([
      { source: { is: { followed: true } } },
      { source: { is: { uid: '123456' } } },
      expect.objectContaining({ NOT: expect.any(Object) })
    ]));
  });

  test('does not exclude muted low-value notices when visibility includes muted content', () => {
    const where = buildStoryFacetFeedItemWhere({
      followGroup: 'game',
      visibility: 'all'
    });

    expect(where.AND).toEqual([
      { source: { is: { followed: false } } }
    ]);
  });

  test('computes facets from grouped rows and normalizes public values', async () => {
    const feedItemGroupBy = vi.fn().mockResolvedValue([
      { game: '原神', _count: { _all: 2 } },
      { game: '崩坏：星穹铁道', _count: { _all: 1 } }
    ]);
    const analysisGroupBy = vi.fn()
      .mockResolvedValueOnce([
        { category: 'announcement', _count: { _all: 2 } },
        { category: null, _count: { _all: 1 } },
        { category: 'music', _count: { _all: 9 } }
      ])
      .mockResolvedValueOnce([
        { category: 'music', _count: { _all: 3 } },
        { category: 'creator_video', _count: { _all: 1 } },
        { category: 'announcement', _count: { _all: 8 } }
      ])
      .mockResolvedValueOnce([
        { importance: 'low', _count: { _all: 4 } },
        { importance: 'urgent', _count: { _all: 2 } },
        { importance: 'high', _count: { _all: 1 } }
      ]);

    const facets = await computeStoryFacets({
      feedItem: { groupBy: feedItemGroupBy },
      analysis: { groupBy: analysisGroupBy }
    } as never, {
      followGroup: 'game',
      visibility: 'public'
    });

    expect(facets).toEqual({
      byGame: { 原神: 2, '崩坏：星穹铁道': 1 },
      byCategory: { announcement: 2, other: 1 },
      byFollowCategory: { music: 3, creator_video: 1 },
      byImportance: { low: 4, high: 3 }
    });
    expect(feedItemGroupBy).toHaveBeenCalledTimes(1);
    expect(analysisGroupBy).toHaveBeenCalledTimes(3);
  });

  test('applies source uid and followed filters to grouped queries', async () => {
    const feedItemGroupBy = vi.fn().mockResolvedValue([]);
    const analysisGroupBy = vi.fn().mockResolvedValue([]);

    await computeStoryFacets({
      feedItem: { groupBy: feedItemGroupBy },
      analysis: { groupBy: analysisGroupBy }
    } as never, {
      followGroup: 'follow',
      sourceUid: '8465957',
      visibility: 'public'
    });

    expect(feedItemGroupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          { source: { is: { followed: true } } },
          { source: { is: { uid: '8465957' } } },
          { analysis: { is: { status: { in: ['completed', 'failed'] } } } },
          { source: { is: { followed: false } } }
        ])
      })
    }));
    expect(analysisGroupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        feedItem: {
          is: expect.objectContaining({
            AND: expect.arrayContaining([
              { source: { is: { followed: true } } },
              { source: { is: { uid: '8465957' } } },
              { source: { is: { followed: false } } }
            ])
          })
        }
      })
    }));
  });
});
