import { beforeEach, describe, expect, test, vi } from 'vitest';
import { getStoryFacets, queryStoryFacets, resetStoryFacetCache } from '../storyFacets.js';

describe('story facets', () => {
  beforeEach(() => {
    resetStoryFacetCache();
  });

  test('builds every facet from one grouped query and normalizes values', async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      { game: '原神', category: 'announcement', importance: 'low', followed: 0n, count: 2n },
      { game: '原神', category: null, importance: 'urgent', followed: 0n, count: 1n },
      { game: '', category: 'music', importance: 'high', followed: 1n, count: 3n },
      { game: '', category: 'announcement', importance: 'medium', followed: 1n, count: 8n }
    ]);

    const facets = await queryStoryFacets({ $queryRaw: queryRaw } as never, {});

    expect(facets).toEqual({
      byGame: { 原神: 3 },
      byCategory: { announcement: 2, other: 1 },
      byFollowCategory: { music: 3 },
      byImportance: { low: 2, high: 4, medium: 8 }
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  test('parameterizes followed source, uid, and low-value exclusions', async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);

    await queryStoryFacets({ $queryRaw: queryRaw } as never, {
      followGroup: 'follow',
      sourceUid: '8465957',
      visibility: 'public'
    });

    const query = queryRaw.mock.calls[0][0];
    expect(String(query.sql)).toContain('s.followed = ?');
    expect(String(query.sql)).toContain('s.uid = ?');
    expect(String(query.sql)).toContain("a.category <> 'enforcement'");
    expect(query.values).toContain(true);
    expect(query.values).toContain('8465957');
    expect(query.values).toContain('%处罚公示%');
  });

  test('parameterizes multiple followed source uids', async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);

    await queryStoryFacets({ $queryRaw: queryRaw } as never, {
      followGroup: 'follow',
      sourceUids: ['8465957', '401742377']
    });

    const query = queryRaw.mock.calls[0][0];
    expect(String(query.sql)).toContain('s.uid IN (?,?)');
    expect(query.values).toContain('8465957');
    expect(query.values).toContain('401742377');
  });

  test('keeps low-value rows when muted visibility is requested', async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);

    await queryStoryFacets({ $queryRaw: queryRaw } as never, { visibility: 'all' });

    const query = queryRaw.mock.calls[0][0];
    expect(String(query.sql)).not.toContain('enforcement');
    expect(query.values).not.toContain('%处罚公示%');
  });

  test('deduplicates concurrent facet requests and caches the result', async () => {
    let resolveRows: (rows: unknown[]) => void = () => undefined;
    const queryRaw = vi.fn().mockReturnValue(new Promise(resolve => {
      resolveRows = resolve;
    }));
    const client = { $queryRaw: queryRaw } as never;

    const first = getStoryFacets(client, { followGroup: 'game' });
    const second = getStoryFacets(client, { followGroup: 'game' });
    resolveRows([]);

    expect(await first).toEqual({ byGame: {}, byCategory: {}, byFollowCategory: {}, byImportance: {} });
    expect(await second).toEqual(await first);
    expect(await getStoryFacets(client, { followGroup: 'game' })).toEqual(await first);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
});
