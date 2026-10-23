import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { prisma } from '../../db.js';
import { cleanupStale, getStalenessInfo, persistCommunityRefresh, recordCommunitySourceResults, upsertTopics } from '../db/communityDb.js';

let storedHealth: string | null = null;
let legacyRows: Array<{ source: string; fetchedAt: Date }> = [];

vi.mock('@prisma/client', () => ({
  PrismaClient: class { constructor() { throw new Error('This test must not construct a real Prisma client'); } }
}));

vi.mock('../../db.js', () => ({
  prisma: {
    $transaction: vi.fn(),
    setting: {
      findUnique: vi.fn(async () => storedHealth === null ? null : { value: storedHealth }),
      upsert: vi.fn(async ({ create }: { create: { value: string } }) => { storedHealth = create.value; })
    },
    communityTopic: {
      findFirst: vi.fn(async ({ where }: { where?: { source: string } }) => {
        const rows = legacyRows.filter(row => !where?.source || row.source === where.source);
        return rows.sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime())[0] || null;
      }),
      findMany: vi.fn(async () => []),
      createMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(),
      deleteMany: vi.fn(async () => ({ count: 0 }))
    }
  }
}));

const allHealthy = [
  { source: 'bilibili', status: 'healthy' },
  { source: 'nga', status: 'healthy' },
  { source: 'xiaoheihe', status: 'healthy' }
] as const;

beforeEach(() => {
  storedHealth = null;
  legacyRows = [];
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-19T02:00:00.000Z'));
});
afterEach(() => { vi.useRealTimers(); });

describe('community per-source freshness', () => {
  test('records legitimate empty successes even without topic rows', async () => {
    await recordCommunitySourceResults([...allHealthy]);
    expect(await getStalenessInfo()).toEqual({ hasData: false, isStale: false, refreshDue: false, lastFetchTime: Date.now() });
  });

  test('a successful platform does not make another failed platform fresh', async () => {
    await recordCommunitySourceResults([...allHealthy]);
    const priorSuccess = Date.now();
    vi.setSystemTime(new Date(Date.now() + 31 * 60 * 1000));
    await recordCommunitySourceResults([
      allHealthy[0], allHealthy[1],
      { source: 'xiaoheihe', status: 'failed', error: 'anonymous timeout' }
    ]);
    expect(await getStalenessInfo()).toMatchObject({ isStale: true, lastFetchTime: priorSuccess });
    expect(await getStalenessInfo('bilibili')).toMatchObject({ isStale: false, lastFetchTime: Date.now() });
    expect(await getStalenessInfo('xiaoheihe')).toMatchObject({ isStale: true, lastFetchTime: priorSuccess });
    expect(await getStalenessInfo('xiaoheihe')).toMatchObject({ refreshDue: false });
    vi.setSystemTime(new Date(Date.now() + 30 * 60 * 1000));
    expect(await getStalenessInfo('xiaoheihe')).toMatchObject({ isStale: true, refreshDue: true });
    expect(JSON.parse(storedHealth!)).toContainEqual(expect.objectContaining({
      source: 'xiaoheihe', status: 'failed', lastSuccessAt: priorSuccess, error: 'anonymous timeout'
    }));
  });

  test('a degraded platform advances its last success and is not treated as stale', async () => {
    await recordCommunitySourceResults([...allHealthy]);
    vi.setSystemTime(new Date(Date.now() + 31 * 60 * 1000));
    await recordCommunitySourceResults([
      { source: 'bilibili', status: 'degraded', error: 'comments: anonymous timeout' },
      allHealthy[1],
      allHealthy[2]
    ]);

    expect(await getStalenessInfo('bilibili')).toMatchObject({ isStale: false, lastFetchTime: Date.now() });
    expect(JSON.parse(storedHealth!)).toContainEqual(expect.objectContaining({
      source: 'bilibili', status: 'degraded', lastSuccessAt: Date.now(), error: 'comments: anonymous timeout'
    }));
  });

  test('preserves a failed legacy platform last success while migrating to source health', async () => {
    const priorSuccess = Date.now() - 60 * 60 * 1000;
    legacyRows = [{ source: 'nga', fetchedAt: new Date(priorSuccess) }];
    await recordCommunitySourceResults([
      allHealthy[0], { source: 'nga', status: 'failed', error: 'anonymous rejection' }, allHealthy[2]
    ]);
    expect(await getStalenessInfo('nga')).toMatchObject({ hasData: true, isStale: true, lastFetchTime: priorSuccess });
  });

  test('only cleans cached rows belonging to successful platforms', async () => {
    await cleanupStale(48, ['bilibili', 'nga']);
    expect(prisma.communityTopic.deleteMany).toHaveBeenCalledWith({
      where: { lastSeenAt: { lt: expect.any(Date) }, source: { in: ['bilibili', 'nga'] } }
    });
  });

  test('reports persistence errors instead of retrying every create and claiming refresh success', async () => {
    vi.mocked(prisma.communityTopic.createMany).mockRejectedValueOnce(new Error('anonymous disk full'));
    const topic = {
      id: 'nga-anonymous', title: 'Anonymous fixture', sentiment: 'unknown' as const, sentimentScore: 0,
      sentimentStatus: 'unavailable' as const, sentimentMethod: 'none' as const, sentimentConfidence: 0,
      sentimentVersion: null, sentimentAnalyzedAt: null, heatScore: 55, rawHeatScore: 0,
      category: 'other', source: 'nga', trend: [55], rawHeatTrend: [0], summary: '',
      url: 'https://example.invalid/101', publishedAt: new Date().toISOString()
    };
    await expect(upsertTopics([topic])).rejects.toThrow('anonymous disk full');
    expect(prisma.communityTopic.create).not.toHaveBeenCalled();
  });

  test('uses one transaction client for topic writes and source health, propagating a health write failure', async () => {
    const tx = {
      communityTopic: { findMany: vi.fn(async () => []), createMany: vi.fn(async () => ({ count: 1 })) },
      setting: { findUnique: vi.fn(async () => null), upsert: vi.fn(async () => { throw new Error('anonymous health write failure'); }) }
    };
    vi.mocked(prisma.$transaction).mockImplementationOnce((async (callback: (client: unknown) => Promise<unknown>) => callback(tx)) as typeof prisma.$transaction);
    const topic = {
      id: 'nga-transaction', title: 'Anonymous fixture', sentiment: 'unknown' as const, sentimentScore: 0,
      sentimentStatus: 'unavailable' as const, sentimentMethod: 'none' as const, sentimentConfidence: 0,
      sentimentVersion: null, sentimentAnalyzedAt: null, heatScore: 55, rawHeatScore: 0,
      category: 'other', source: 'nga', trend: [55], rawHeatTrend: [0], summary: '',
      url: 'https://example.invalid/102', publishedAt: new Date().toISOString()
    };
    await expect(persistCommunityRefresh([topic], [...allHealthy])).rejects.toThrow('anonymous health write failure');
    expect(tx.communityTopic.createMany).toHaveBeenCalledOnce();
    expect(tx.setting.upsert).toHaveBeenCalledOnce();
    expect(prisma.communityTopic.createMany).not.toHaveBeenCalled();
    expect(prisma.setting.upsert).not.toHaveBeenCalled();
  });
});
