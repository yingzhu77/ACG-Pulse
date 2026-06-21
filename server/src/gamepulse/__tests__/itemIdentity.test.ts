import { describe, expect, test } from 'vitest';
import { buildFeedItemIdentityKey, canonicalizeIdentityUrl } from '../itemIdentity.js';

describe('feed item identity', () => {
  test('normalizes Bilibili direct and RSSHub external IDs to the same BV identity', () => {
    const direct = buildFeedItemIdentityKey({
      externalId: 'BV1JEjt6QEuN',
      url: 'https://www.bilibili.com/video/BV1JEjt6QEuN'
    });
    const rss = buildFeedItemIdentityKey({
      externalId: 'https://www.bilibili.com/video/BV1JEjt6QEuN',
      url: 'http://bilibili.com/video/BV1JEjt6QEuN/'
    });

    expect(direct).toBe('bilibili:BV1JEJT6QEUN');
    expect(rss).toBe(direct);
  });

  test('normalizes MiHoYo numeric and URL external IDs from the article URL', () => {
    expect(buildFeedItemIdentityKey({
      externalId: '76088177',
      url: 'https://www.miyoushe.com/ys/article/76088177'
    })).toBe('miyoushe:ys:76088177');
    expect(buildFeedItemIdentityKey({
      externalId: 'https://www.miyoushe.com/ys/article/76088177',
      url: 'https://miyoushe.com/ys/article/76088177'
    })).toBe('miyoushe:ys:76088177');
  });

  test('removes protocol, www, fragments and tracking parameters from generic URLs', () => {
    expect(canonicalizeIdentityUrl(
      'http://www.example.com/post/1/?utm_source=test&b=2&a=1#comments'
    )).toBe('example.com/post/1?a=1&b=2');
  });

  test('keeps stable non-URL external IDs for generic sources', () => {
    expect(buildFeedItemIdentityKey({ externalId: 'POST-ABC', url: 'https://example.com/post' }))
      .toBe('external:post-abc');
  });
});
