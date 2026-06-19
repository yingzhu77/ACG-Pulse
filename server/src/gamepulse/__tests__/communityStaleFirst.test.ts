import { beforeEach, describe, expect, test, vi } from 'vitest';

// ---- In-memory mock DB ----
let mockTopics: Array<{
  id: string; title: string; sentiment: string; sentimentScore: number;
  heatScore: number; category: string; source: string; trend: string;
  summary: string; url: string; publishedAt: Date; fetchedAt: Date; lastSeenAt: Date;
}> = [];

let mockFetchedAt: Date = new Date();
let batchCreateShouldFail = false;

vi.mock('../../db.js', () => ({
  prisma: {
    communityTopic: {
      findFirst: vi.fn(async () => {
        if (mockTopics.length === 0) return null;
        // Return the one with latest fetchedAt
        const sorted = [...mockTopics].sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime());
        return { fetchedAt: sorted[0].fetchedAt };
      }),
      findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> }) => {
        let rows = [...mockTopics];
        if (where?.sentiment) rows = rows.filter(r => r.sentiment === where.sentiment);
        if (where?.category) rows = rows.filter(r => r.category === where.category);
        if (where?.source) rows = rows.filter(r => r.source === where.source);
        return rows.sort((a, b) => b.heatScore - a.heatScore);
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return mockTopics.find(t => t.id === where.id) || null;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const topic = { ...data, fetchedAt: new Date(), lastSeenAt: new Date() } as typeof mockTopics[0];
        mockTopics.push(topic);
        return topic;
      }),
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        if (batchCreateShouldFail) throw new Error('simulated batch failure');
        mockTopics.push(...data as typeof mockTopics);
        return { count: data.length };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const idx = mockTopics.findIndex(t => t.id === where.id);
        if (idx >= 0) Object.assign(mockTopics[idx], data);
        return mockTopics[idx];
      }),
      deleteMany: vi.fn(async () => ({ count: 0 }))
    }
  }
}));

// Mock refreshCommunityData to track calls
let refreshCallCount = 0;
vi.mock('../services/communityService.js', () => ({
  refreshCommunityData: vi.fn(async () => {
    refreshCallCount++;
    // Simulate adding a topic after refresh
    mockTopics.push({
      id: 'bilibili-99999', title: 'Refreshed Topic', sentiment: 'positive',
      sentimentScore: 0.8, heatScore: 85, category: 'gameplay', source: 'bilibili',
      trend: '[85]', summary: 'Test', url: 'https://example.com', publishedAt: new Date(),
      fetchedAt: new Date(), lastSeenAt: new Date()
    });
    return [];
  })
}));

// ---- Tests ----
import { getStalenessInfo, upsertTopics } from '../db/communityDb.js';
import { refreshCommunityData } from '../services/communityService.js';

describe('Community stale-first behavior', () => {
  beforeEach(() => {
    mockTopics = [];
    refreshCallCount = 0;
    batchCreateShouldFail = false;
    vi.clearAllMocks();
  });

  test('getStalenessInfo returns isStale=true when no data exists', async () => {
    const info = await getStalenessInfo();
    expect(info.hasData).toBe(false);
    expect(info.isStale).toBe(true);
    expect(info.lastFetchTime).toBe(0);
  });

  test('getStalenessInfo returns isStale=false when data is fresh', async () => {
    mockTopics = [{
      id: 'bilibili-1', title: 'Fresh Topic', sentiment: 'neutral',
      sentimentScore: 0, heatScore: 50, category: 'other', source: 'bilibili',
      trend: '[50]', summary: '', url: '', publishedAt: new Date(),
      fetchedAt: new Date(), lastSeenAt: new Date()
    }];
    const info = await getStalenessInfo();
    expect(info.hasData).toBe(true);
    expect(info.isStale).toBe(false);
  });

  test('getStalenessInfo returns isStale=true when data exceeds TTL', async () => {
    const thirtyOneMinutesAgo = new Date(Date.now() - 31 * 60 * 1000);
    mockTopics = [{
      id: 'bilibili-2', title: 'Old Topic', sentiment: 'neutral',
      sentimentScore: 0, heatScore: 50, category: 'other', source: 'bilibili',
      trend: '[50]', summary: '', url: '', publishedAt: new Date(),
      fetchedAt: thirtyOneMinutesAgo, lastSeenAt: thirtyOneMinutesAgo
    }];
    const info = await getStalenessInfo();
    expect(info.hasData).toBe(true);
    expect(info.isStale).toBe(true);
  });
});

describe('Community topic persistence', () => {
  beforeEach(() => {
    mockTopics = [];
    batchCreateShouldFail = false;
    vi.clearAllMocks();
  });

  test('falls back to individual creates when a batch insert fails', async () => {
    batchCreateShouldFail = true;
    const publishedAt = new Date().toISOString();

    await upsertTopics([
      {
        id: 'nga-fallback-1',
        title: 'Fallback one',
        sentiment: 'neutral',
        sentimentScore: 0,
        heatScore: 10,
        category: 'other',
        source: 'nga',
        trend: [10],
        summary: '',
        url: 'https://example.com/1',
        publishedAt
      },
      {
        id: 'nga-fallback-2',
        title: 'Fallback two',
        sentiment: 'positive',
        sentimentScore: 0.5,
        heatScore: 20,
        category: 'event',
        source: 'nga',
        trend: [20],
        summary: '',
        url: 'https://example.com/2',
        publishedAt
      }
    ]);

    expect(mockTopics.map(topic => topic.id)).toEqual(['nga-fallback-1', 'nga-fallback-2']);
  });
});

describe('Community route stale-first response', () => {
  beforeEach(() => {
    mockTopics = [];
    refreshCallCount = 0;
    batchCreateShouldFail = false;
    vi.clearAllMocks();
  });

  test('route returns data immediately without waiting for refresh', async () => {
    // Seed DB with old data
    const oldTime = new Date(Date.now() - 60 * 60 * 1000);
    mockTopics = [{
      id: 'bilibili-100', title: 'Cached Topic', sentiment: 'positive',
      sentimentScore: 0.6, heatScore: 70, category: 'character', source: 'bilibili',
      trend: '[70]', summary: 'test', url: '', publishedAt: oldTime,
      fetchedAt: oldTime, lastSeenAt: oldTime
    }];

    // Simulate what the route does
    const { isStale, lastFetchTime } = await getStalenessInfo();
    let isRefreshing = false;
    if (isStale) {
      isRefreshing = true;
      // Background refresh (fire-and-forget)
      refreshCommunityData().catch(() => {});
    }

    // Verify response shape
    expect(isStale).toBe(true);
    expect(isRefreshing).toBe(true);
    expect(lastFetchTime).toBe(oldTime.getTime());
  });

  test('route returns isRefreshing=false when data is fresh', async () => {
    mockTopics = [{
      id: 'bilibili-200', title: 'Fresh', sentiment: 'neutral',
      sentimentScore: 0, heatScore: 50, category: 'other', source: 'bilibili',
      trend: '[50]', summary: '', url: '', publishedAt: new Date(),
      fetchedAt: new Date(), lastSeenAt: new Date()
    }];

    const { isStale } = await getStalenessInfo();
    const isRefreshing = isStale;

    expect(isStale).toBe(false);
    expect(isRefreshing).toBe(false);
  });
});
