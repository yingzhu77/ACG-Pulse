import type { Source } from '@prisma/client';
import axios from 'axios';
import type { RawFeedItem } from '../types.js';
import { parseSourceConfig } from '../utils.js';
import type { SourceAdapter } from './base.js';
import { AdapterError } from './base.js';
import { fetchRss } from './rss.js';
import { filterValidItems } from '../community/sources/common.js';

export class RssHubAdapter implements SourceAdapter {
  type = 'rsshub' as const;

  async fetch(source: Source): Promise<RawFeedItem[]> {
    const config = parseSourceConfig(source);
    const routes = unique([
      source.route,
      config.route,
      source.url,
      ...(config.routeFallbacks || [])
    ]);

    if (!routes.length) {
      throw new AdapterError('RSSHub source requires route or url', source.type);
    }

    const errors: string[] = [];
    for (const route of routes) {
      try {
        return await fetchRssHubRoute(source, route);
      } catch (error) {
        errors.push(formatError(route, error));
      }
    }

    throw new AdapterError(`RSSHub source failed: ${errors.join(' | ')}`, source.type);
  }
}

export async function fetchRssHubRoute(source: Source, routeOrUrl: string): Promise<RawFeedItem[]> {
  if (routeOrUrl.startsWith('http')) {
    return fetchRss(source, routeOrUrl);
  }

  const baseUrls = getRssHubBaseUrls(source);
  const errors: string[] = [];

  for (const baseUrl of baseUrls) {
    const feedUrl = joinUrl(baseUrl, routeOrUrl);
    try {
      return await fetchRss(source, feedUrl);
    } catch (error) {
      errors.push(formatError(feedUrl, error));
    }
  }

  try {
    const directMihoyoItems = await fetchMihoyoOfficialFallback(source, routeOrUrl);
    if (directMihoyoItems) return directMihoyoItems;
  } catch (error) {
    errors.push(formatError('MiHoYo direct fallback', error));
  }

  throw new AdapterError(`RSSHub route failed: ${routeOrUrl}; ${errors.join(' | ')}`, source.type);
}

async function fetchMihoyoOfficialFallback(source: Source, routeOrUrl: string): Promise<RawFeedItem[] | null> {
  const match = routeOrUrl.match(/^\/?mihoyo\/bbs\/official\/(\d+)\/(\d+)\/(\d+)/);
  if (!match) return null;

  const [, gids, type, limit] = match;
  const config = parseSourceConfig(source);
  const apiUrl = 'https://bbs-api-static.miyoushe.com/painter/wapi/getNewsList';

  try {
    const resp = await axios.get(apiUrl, {
      params: {
        client_type: 4,
        gids,
        type,
        page_size: Math.min(Math.max(Number(limit) || 20, 1), 50),
        last_id: ''
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        Referer: 'https://www.miyoushe.com/'
      },
      timeout: 10000
    });

    if (resp.data?.retcode !== 0 || !Array.isArray(resp.data?.data?.list)) {
      throw new Error(`MiHoYo response failed or missing list (retcode=${resp.data?.retcode}, message=${resp.data?.message || ''})`);
    }
    const list: MihoyoNewsEntry[] = resp.data.data.list;
    return filterValidItems(
      list,
      entry => Boolean(entry?.post?.post_id)
        && typeof entry.post.subject === 'string'
        && entry.post.subject.trim().length > 0,
      'MiHoYo'
    )
      .map((entry: MihoyoNewsEntry): RawFeedItem => {
        const post = entry.post;
        const summary = post.summary || post.content || post.subject;
        return {
          externalId: post.post_id,
          itemKind: config.itemKind ?? 'official_post',
          title: post.subject,
          content: summary,
          url: `https://www.miyoushe.com/${mihoyoSiteFromGids(gids)}/article/${post.post_id}`,
          authorName: source.name,
          coverUrl: entry.cover?.url || post.cover || post.images?.[0],
          publishedAt: post.created_at ? new Date(post.created_at * 1000) : undefined
        };
      });
  } catch (error) {
    throw new AdapterError(`MiHoYo direct fallback failed: ${error instanceof Error ? error.message : String(error)}`, source.type);
  }
}

function mihoyoSiteFromGids(gids: string): string {
  const map: Record<string, string> = {
    '1': 'bh3',
    '2': 'ys',
    '6': 'sr',
    '8': 'zzz'
  };
  return map[gids] || 'ys';
}

interface MihoyoNewsEntry {
  post: {
    post_id: string;
    subject: string;
    content?: string;
    summary?: string;
    cover?: string;
    images?: string[];
    created_at?: number;
  };
  cover?: {
    url?: string;
  };
}

export function getRssHubBaseUrls(source?: Source): string[] {
  const config = source ? parseSourceConfig(source) : {};
  const configured = unique([
    ...(config.rssHubBaseUrls || []),
    ...splitList(process.env.RSSHUB_BASE_URLS),
    process.env.RSSHUB_BASE_URL
  ]);
  return configured.length ? configured : ['https://rsshub.app'];
}

function joinUrl(baseUrl: string, route: string): string {
  return `${baseUrl.replace(/\/$/, '')}/${route.replace(/^\//, '')}`;
}

function splitList(value?: string): string[] {
  return (value || '')
    .split(/[,;\s]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map(item => item?.trim()).filter(Boolean) as string[]));
}

function formatError(scope: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${scope} -> ${message}`;
}
