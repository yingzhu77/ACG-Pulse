import axios from 'axios';
import * as cheerio from 'cheerio';
import type { Source } from '@prisma/client';
import type { RawFeedItem } from '../types.js';
import { absoluteUrl, getUserAgent, parseSourceConfig, stripHtml } from '../utils.js';
import type { SourceAdapter } from './base.js';
import { AdapterError } from './base.js';

export class RssAdapter implements SourceAdapter {
  type = 'rss' as const;

  async fetch(source: Source): Promise<RawFeedItem[]> {
    if (!source.url) {
      throw new AdapterError('RSS source requires url', source.type);
    }
    return fetchRss(source, source.url);
  }
}

export async function fetchRss(source: Source, feedUrl: string): Promise<RawFeedItem[]> {
  const config = parseSourceConfig(source);
  const timeout = config.fetchTimeoutMs || getRssFetchTimeoutMs();

  const response = await axios.get(feedUrl, {
    timeout,
    headers: {
      'User-Agent': getUserAgent(),
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
    }
  });

  const body = typeof response.data === 'string' ? response.data : String(response.data);
  assertRssLikeContent(body, feedUrl);

  const $ = cheerio.load(body, { xmlMode: true });
  const itemKind = config.itemKind ?? (source.isOfficial ? 'official_post' : 'creator_video');
  const items: RawFeedItem[] = [];

  $('item, entry').slice(0, 30).each((_, element) => {
    const node = $(element);
    const title = clean(node.find('title').first().text());
    const description = node.find('content\\:encoded').first().text()
      || node.find('content').first().text()
      || node.find('summary').first().text()
      || node.find('description').first().text()
      || title;
    const linkText = node.find('link').first().text();
    const href = node.find('link').first().attr('href');
    const rawLink = clean(href || linkText);
    const url = rawLink ? absoluteUrl(feedUrl, rawLink) : '';
    const guid = clean(node.find('guid, id').first().text()) || url;
    const pubDateText = clean(node.find('pubDate, published, updated').first().text());
    const coverUrl = node.find('enclosure').first().attr('url')
      || node.find('media\\:content').first().attr('url')
      || extractFirstImage(description);

    if (!title || !url) return;

    items.push({
      externalId: guid,
      itemKind,
      title,
      content: stripHtml(description),
      url,
      authorName: clean(node.find('author, dc\\:creator').first().text()) || source.name,
      authorUrl: config.authorUrl || source.url || undefined,
      coverUrl,
      publishedAt: pubDateText ? parseDate(pubDateText) : undefined
    });
  });

  return items;
}

function clean(value?: string): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function parseDate(value: string): Date | undefined {
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time);
}

function extractFirstImage(html: string): string | undefined {
  const $ = cheerio.load(html);
  return $('img').first().attr('src') || undefined;
}

function assertRssLikeContent(body: string, feedUrl: string): void {
  const normalized = body.slice(0, 2000).toLowerCase();
  const looksLikeFeed = /<(rss|feed|rdf:rdf|item|entry)(\s|>)/i.test(body);
  if (looksLikeFeed) return;

  if (normalized.includes('just a moment') || normalized.includes('cf_chl_') || normalized.includes('enable javascript and cookies')) {
    throw new Error(`RSS fetch returned an anti-bot challenge page: ${feedUrl}`);
  }

  throw new Error(`RSS fetch returned non-feed content: ${feedUrl}`);
}

function getRssFetchTimeoutMs(): number {
  const parsed = Number(process.env.RSS_FETCH_TIMEOUT_MS);
  if (Number.isFinite(parsed) && parsed >= 5000) return parsed;
  return 30000;
}
