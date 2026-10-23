import type { Source } from '@prisma/client';
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { BilibiliVideoAdapter } from '../adapters/bilibiliVideo.js';
import { fetchRssHubRoute } from '../adapters/rsshub.js';

vi.mock('axios', async importOriginal => {
  const original = await importOriginal<typeof import('axios')>();
  return { ...original, default: { ...original.default, get: vi.fn() } };
});

vi.mock('../adapters/rsshub.js', () => ({
  fetchRssHubRoute: vi.fn()
}));

const source = {
  id: 'anonymous-bilibili-source',
  name: 'Anonymous Bilibili source',
  type: 'bilibili_video',
  url: 'https://space.bilibili.com/401742377',
  uid: '401742377',
  route: null,
  isOfficial: true,
  config: null
} as Source;

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Bilibili collection path', () => {
  test('does not enable direct API fallback just because a cookie exists', async () => {
    vi.stubEnv('BILIBILI_COOKIE', 'SESSDATA=anonymous');
    vi.stubEnv('BILIBILI_DIRECT_API_FALLBACK', 'false');
    vi.mocked(fetchRssHubRoute).mockRejectedValue(new Error('anonymous RSSHub failure'));

    await expect(new BilibiliVideoAdapter().fetch(source)).rejects.toThrow(
      'direct API fallback is disabled'
    );
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('uses direct API only when explicitly enabled', async () => {
    vi.stubEnv('BILIBILI_COOKIE', 'SESSDATA=anonymous');
    vi.stubEnv('BILIBILI_DIRECT_API_FALLBACK', 'true');
    vi.mocked(fetchRssHubRoute).mockRejectedValue(new Error('anonymous RSSHub failure'));
    vi.mocked(axios.get).mockRejectedValue(new Error('anonymous nav failure'));

    await expect(new BilibiliVideoAdapter().fetch(source)).rejects.toThrow('anonymous nav failure');
    expect(axios.get).toHaveBeenCalled();
  });
});
