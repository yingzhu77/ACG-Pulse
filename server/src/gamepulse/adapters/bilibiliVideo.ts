import axios from 'axios';
import crypto from 'crypto';
import type { Source } from '@prisma/client';
import type { RawFeedItem } from '../types.js';
import { getUserAgent, parseSourceConfig } from '../utils.js';
import type { SourceAdapter } from './base.js';
import { AdapterError } from './base.js';
import { fetchRssHubRoute } from './rsshub.js';

function generateBuvid3(): string {
  const hex = crypto.randomBytes(16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}infoc`;
}

interface BilibiliSpaceResponse {
  code: number;
  message?: string;
  data?: {
    list?: {
      vlist?: BilibiliVideo[];
    };
  };
}

interface BilibiliVideo {
  aid: number;
  bvid: string;
  title: string;
  description?: string;
  author: string;
  mid: number;
  pic?: string;
  play?: number;
  comment?: number;
  review?: number;
  created: number;
}

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
];

let cachedWbiKeys: { imgKey: string; subKey: string; cookie: string; fetchedAt: number } | null = null;
const WBI_KEY_TTL = 30 * 60 * 1000; // 30 minutes
let lastRequestTime = 0;
const DEFAULT_REQUEST_INTERVAL = 6000; // ms between direct B站 requests

async function getBilibiliCookie(): Promise<string> {
  if (process.env.BILIBILI_COOKIE?.trim()) {
    return process.env.BILIBILI_COOKIE.trim();
  }

  // 从数据库设置中读取 Cookie
  try {
    const { prisma } = await import('../../db.js');
    const setting = await prisma.setting.findUnique({ where: { key: 'BILIBILI_COOKIE' } });
    if (setting?.value?.trim()) return setting.value.trim();
  } catch { /* ignore */ }

  // 优先用 finger/spi 接口获取真实的 buvid3 和 buvid4
  try {
    const spiResp = await axios.get('https://api.bilibili.com/x/frontend/finger/spi', {
      headers: { 'User-Agent': getUserAgent() },
      timeout: 8000
    });
    const b3 = spiResp.data?.data?.b_3;
    const b4 = spiResp.data?.data?.b_4;
    if (b3 && b4) {
      return `buvid3=${b3}; buvid4=${b4}; b_nut=100`;
    }
  } catch (e) {
    console.warn('[Bilibili] finger/spi failed:', (e as Error).message);
  }

  // 兜底：访问首页抓 Set-Cookie
  try {
    const resp = await axios.get('https://www.bilibili.com/', {
      headers: { 'User-Agent': getUserAgent() },
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: () => true
    });
    const setCookies: string[] = resp.headers['set-cookie'] || [];
    const wanted = ['buvid3', 'b_nut', 'buvid4'];
    const pairs: string[] = [];
    for (const sc of setCookies) {
      const [kv] = sc.split(';');
      const [name] = kv.split('=');
      if (wanted.includes(name.trim())) pairs.push(kv.trim());
    }
    if (pairs.length) return pairs.join('; ');
  } catch (e) {
    console.warn('[Bilibili] homepage cookie fetch failed:', (e as Error).message);
  }

  return `buvid3=${generateBuvid3()}; b_nut=100`;
}

function getMixinKey(orig: string): string {
  return MIXIN_KEY_ENC_TAB.map(i => orig[i]).join('').slice(0, 32);
}

async function fetchWbiKeys(): Promise<{ imgKey: string; subKey: string; cookie: string }> {
  if (cachedWbiKeys && Date.now() - cachedWbiKeys.fetchedAt < WBI_KEY_TTL) {
    return { imgKey: cachedWbiKeys.imgKey, subKey: cachedWbiKeys.subKey, cookie: cachedWbiKeys.cookie };
  }

  const cookie = await getBilibiliCookie();
  const resp = await axios.get('https://api.bilibili.com/x/web-interface/nav', {
    headers: {
      'User-Agent': getUserAgent(),
      Cookie: cookie
    },
    timeout: 10000
  });

  const wbiImg = resp.data?.data?.wbi_img;
  if (!wbiImg?.img_url || !wbiImg?.sub_url) {
    throw new Error('Failed to get wbi keys from bilibili nav API');
  }

  const imgKey = wbiImg.img_url.split('/').pop()!.split('.')[0];
  const subKey = wbiImg.sub_url.split('/').pop()!.split('.')[0];
  cachedWbiKeys = { imgKey, subKey, cookie, fetchedAt: Date.now() };
  return { imgKey, subKey, cookie };
}

function encWbi(params: Record<string, string | number>, imgKey: string, subKey: string): Record<string, string> {
  const mixinKey = getMixinKey(imgKey + subKey);
  const wts = Math.round(Date.now() / 1000);
  const merged: Record<string, string | number> = { ...params, wts };

  const sorted = Object.keys(merged)
    .sort()
    .reduce<Record<string, string>>((acc, key) => {
      const val = String(merged[key]).replace(/[!'()*]/g, '');
      acc[key] = val;
      return acc;
    }, {});

  const query = Object.entries(sorted).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const wbiSign = crypto.createHash('md5').update(query + mixinKey).digest('hex');
  return { ...sorted, w_rid: wbiSign };
}

export class BilibiliVideoAdapter implements SourceAdapter {
  type = 'bilibili_video' as const;

  async fetch(source: Source): Promise<RawFeedItem[]> {
    const uid = source.uid || extractUid(source.url || '');
    if (!uid) {
      throw new AdapterError('Bilibili video source requires uid or space url', source.type);
    }

    const config = parseSourceConfig(source);
    const rssHubErrors: string[] = [];
    for (const route of getBilibiliRssHubRoutes(source, uid)) {
      try {
        const items = await fetchRssHubRoute(source, route);
        if (items.length) return items;
        rssHubErrors.push(`${route} -> returned 0 items`);
      } catch (error) {
        rssHubErrors.push(formatError(route, error));
      }
    }

    if (!shouldUseDirectApiFallback(config.directApiFallback)) {
      throw new AdapterError(
        `Bilibili RSSHub fallback failed and direct API fallback is disabled. ${rssHubErrors.join(' | ')}`,
        source.type
      );
    }

    return fetchDirectBilibiliVideos(source, uid, rssHubErrors);
  }
}

export async function fetchBilibiliAvatar(uid: string): Promise<string | undefined> {
  try {
    const cookie = await getBilibiliCookie();
    const { imgKey, subKey } = await fetchWbiKeys();
    const params = { mid: uid };
    const signedParams = encWbi(params, imgKey, subKey);

    const response = await axios.get('https://api.bilibili.com/x/space/wbi/acc/info', {
      params: signedParams,
      headers: {
        'User-Agent': getUserAgent(),
        Cookie: cookie
      },
      timeout: 10000
    });

    return response.data?.data?.face || undefined;
  } catch (error) {
    console.warn(`[Bilibili] Failed to fetch avatar for uid ${uid}:`, (error as Error).message);
    return undefined;
  }
}

async function fetchDirectBilibiliVideos(
  source: Source,
  uid: string,
  rssHubErrors: string[]
): Promise<RawFeedItem[]> {
  const interval = getDirectRequestInterval();
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < interval) {
    await new Promise(resolve => setTimeout(resolve, interval - elapsed));
  }
  lastRequestTime = Date.now();

  const { imgKey, subKey, cookie } = await fetchWbiKeys();
  const signedParams = encWbi(getDirectApiParams(uid), imgKey, subKey);

  let response: Awaited<ReturnType<typeof axios.get<BilibiliSpaceResponse>>>;
  try {
    response = await requestBilibiliSpaceVideos(uid, signedParams, cookie);
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response?.status === 412) {
      cachedWbiKeys = null;
      await new Promise(resolve => setTimeout(resolve, 5000));
      const retryKeys = await fetchWbiKeys();
      const retryParams = encWbi(getDirectApiParams(uid), retryKeys.imgKey, retryKeys.subKey);
      response = await requestBilibiliSpaceVideos(uid, retryParams, retryKeys.cookie);
    } else {
      throw err;
    }
  }

  if (response.data.code !== 0) {
    throw new AdapterError(
      `Bilibili RSSHub fallback failed (${rssHubErrors.join(' | ')}); direct API error: ${response.data.message || response.data.code}`,
      source.type
    );
  }

  const config = parseSourceConfig(source);
  const videos = response.data.data?.list?.vlist || [];
  return videos.map(video => ({
    externalId: video.bvid || String(video.aid),
    itemKind: config.itemKind ?? (source.isOfficial ? 'official_post' : 'creator_video'),
    title: video.title,
    content: video.description || video.title,
    url: `https://www.bilibili.com/video/${video.bvid}`,
    authorName: video.author || source.name,
    authorUrl: `https://space.bilibili.com/${video.mid || uid}`,
    coverUrl: normalizeCover(video.pic),
    publishedAt: video.created ? new Date(video.created * 1000) : undefined
  }));
}

