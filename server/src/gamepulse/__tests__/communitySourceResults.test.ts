import { beforeEach, describe, expect, test, vi } from 'vitest';
import { aggregateCommunityTopics, aggregateCommunityTopicsWithStatus } from '../adapters/community.js';
import { fetchBilibiliAnimeRanking, fetchBilibiliComments, fetchBilibiliGameRanking, fetchBilibiliPopular } from '../community/sources/bilibili.js';
import { fetchAllNgaHotPostsWithStatus, fetchNgaComments } from '../community/sources/nga.js';
import { fetchXiaoheiheNews } from '../community/sources/xiaoheihe.js';
import { analyzeSentimentBatch } from '../community/sentiment.js';

vi.mock('../community/sources/bilibili.js', () => ({
  fetchBilibiliAnimeRanking: vi.fn(), fetchBilibiliComments: vi.fn(),
  fetchBilibiliGameRanking: vi.fn(), fetchBilibiliPopular: vi.fn()
}));
vi.mock('../community/sources/nga.js', () => ({ fetchAllNgaHotPostsWithStatus: vi.fn(), fetchNgaComments: vi.fn() }));
vi.mock('../community/sources/xiaoheihe.js', () => ({ fetchXiaoheiheNews: vi.fn() }));
vi.mock('../community/sentiment.js', () => ({ analyzeSentimentBatch: vi.fn(), shouldReanalyzeSentiment: vi.fn() }));

const unknownSentiment = {
  label: 'unknown' as const, score: 0, status: 'unavailable' as const, method: 'none' as const,
  confidence: 0, version: null, analyzedAt: null
};
const timestamp = 1_792_374_000;

beforeEach(() => {
  vi.resetAllMocks();
  for (const fetch of [fetchBilibiliGameRanking, fetchBilibiliAnimeRanking, fetchBilibiliPopular, fetchXiaoheiheNews]) {
    vi.mocked(fetch).mockResolvedValue([]);
  }
  vi.mocked(fetchAllNgaHotPostsWithStatus).mockResolvedValue({ posts: [] });
  vi.mocked(fetchBilibiliComments).mockImplementation(async aids => aids.map(() => []));
  vi.mocked(fetchNgaComments).mockImplementation(async tids => tids.map(() => []));
  vi.mocked(analyzeSentimentBatch).mockImplementation(async texts => texts.map(() => unknownSentiment));
});

describe('community source collection results', () => {
  test('keeps a successful ranking while marking the platform degraded when another ranking fails', async () => {
    const video = { aid: 101, bvid: 'BVAnonymous', title: '原神 anonymous fixture', pubdate: timestamp };
    vi.mocked(fetchBilibiliGameRanking).mockResolvedValue([video]);
    vi.mocked(fetchBilibiliPopular).mockRejectedValue(new Error('anonymous popular timeout'));

    const result = await aggregateCommunityTopicsWithStatus();

    expect(result.topics.map(topic => topic.id)).toEqual(['bilibili-101']);
    expect(result.sources).toEqual([
      { source: 'bilibili', status: 'degraded', error: expect.stringContaining('anonymous popular timeout') },
      { source: 'nga', status: 'healthy' },
      { source: 'xiaoheihe', status: 'healthy' }
    ]);
    expect(fetchBilibiliComments).toHaveBeenCalledTimes(1);
    expect(fetchNgaComments).not.toHaveBeenCalled();
  });

  test('marks a Bilibili comment failure as degraded while keeping the video topic', async () => {
    vi.mocked(fetchBilibiliGameRanking).mockResolvedValue([{ aid: 101, bvid: 'BVAnonymous', title: '游戏 anonymous fixture', pubdate: timestamp }]);
    vi.mocked(fetchBilibiliComments).mockRejectedValue(new Error('anonymous comments timeout'));

    const result = await aggregateCommunityTopicsWithStatus();

    expect(result.sources[0]).toEqual({ source: 'bilibili', status: 'degraded', error: expect.stringContaining('anonymous comments timeout') });
    expect(result.topics.map(topic => topic.id)).toEqual(['bilibili-101']);
  });

  test('the existing topics-only entry rejects when all platforms fail', async () => {
    vi.mocked(fetchBilibiliGameRanking).mockRejectedValue(new Error('anonymous Bilibili error'));
    vi.mocked(fetchBilibiliAnimeRanking).mockRejectedValue(new Error('anonymous Bilibili error'));
    vi.mocked(fetchBilibiliPopular).mockRejectedValue(new Error('anonymous Bilibili error'));
    vi.mocked(fetchAllNgaHotPostsWithStatus).mockRejectedValue(new Error('anonymous NGA error'));
    vi.mocked(fetchXiaoheiheNews).mockRejectedValue(new Error('anonymous Xiaoheihe error'));
    await expect(aggregateCommunityTopics()).rejects.toThrow(/anonymous Bilibili error.*anonymous NGA error.*anonymous Xiaoheihe error/);
  });

  test('keeps degraded NGA topics and reports the comment failure', async () => {
    const title = '原神 anonymous community fixture';
    vi.mocked(fetchAllNgaHotPostsWithStatus).mockResolvedValue({
      posts: [{ tid: 101, fid: 476, author: 'anonymous', subject: title, postdate: timestamp, replies: 1, lastpost: timestamp }]
    });
    vi.mocked(fetchNgaComments).mockRejectedValue(new Error('anonymous NGA comments timeout'));
    vi.mocked(fetchXiaoheiheNews).mockResolvedValue([{ linkid: 102, title, description: '', modify_at: timestamp }]);

    const result = await aggregateCommunityTopicsWithStatus();

    expect(result.sources[1]).toEqual({ source: 'nga', status: 'degraded', error: expect.stringContaining('anonymous NGA comments timeout') });
    expect(result.sources[2]).toEqual({ source: 'xiaoheihe', status: 'healthy' });
    expect(result.topics.map(topic => topic.id)).toEqual(['nga-101']);
  });

  test('marks NGA degraded when only some forums responded', async () => {
    vi.mocked(fetchAllNgaHotPostsWithStatus).mockResolvedValue({
      posts: [{ tid: 103, fid: 476, author: 'anonymous', subject: '原神 anonymous fixture', postdate: timestamp, replies: 1, lastpost: timestamp }],
      error: 'NGA fid=650 failed or missing list'
    });

    const result = await aggregateCommunityTopicsWithStatus();

    expect(result.sources[1]).toEqual({ source: 'nga', status: 'degraded', error: 'NGA fid=650 failed or missing list' });
    expect(result.topics.map(topic => topic.id)).toEqual(['nga-103']);
  });
});
