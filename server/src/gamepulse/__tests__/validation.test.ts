import { describe, expect, test } from 'vitest';
import { CreateSourceSchema, PublicStoriesQuerySchema, SourcePreviewSchema, UpdateSettingsSchema, UpdateSourceSchema } from '../validation.js';

describe('source validation', () => {
  test('parses boolean-like source fields on create', () => {
    const parsed = CreateSourceSchema.parse({
      name: 'Test Source',
      type: 'rss',
      game: '原神',
      isOfficial: 'true',
      followed: 'false',
      enabled: 'false'
    });

    expect(parsed.isOfficial).toBe(true);
    expect(parsed.followed).toBe(false);
    expect(parsed.enabled).toBe(false);
    expect(parsed.priority).toBe(50);
    expect(parsed.config).toBeNull();
  });

  test('does not apply create defaults on partial update', () => {
    const parsed = UpdateSourceSchema.parse({
      name: 'Renamed Source'
    });

    expect(parsed).toEqual({ name: 'Renamed Source' });
  });

  test('validates source preview draft and caps preview limit', () => {
    const parsed = SourcePreviewSchema.parse({
      name: 'Preview Source',
      type: 'rss',
      game: 'Test Game',
      url: 'https://example.com/feed.xml',
      limit: 10
    });

    expect(parsed.limit).toBe(10);
    expect(() => SourcePreviewSchema.parse({ ...parsed, limit: 11 })).toThrow();
  });

  test('allows preview drafts without a game while create keeps requiring one', () => {
    expect(() => CreateSourceSchema.parse({
      name: 'Followed Source',
      type: 'bilibili_video',
      uid: '15319615'
    })).toThrow();

    expect(SourcePreviewSchema.parse({
      name: 'Followed Source',
      type: 'bilibili_video',
      uid: '15319615'
    }).game).toBe('');

    expect(SourcePreviewSchema.parse({
      name: 'Followed Source',
      type: 'bilibili_video',
      uid: '15319615',
      game: '   '
    }).game).toBe('');
  });

  test('rejects unsupported source types', () => {
    expect(() => CreateSourceSchema.parse({
      name: 'Bad Source',
      type: 'webhook',
      game: 'Test Game'
    })).toThrow();
  });

  test('normalizes and validates source config', () => {
    const parsed = CreateSourceSchema.parse({
      name: 'RSSHub Source',
      type: 'rsshub',
      game: 'Test Game',
      config: {
        itemKind: 'official_post',
        rssHubRoutes: ['/mihoyo/bbs/official/2/1/20'],
        fetchTimeoutMs: 10000,
        directApiFallback: 'true'
      }
    });

    expect(JSON.parse(parsed.config || '{}')).toMatchObject({
      itemKind: 'official_post',
      rssHubRoutes: ['/mihoyo/bbs/official/2/1/20'],
      fetchTimeoutMs: 10000,
      directApiFallback: true
    });
  });

  test('rejects malformed source config JSON and invalid known fields', () => {
    expect(() => CreateSourceSchema.parse({
      name: 'Bad Config',
      type: 'rss',
      game: 'Test Game',
      config: '{bad-json'
    })).toThrow();

    expect(() => CreateSourceSchema.parse({
      name: 'Bad Config',
      type: 'rss',
      game: 'Test Game',
      config: { itemKind: 'unknown_kind' }
    })).toThrow();
  });

  test('validates official article selectors and the URL allowlist', () => {
    const input = { name: '示例官网', type: 'official_site', game: '示例游戏' };
    const config = { articleSelector: '.entry', titleSelector: 'h2', linkSelector: 'a', dateSelector: 'time', urlPattern: '/news/\\d+$' };
    expect(JSON.parse(CreateSourceSchema.parse({ ...input, config }).config!)).toEqual(config);
    expect(CreateSourceSchema.safeParse({ ...input, config: { articleSelector: 123 } }).success).toBe(false);
    expect(CreateSourceSchema.safeParse({ ...input, config: { urlPattern: '[' } }).success).toBe(false);
  });
});

describe('settings validation', () => {
  test('allows only editable keys and rejects internal settings', () => {
    expect(UpdateSettingsSchema.parse({ BILIBILI_COOKIE: 'SESSDATA=anonymous' }))
      .toEqual({ BILIBILI_COOKIE: 'SESSDATA=anonymous' });

    expect(UpdateSettingsSchema.safeParse({ COMMUNITY_SOURCE_HEALTH: '[]' }).success).toBe(false);
    expect(UpdateSettingsSchema.safeParse({ BILIBILI_COOKIE: 'SESSDATA=anonymous', COMMUNITY_SOURCE_HEALTH: '[]' }).success).toBe(false);
    expect(UpdateSettingsSchema.safeParse({ BILIBILI_COOKIE: 123 }).success).toBe(false);
  });
});

describe('stories query validation', () => {
  test('includes facets by default and accepts an explicit opt-out', () => {
    expect(PublicStoriesQuerySchema.parse({}).includeFacets).toBe(true);
    expect(PublicStoriesQuerySchema.parse({ includeFacets: 'false' }).includeFacets).toBe(false);
  });
});
