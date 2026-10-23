import express from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

const { getStalenessInfo, refreshCommunityData, isCommunityRefreshCoolingDown } = vi.hoisted(() => ({
  getStalenessInfo: vi.fn(async (source?: string) => ({
    isStale: source !== 'bilibili',
    refreshDue: source === undefined,
    lastFetchTime: source === 'bilibili' ? Date.parse('2026-10-19T01:00:00Z') : Date.parse('2026-10-18T01:00:00Z')
  })),
  refreshCommunityData: vi.fn(async () => []),
  isCommunityRefreshCoolingDown: vi.fn(() => false)
}));

vi.mock('../db/communityDb.js', () => ({
  getStalenessInfo,
  loadTopicPage: vi.fn(async () => ({ topics: [], total: 0, sentimentCounts: {}, avgHeat: 0 })),
  loadAllTopics: vi.fn(async () => [])
}));
vi.mock('../services/communityService.js', () => ({ refreshCommunityData, isCommunityRefreshCoolingDown }));

import router from '../routes/community.js';

describe('community source freshness at the HTTP entry', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = express();
    app.use('/community', router);
    server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  test('a fresh selected source has its own timestamp while the combined view stays stale', async () => {
    const selected = await fetch(`${base}/community/topics?source=bilibili`).then(response => response.json());
    expect(selected).toMatchObject({ isStale: false, isRefreshing: false, lastUpdated: '2026-10-19T01:00:00.000Z' });
    expect(getStalenessInfo).toHaveBeenLastCalledWith('bilibili');

    const combined = await fetch(`${base}/community/topics?source=all`).then(response => response.json());
    expect(combined).toMatchObject({ isStale: true, isRefreshing: true, lastUpdated: '2026-10-18T01:00:00.000Z' });
    expect(getStalenessInfo).toHaveBeenLastCalledWith(undefined);
    expect(refreshCommunityData).toHaveBeenCalledTimes(1);

    const failedRecently = await fetch(`${base}/community/topics?source=nga`).then(response => response.json());
    expect(failedRecently).toMatchObject({ isStale: true, isRefreshing: false, lastUpdated: '2026-10-18T01:00:00.000Z' });
    expect(refreshCommunityData).toHaveBeenCalledTimes(1);

    isCommunityRefreshCoolingDown.mockReturnValueOnce(true);
    const writeFailure = await fetch(`${base}/community/topics?source=all`).then(response => response.json());
    expect(writeFailure).toMatchObject({ isStale: true, isRefreshing: false });
    expect(refreshCommunityData).toHaveBeenCalledTimes(1);
  });
});
