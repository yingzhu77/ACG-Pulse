import axios from 'axios';
import * as cheerio from 'cheerio';
import type { Source } from '@prisma/client';
import type { RawFeedItem } from '../types.js';
import { absoluteUrl, getUserAgent, parseSourceConfig, stripHtml } from '../utils.js';
import type { SourceAdapter } from './base.js';
import { AdapterError } from './base.js';
import { parseRss } from './rss.js';

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
    if (/<(?:rss|feed|rdf:RDF)(\s|>)/i.test(body.slice(0, 2000))) {
      return parseRss(source, body, source.url);
    }

    const $ = cheerio.load(body);
    const config = parseSourceConfig(source);
    const seen = new Set<string>();
    const items: RawFeedItem[] = [];
    const urlPattern = config.urlPattern ? new RegExp(config.urlPattern) : null;
    const linkSelector = config.linkSelector || 'a[href]';

    $(config.articleSelector || 'article a[href], .news a[href], .post a[href]').each((_, element) => {
      if (items.length >= 20) return false;
      const article = $(element);
      const link = article.is(linkSelector) ? article : article.find(linkSelector).first();
      const titleNode = config.titleSelector
        ? (article.is(config.titleSelector) ? article : article.find(config.titleSelector).first())
        : link;
      const rawTitle = titleNode.text().trim() || titleNode.attr('title') || '';
      const title = rawTitle.replace(/\s+/g, ' ').trim();
      const href = link.attr('href');
      if (!title || !href || href.startsWith('#') || (!config.articleSelector && title.length < 6)) return;

      const url = absoluteUrl(source.url!, href);
      if (seen.has(url) || !/^https?:\/\//.test(url) || (urlPattern && !urlPattern.test(url))) return;
      seen.add(url);

      const scope = config.articleSelector ? article : link.closest('article, li, .news, .post, div');
      const date = scope.find(config.dateSelector || 'time').first();
      const dateText = date.attr('datetime') || date.text().trim();
      const timestamp = dateText ? Date.parse(dateText) : NaN;
      const parentText = scope.text().trim();
      items.push({
        externalId: url,
        itemKind: config.itemKind ?? 'official_post',
        title,
        content: stripHtml(parentText || title),
        url,
        authorName: source.name,
        authorUrl: source.url || undefined,
        publishedAt: Number.isNaN(timestamp) ? undefined : new Date(timestamp)
      });
    });

    return items;
  }
}
