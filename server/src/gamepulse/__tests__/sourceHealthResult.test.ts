import axios from 'axios';
import type { Source } from '@prisma/client';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { sources, healthLogs } = vi.hoisted(() => ({
  sources: [] as Source[],
  healthLogs: [] as Array<{ status: string; error?: string }>
}));
vi.mock('axios', () => ({ default: {
  get: vi.fn(),
  isAxiosError: (error: { isAxiosError?: boolean }) => error.isAxiosError === true
} }));
vi.mock('../../db.js', () => ({ prisma: {
  source: {
    findMany: vi.fn(async () => sources),
    update: vi.fn(async ({ data }: { data: Partial<Source> }) => Object.assign(sources[0], data))
  },
  sourceHealthLog: {
    create: vi.fn(async ({ data }: { data: { status: string; error?: string } }) => healthLogs.push(data)),
    deleteMany: vi.fn(async () => ({ count: 0 }))
  },
  feedItem: { count: vi.fn(async () => 0) }
} }));
vi.mock('../ai/analysisQueue.js', () => ({ createAnalysisTaskIfAbsent: vi.fn(), wakeAnalysisQueue: vi.fn() }));

import { runGamePulseCheck } from '../jobs/checker.js';

describe('source health reflects the actual RSSHub response', () => {
  const previousSuccess = new Date('2020-01-01T00:00:00Z');
  beforeEach(() => {
    vi.mocked(axios.get).mockReset();
    healthLogs.length = 0;
    sources.splice(0, sources.length, {
      id: 'anonymous-source', name: '示例RSSHub', type: 'rsshub', game: '示例游戏',
      url: null, uid: null, avatar: null, route: '/example/list',
      config: JSON.stringify({ rssHubBaseUrls: ['https://rss.example'] }),
      isOfficial: true, followed: false, enabled: true, priority: 50,
      healthStatus: 'healthy', lastSuccessAt: previousSuccess, lastCheckedAt: null, lastError: null,
      createdAt: previousSuccess, updatedAt: previousSuccess
    });
  });

  test('an error response cannot advance last success or write healthy history', async () => {
    vi.mocked(axios.get).mockRejectedValue(Object.assign(new Error('HTTP 503'), {
      isAxiosError: true, response: { status: 503, data: 'this route is empty' }
    }));
    const result = await runGamePulseCheck();
    expect(result.failedSources).toBe(1);
    expect(sources[0]).toMatchObject({ healthStatus: 'failed', lastSuccessAt: previousSuccess });
    expect(sources[0].lastError).toContain('HTTP 503');
    expect(sources[0].lastCheckedAt).toBeInstanceOf(Date);
    expect(healthLogs[0].status).toBe('failed');
  });

  test('a valid empty feed is a successful check with zero new items', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: '<rss><channel><title>示例列表</title></channel></rss>' });
    const result = await runGamePulseCheck();
    expect(result).toMatchObject({ newItems: 0, failedSources: 0 });
    expect(sources[0]).toMatchObject({ healthStatus: 'healthy', lastError: null });
    expect(sources[0].lastSuccessAt!.getTime()).toBeGreaterThan(previousSuccess.getTime());
    expect(healthLogs[0].status).toBe('healthy');
  });
});
