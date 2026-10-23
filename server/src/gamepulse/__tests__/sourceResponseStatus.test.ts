import type { Source } from '@prisma/client';
import axios from 'axios';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fetchRssHubRoute } from '../adapters/rsshub.js';
import { fetchBilibiliComments, fetchBilibiliGameRanking } from '../community/sources/bilibili.js';
import { fetchAllNgaHotPosts, fetchAllNgaHotPostsWithStatus, fetchNgaComments } from '../community/sources/nga.js';
import { fetchXiaoheiheNews } from '../community/sources/xiaoheihe.js';

vi.mock('axios', async importOriginal => {
  const original = await importOriginal<typeof import('axios')>();
  return { ...original, default: { ...original.default, get: vi.fn(), post: vi.fn() } };
});

const source = {
  id: 'anonymous-source', name: 'Anonymous source', type: 'rsshub', route: null,
  url: null, isOfficial: true,
  config: JSON.stringify({ rssHubBaseUrls: ['https://example.invalid'] })
} as Source;

function emptyRouteError() {
  return new axios.AxiosError('HTTP 503', undefined, undefined, undefined, {
    status: 503, data: 'this route is empty', headers: {}, config: {} as never, statusText: 'Unavailable'
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('RSSHub and MiHoYo response status', () => {
  test('does not convert an HTTP empty-route error into a successful empty feed', async () => {
    vi.mocked(axios.get).mockRejectedValue(emptyRouteError());
    await expect(fetchRssHubRoute(source, '/anonymous/list')).rejects.toThrow('HTTP 503');
  });

  test.each([
    { retcode: -100, message: 'anonymous rejection' },
    { retcode: 0, data: {} }
  ])('rejects a MiHoYo business error or missing list: %j', async data => {
    vi.mocked(axios.get)
      .mockRejectedValueOnce(emptyRouteError())
      .mockResolvedValueOnce({ data });
    await expect(fetchRssHubRoute(source, '/mihoyo/bbs/official/2/1/20')).rejects.toThrow(/MiHoYo/);
  });

  test('accepts a successful empty MiHoYo list', async () => {
    vi.mocked(axios.get)
      .mockRejectedValueOnce(emptyRouteError())
      .mockResolvedValueOnce({ data: { retcode: 0, data: { list: [] } } });
    await expect(fetchRssHubRoute(source, '/mihoyo/bbs/official/2/1/20')).resolves.toEqual([]);
  });

  test('filters incomplete MiHoYo entries and rejects an entirely invalid list', async () => {
    const validEntry = { post: { post_id: 'anonymous-1', subject: '游戏 fixture' } };
    const invalidEntry = { post: { post_id: '', subject: ' ' } };

    vi.mocked(axios.get)
      .mockRejectedValueOnce(emptyRouteError())
      .mockResolvedValueOnce({ data: { retcode: 0, data: { list: [invalidEntry, validEntry] } } });
    await expect(fetchRssHubRoute(source, '/mihoyo/bbs/official/2/1/20')).resolves.toEqual([
      expect.objectContaining({ externalId: 'anonymous-1', title: '游戏 fixture' })
    ]);

    vi.mocked(axios.get)
      .mockRejectedValueOnce(emptyRouteError())
      .mockResolvedValueOnce({ data: { retcode: 0, data: { list: [invalidEntry] } } });
    await expect(fetchRssHubRoute(source, '/mihoyo/bbs/official/2/1/20')).rejects.toThrow('MiHoYo');
  });

  test('tries the next configured RSSHub instance after an empty-route HTTP error', async () => {
    vi.mocked(axios.get)
      .mockRejectedValueOnce(emptyRouteError())
      .mockResolvedValueOnce({ data: '<rss><channel></channel></rss>' });
    const fallbackSource = { ...source, config: JSON.stringify({ rssHubBaseUrls: ['https://first.invalid', 'https://second.invalid'] }) };
    await expect(fetchRssHubRoute(fallbackSource, '/anonymous/list')).resolves.toEqual([]);
    expect(axios.get).toHaveBeenCalledTimes(2);
  });
});

describe('community external response boundaries', () => {
  test.each([
    { code: -412, message: 'anonymous rejection' },
    { code: 0, data: {} }
  ])('rejects Bilibili errors and missing lists: %j', async data => {
    vi.mocked(axios.get).mockResolvedValue({ data });
    await expect(fetchBilibiliGameRanking()).rejects.toThrow(/Bilibili/);
  });

  test('preserves Bilibili transport failures and accepts a real empty list', async () => {
    vi.mocked(axios.get).mockRejectedValueOnce(new Error('anonymous timeout'));
    await expect(fetchBilibiliGameRanking()).rejects.toThrow('anonymous timeout');
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { code: 0, data: { list: [] } } });
    await expect(fetchBilibiliGameRanking()).resolves.toEqual([]);
  });

  test('preserves the Bilibili -400 business error observed upstream', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { code: -400, message: '请求错误' } });
    await expect(fetchBilibiliGameRanking()).rejects.toThrow('code=-400, message=请求错误');
  });

  test('distinguishes valid null comments from a Bilibili comments failure', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { code: 0, data: { replies: null } } });
    await expect(fetchBilibiliComments([101], 4, 5)).resolves.toEqual([[]]);
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { code: -412, message: 'anonymous comment error' } });
    await expect(fetchBilibiliComments([101], 4, 5)).rejects.toThrow(/Bilibili/);
  });

  test.each([
    { status: 'failed', msg: 'anonymous rejection' },
    { status: 'ok', result: {} }
  ])('rejects Xiaoheihe errors and missing lists: %j', async data => {
    vi.mocked(axios.get).mockResolvedValue({ data });
    await expect(fetchXiaoheiheNews()).rejects.toThrow(/Xiaoheihe/);
  });

  test('accepts a successful empty Xiaoheihe list', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { status: 'ok', result: { links: [] } } });
    await expect(fetchXiaoheiheNews()).resolves.toEqual([]);
  });

  test('filters structurally incomplete Bilibili and Xiaoheihe entries', async () => {
    const video = { aid: 101, bvid: 'BVAnonymous', title: '游戏 fixture', pubdate: 1_792_374_000 };
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { code: 0, data: { list: [
      { aid: 102, bvid: 'BVAnonymous2', title: '游戏 fixture 2' },
      video
    ] } } });
    await expect(fetchBilibiliGameRanking()).resolves.toEqual([video]);

    vi.mocked(axios.get).mockResolvedValueOnce({ data: { code: 0, data: { list: [
      { aid: 102, bvid: 'BVAnonymous2', title: '游戏 fixture 2' }
    ] } } });
    await expect(fetchBilibiliGameRanking()).rejects.toThrow('contains no valid items');

    const item = { linkid: 103, title: '游戏 fixture', modify_at: 1_792_374_000 };
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { status: 'ok', result: { links: [
      { linkid: 104, title: '游戏 fixture' },
      item
    ] } } });
    await expect(fetchXiaoheiheNews()).resolves.toEqual([item]);

    vi.mocked(axios.get).mockResolvedValueOnce({ data: { status: 'ok', result: { links: [
      { linkid: 104, title: '游戏 fixture' }
    ] } } });
    await expect(fetchXiaoheiheNews()).rejects.toThrow('contains no valid items');
  });

  test('filters structurally incomplete NGA posts', async () => {
    const post = {
      tid: 105, fid: 476, author: 'anonymous', subject: '游戏 fixture',
      postdate: 1_792_374_000, replies: 1, lastpost: 1_792_374_000
    };
    vi.mocked(axios.post).mockResolvedValue({ data: { code: 0, result: { data: [
      { tid: 106, subject: '游戏 fixture' },
      post
    ] } } });
    const result = await fetchAllNgaHotPostsWithStatus();
    expect(result.posts).toHaveLength(6);
    expect(result.error).toBeUndefined();

    vi.mocked(axios.post).mockResolvedValue({ data: { code: 0, result: { data: [
      { tid: 106, subject: '游戏 fixture' }
    ] } } });
    await expect(fetchAllNgaHotPostsWithStatus()).rejects.toThrow('contains no valid items');
  });

  test.each([
    { code: 1, msg: 'anonymous rejection' },
    { code: 0, result: {} }
  ])('rejects NGA errors and missing forum lists: %j', async data => {
    vi.mocked(axios.post).mockResolvedValue({ data });
    await expect(fetchAllNgaHotPosts()).rejects.toThrow(/NGA/);
  });

  test('rejects NGA when a failed forum leaves no usable posts', async () => {
    vi.mocked(axios.post)
      .mockResolvedValue({ data: { code: 0, result: { data: [] } } })
      .mockRejectedValueOnce(new Error('anonymous timeout'));
    await expect(fetchAllNgaHotPosts()).rejects.toThrow('anonymous timeout');
  });

  test('returns usable NGA posts with an error when one forum fails', async () => {
    const post = {
      tid: 107, fid: 476, author: 'anonymous', subject: '游戏 fixture',
      postdate: 1_792_374_000, replies: 1, lastpost: 1_792_374_000
    };
    vi.mocked(axios.post)
      .mockRejectedValueOnce(new Error('anonymous timeout'))
      .mockResolvedValue({ data: { code: 0, result: { data: [post] } } });

    const result = await fetchAllNgaHotPostsWithStatus();

    expect(result.posts).toHaveLength(5);
    expect(result.error).toContain('anonymous timeout');
  });

  test('preserves NGA comment request failures', async () => {
    vi.mocked(axios.post).mockRejectedValue(new Error('anonymous comment timeout'));
    await expect(fetchNgaComments([102], 5)).rejects.toThrow('anonymous comment timeout');
  });
});
