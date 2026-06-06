import axios from 'axios';
import * as cheerio from 'cheerio';
import type { Source } from '@prisma/client';
import type { RawFeedItem } from '../types.js';
import { absoluteUrl, getUserAgent, parseSourceConfig, stripHtml } from '../utils.js';
import type { SourceAdapter } from './base.js';
import { AdapterError } from './base.js';
import { fetchRss } from './rss.js';

export class OfficialSiteAdapter implements SourceAdapter {
  type = 'official_site' as const;

  async fetch(source: Source): Promise<RawFeedItem[]> {
    if (!source.url) {
      throw new AdapterError('Official site source requires url', source.type);
    }

    const response = await axios.get(source.url, {
      timeout: 15000,
      headers: {
        'User-Agent': getUserAgent(),
        Accept: 'text/html, application/rss+xml, application/xml, */*'
      }
    });

    const body = String(response.data);
    if (/^\s*<\?xml|<rss|<feed/i.test(body.slice(0, 500))) {
      return fetchRss(source, source.url);
    }

    const $ = cheerio.load(body);
    const config = parseSourceConfig(source);
    const seen = new Set<string>();
    const items: RawFeedItem[] = [];

    $('article a[href], .news a[href], .post a[href], a[href]').each((_, element) => {
      if (items.length >= 20) return;
      const link = $(element);
      const rawTitle = link.text().trim() || link.attr('title') || '';
      const title = rawTitle.replace(/\s+/g, ' ').trim();
      const href = link.attr('href');
      if (!title || !href || title.length < 6) return;

      const url = absoluteUrl(source.url!, href);
      if (seen.has(url) || !/^https?:\/\//.test(url)) return;
      seen.add(url);

      const parentText = link.closest('article, li, .news, .post, div').text().trim();
      items.push({
        externalId: url,
        itemKind: config.itemKind ?? 'official_post',
        title,
        content: stripHtml(parentText || title),
        url,
        authorName: source.name,
        authorUrl: source.url || undefined
      });
    });

    return items;
  }
}
