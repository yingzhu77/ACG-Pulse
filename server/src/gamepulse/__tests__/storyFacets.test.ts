import { describe, expect, test } from 'vitest';
import { computeStoryFacetsFromStories, emptyStoryFacets } from '../storyFacets.js';
import type { PublicStory } from '../storyAggregation.js';

function makeStory(overrides: Partial<PublicStory> = {}): PublicStory {
  return {
    id: `story_${Math.random().toString(36).slice(2, 8)}`,
    canonicalTitle: '测试故事',
    game: '原神',
    category: 'announcement',
    importance: 'medium',
    visibility: 'public',
    summary: null,
    reason: null,
    coverUrl: null,
    publishedAt: new Date('2026-06-01T10:00:00Z'),
    fetchedAt: new Date('2026-06-01T10:05:00Z'),
    createdAt: new Date('2026-06-01T10:05:00Z'),
    sourceCount: 1,
    itemCount: 1,
    sources: [],
    items: [],
    ...overrides
  };
}

describe('story facets', () => {
  test('returns empty facets for skipped calculations', () => {
    expect(emptyStoryFacets()).toEqual({
      byGame: {},
      byCategory: {},
      byFollowCategory: {},
      byImportance: {}
    });
  });

  test('counts aggregated stories instead of raw feed items', () => {
    const stories = [
      makeStory({
        game: '原神',
        category: 'version',
        importance: 'high',
        sourceCount: 3,
        itemCount: 3
      }),
      makeStory({
        game: '原神',
        category: 'event',
        importance: 'medium',
        sourceCount: 1,
        itemCount: 1
      })
    ];

    expect(computeStoryFacetsFromStories(stories)).toEqual({
      byGame: { 原神: 2 },
      byCategory: { version: 1, event: 1 },
      byFollowCategory: {},
      byImportance: { high: 1, medium: 1 }
    });
  });

  test('separates followed content categories from game categories', () => {
    const stories = [
      makeStory({ game: '', category: 'music', importance: 'low' }),
      makeStory({ game: '', category: 'creator_video', importance: 'medium' }),
      makeStory({ game: '崩坏：星穹铁道', category: null, importance: 'high' })
    ];

    expect(computeStoryFacetsFromStories(stories)).toEqual({
      byGame: { '崩坏：星穹铁道': 1 },
      byCategory: { other: 1 },
      byFollowCategory: { music: 1, creator_video: 1 },
      byImportance: { low: 1, medium: 1, high: 1 }
    });
  });
});
