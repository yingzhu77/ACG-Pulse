import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { aggregateCommunityTopicsWithStatus } from '../adapters/community.js';
import { cleanupStale, persistCommunityRefresh } from '../db/communityDb.js';
import { isCommunityRefreshCoolingDown, refreshCommunityData } from '../services/communityService.js';
import type { CommunitySourceResult } from '../community/types.js';

vi.mock('@prisma/client', () => ({
  PrismaClient: class { constructor() { throw new Error('This test must not construct a real Prisma client'); } }
}));

vi.mock('../adapters/community.js', () => ({ aggregateCommunityTopicsWithStatus: vi.fn() }));
vi.mock('../db/communityDb.js', () => ({ loadAllTopics: vi.fn(async () => []), persistCommunityRefresh: vi.fn(), cleanupStale: vi.fn(async () => 0) }));

beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

describe('community refresh result handling', () => {
  test('persists partial collection health and only cleans successful platforms', async () => {
    const sources: CommunitySourceResult[] = [
      { source: 'bilibili', status: 'healthy' },
      { source: 'nga', status: 'failed', error: 'anonymous timeout' },
      { source: 'xiaoheihe', status: 'healthy' }
    ];
    vi.mocked(aggregateCommunityTopicsWithStatus).mockResolvedValue({ topics: [], sources });
    await expect(refreshCommunityData()).resolves.toEqual([]);
    expect(persistCommunityRefresh).toHaveBeenCalledWith([], sources);
    expect(cleanupStale).toHaveBeenCalledWith(48, ['bilibili', 'xiaoheihe']);
  });

  test('persists degraded health but only cleans fully successful platforms', async () => {
    const sources: CommunitySourceResult[] = [
      { source: 'bilibili', status: 'degraded', error: 'comments: anonymous timeout' },
      { source: 'nga', status: 'failed', error: 'anonymous timeout' },
      { source: 'xiaoheihe', status: 'healthy' }
    ];
    vi.mocked(aggregateCommunityTopicsWithStatus).mockResolvedValue({ topics: [], sources });
    await expect(refreshCommunityData()).resolves.toEqual([]);
    expect(persistCommunityRefresh).toHaveBeenCalledWith([], sources);
    expect(cleanupStale).toHaveBeenCalledWith(48, ['xiaoheihe']);
  });

  test('records all-source failures and rejects instead of reporting a successful refresh', async () => {
    const sources: CommunitySourceResult[] = ['bilibili', 'nga', 'xiaoheihe'].map(source => ({ source: source as CommunitySourceResult['source'], status: 'failed', error: 'anonymous rejection' }));
    vi.mocked(aggregateCommunityTopicsWithStatus).mockResolvedValue({ topics: [], sources });
    await expect(refreshCommunityData()).rejects.toThrow('All community sources failed');
    expect(persistCommunityRefresh).toHaveBeenCalledWith([], sources);
    expect(cleanupStale).not.toHaveBeenCalled();
  });

  test('propagates persistence failure and releases the refresh lock for a later attempt', async () => {
    vi.mocked(aggregateCommunityTopicsWithStatus).mockResolvedValue({ topics: [], sources: [{ source: 'bilibili', status: 'healthy' }] });
    vi.mocked(persistCommunityRefresh).mockRejectedValueOnce(new Error('anonymous disk full'));
    await expect(refreshCommunityData()).rejects.toThrow('anonymous disk full');
    expect(isCommunityRefreshCoolingDown()).toBe(true);
    expect(cleanupStale).not.toHaveBeenCalled();
    await expect(refreshCommunityData()).resolves.toEqual([]);
    expect(isCommunityRefreshCoolingDown()).toBe(false);
    expect(persistCommunityRefresh).toHaveBeenCalledTimes(2);
  });

  test('a persistence-failure cooldown expires after the existing refresh interval', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T02:00:00.000Z'));
    vi.mocked(aggregateCommunityTopicsWithStatus).mockResolvedValue({ topics: [], sources: [{ source: 'bilibili', status: 'healthy' }] });
    vi.mocked(persistCommunityRefresh).mockRejectedValueOnce(new Error('anonymous disk full'));
    await expect(refreshCommunityData()).rejects.toThrow('anonymous disk full');
    expect(isCommunityRefreshCoolingDown()).toBe(true);
    vi.setSystemTime(new Date(Date.now() + 30 * 60 * 1000));
    expect(isCommunityRefreshCoolingDown()).toBe(false);
  });
});