function getDirectApiParams(uid: string): Record<string, string | number> {
  return {
    mid: uid,
    pn: 1,
    ps: 20,
    order: 'pubdate',
    dm_img_list: '[]',
    dm_img_str: 'V2ViR0w=',
    dm_cover_img_str: 'QU5HTEUgKE5WSURJQSBHZUZvcmNlIEdUWCA5NTAgICAgICAgICAgICAgICAgICApIERpcmVjdDNEMTEgdnNfNV8wIHBzXzVfMCwgRDNEMTEp'
  };
}

function requestBilibiliSpaceVideos(
  uid: string,
  params: Record<string, string>,
  cookie: string
): Promise<Awaited<ReturnType<typeof axios.get<BilibiliSpaceResponse>>>> {
  return axios.get<BilibiliSpaceResponse>(
    'https://api.bilibili.com/x/space/wbi/arc/search',
    {
      params,
      headers: {
        'User-Agent': getUserAgent(),
        Referer: `https://space.bilibili.com/${uid}`,
        Accept: 'application/json',
        Cookie: cookie
      },
      timeout: getDirectRequestTimeout()
    }
  );
}

function getBilibiliRssHubRoutes(source: Source, uid: string): string[] {
  const config = parseSourceConfig(source);
  const includeDynamic = config.includeDynamic === true || parseBoolean(process.env.BILIBILI_INCLUDE_DYNAMIC, false);
  const configuredRoutes = [
    source.route,
    config.route,
    ...(config.rssHubRoutes || []),
    ...(config.routeFallbacks || [])
  ].map(route => route?.replace(/\{uid\}|:uid/g, uid));

  return unique([
    ...configuredRoutes,
    `/bilibili/user/video/${uid}`,
    includeDynamic ? `/bilibili/user/dynamic/${uid}` : null
  ]);
}

function shouldUseDirectApiFallback(sourceSetting?: boolean): boolean {
  if (typeof sourceSetting === 'boolean') return sourceSetting;
  if (process.env.BILIBILI_COOKIE?.trim()) return true;
  return parseBoolean(process.env.BILIBILI_DIRECT_API_FALLBACK, false);
}

function getDirectRequestInterval(): number {
  return parsePositiveNumber(process.env.BILIBILI_REQUEST_INTERVAL_MS, DEFAULT_REQUEST_INTERVAL);
}

function getDirectRequestTimeout(): number {
  return parsePositiveNumber(process.env.BILIBILI_DIRECT_API_TIMEOUT_MS, 30000);
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map(item => item?.trim()).filter(Boolean) as string[]));
}

function formatError(scope: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${scope} -> ${message}`;
}

function extractUid(url: string): string | undefined {
  const match = url.match(/space\.bilibili\.com\/(\d+)/);
  return match?.[1];
}

function normalizeCover(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('//')) return `https:${url}`;
  return url;
}
