import { describe, expect, test } from 'vitest';
import { CreateSourceSchema, PublicStoriesQuerySchema, SourcePreviewSchema, UpdateSourceSchema } from '../validation.js';

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
});

describe('stories query validation', () => {
  test('includes facets by default and accepts an explicit opt-out', () => {
    expect(PublicStoriesQuerySchema.parse({}).includeFacets).toBe(true);
    expect(PublicStoriesQuerySchema.parse({ includeFacets: 'false' }).includeFacets).toBe(false);
  });
});
