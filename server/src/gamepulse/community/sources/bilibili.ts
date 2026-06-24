import axios from 'axios';
import { getRandomUserAgent } from './common.js';

export interface BilibiliVideo {
  aid: number;
  bvid: string;
  title: string;
  desc?: string;
  owner?: { name: string; mid: number };
  stat?: { view: number; like: number; reply: number; danmaku: number };
  pubdate?: number;
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
  try {
    const response = await axios.get('https://api.bilibili.com/x/web-interface/ranking/v2', {
      params: { rid, type: 'all' },
      headers: { 'User-Agent': getRandomUserAgent() },
      timeout: 10_000
    });
    return response.data.code === 0 ? (response.data.data?.list || []).slice(0, 20) : [];
  } catch (error) {
    console.error(`[Community] Bilibili ${label} ranking error:`, (error as Error).message);
    return [];
  }
}

export function fetchBilibiliGameRanking(): Promise<BilibiliVideo[]> {
  return fetchRanking(17, 'game');
}

export function fetchBilibiliAnimeRanking(): Promise<BilibiliVideo[]> {
  return fetchRanking(1, 'anime');
}

export async function fetchBilibiliPopular(): Promise<BilibiliVideo[]> {
  try {
    const response = await axios.get('https://api.bilibili.com/x/web-interface/popular', {
      params: { ps: 20, pn: 1 },
      headers: { 'User-Agent': getRandomUserAgent() },
      timeout: 10_000
    });
    return response.data.code === 0 ? (response.data.data?.list || []) : [];
  } catch (error) {
    console.error('[Community] Bilibili popular error:', (error as Error).message);
    return [];
  }
}

async function fetchVideoHotComments(aid: number, limit: number): Promise<BilibiliComment[]> {
  try {
    const response = await axios.get('https://api.bilibili.com/x/v2/reply/main', {
      params: { type: 1, oid: aid, mode: 3, ps: limit },
      headers: { 'User-Agent': getRandomUserAgent() },
      timeout: 10_000
    });
    return response.data.code === 0 ? (response.data.data?.replies || []) : [];
  } catch (error) {
    console.error(`[Community] Bilibili comments aid=${aid} error:`, (error as Error).message);
    return [];
  }
}

export async function fetchBilibiliComments(
  aids: number[],
  concurrency: number,
  limitPerVideo: number
): Promise<BilibiliComment[][]> {
  const results: BilibiliComment[][] = new Array(aids.length);
  for (let i = 0; i < aids.length; i += concurrency) {
    const batch = aids.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map((aid, offset) => fetchVideoHotComments(aid, limitPerVideo)
        .then(comments => { results[i + offset] = comments; }))
    );
    settled.forEach((item, offset) => {
      if (item.status === 'rejected') {
        console.error(`[Community] Comments error for aid=${aids[i + offset]}:`, item.reason);
      }
    });
    if (i + concurrency < aids.length) await new Promise(resolve => setTimeout(resolve, 500));
  }
  return results;
}
