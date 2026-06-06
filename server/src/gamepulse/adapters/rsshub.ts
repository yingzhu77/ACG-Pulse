import type { Source } from '@prisma/client';
import axios from 'axios';
import type { RawFeedItem } from '../types.js';
import { parseSourceConfig } from '../utils.js';
import type { SourceAdapter } from './base.js';
import { AdapterError } from './base.js';
import { fetchRss } from './rss.js';

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
      if (isEmptyRssHubRoute(error)) {
        return [];
      }
      errors.push(formatError(feedUrl, error));
    }
  }

  throw new AdapterError(`RSSHub route failed: ${routeOrUrl}; ${errors.join(' | ')}`, source.type);
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

function isEmptyRssHubRoute(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const body = typeof error.response?.data === 'string'
    ? error.response.data
    : JSON.stringify(error.response?.data || {});
  return body.includes('this route is empty');
}
