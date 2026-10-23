import axios from 'axios';
import { filterValidItems, getRandomUserAgent, settleCommunityRequests } from './common.js';

export interface BilibiliVideo {
  aid: number;
  bvid: string;
  title: string;
  desc?: string;
  owner?: { name: string; mid: number };
  stat?: { view: number; like: number; reply: number; danmaku: number };
  pubdate: number;
  tag?: string[];
  tname?: string;
}

export interface BilibiliComment {
  rpid: number;
  content?: { message: string };
  member?: { uname: string };
  like?: number;
}

async function fetchRanking(rid: number, label: string): Promise<BilibiliVideo[]> {
  const response = await axios.get('https://api.bilibili.com/x/web-interface/ranking/v2', {
    params: { rid, type: 'all' },
    headers: { 'User-Agent': getRandomUserAgent() },
    timeout: 10_000
  });
  return parseVideoList(response.data, `${label} ranking`).slice(0, 20);
}

export function fetchBilibiliGameRanking(): Promise<BilibiliVideo[]> {
  return fetchRanking(17, 'game');
}

export function fetchBilibiliAnimeRanking(): Promise<BilibiliVideo[]> {
  return fetchRanking(1, 'anime');
}

export async function fetchBilibiliPopular(): Promise<BilibiliVideo[]> {
  const response = await axios.get('https://api.bilibili.com/x/web-interface/popular', {
    params: { ps: 20, pn: 1 },
    headers: { 'User-Agent': getRandomUserAgent() },
    timeout: 10_000
  });
  return parseVideoList(response.data, 'popular');
}

function parseVideoList(body: { code?: number; message?: string; data?: { list?: BilibiliVideo[] } }, label: string): BilibiliVideo[] {
  if (body?.code !== 0 || !Array.isArray(body.data?.list)) {
    throw new Error(`Bilibili ${label} failed or missing list (code=${body?.code}, message=${body?.message || ''})`);
  }
  return filterValidItems(
    body.data.list,
    video => Boolean(video?.aid)
      && typeof video.bvid === 'string'
      && video.bvid.length > 0
      && typeof video.title === 'string'
      && video.title.trim().length > 0
      && Number.isFinite(video.pubdate)
      && video.pubdate > 0,
    `Bilibili ${label}`
  );
}

async function fetchVideoHotComments(aid: number, limit: number): Promise<BilibiliComment[]> {
  const response = await axios.get('https://api.bilibili.com/x/v2/reply/main', {
    params: { type: 1, oid: aid, mode: 3, ps: limit },
    headers: { 'User-Agent': getRandomUserAgent() },
    timeout: 10_000
  });
  const body = response.data;
  if (body?.code !== 0 || !body.data || typeof body.data !== 'object' || !('replies' in body.data)
    || (body.data.replies !== null && !Array.isArray(body.data.replies))) {
    throw new Error(`Bilibili comments aid=${aid} failed or missing replies (code=${body?.code}, message=${body?.message || ''})`);
  }
  return body.data.replies || [];
}

export async function fetchBilibiliComments(
  aids: number[],
  concurrency: number,
  limitPerVideo: number
): Promise<BilibiliComment[][]> {
  const results: BilibiliComment[][] = new Array(aids.length);
  for (let i = 0; i < aids.length; i += concurrency) {
    const batch = aids.slice(i, i + concurrency);
    await settleCommunityRequests(
      batch.map((aid, offset) => fetchVideoHotComments(aid, limitPerVideo)
        .then(comments => { results[i + offset] = comments; })),
      'Bilibili comments failed'
    );
    if (i + concurrency < aids.length) await new Promise(resolve => setTimeout(resolve, 500));
  }
  return results;
}
