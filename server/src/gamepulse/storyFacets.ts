import type { PublicStory } from './storyAggregation.js';

export interface StoryFacets {
  byGame: Record<string, number>;
  byCategory: Record<string, number>;
  byFollowCategory: Record<string, number>;
  byImportance: Record<string, number>;
}

const FOLLOW_CATEGORIES = new Set(['music', 'trailer', 'movie_trailer', 'creator_video']);

export function emptyStoryFacets(): StoryFacets {
  return { byGame: {}, byCategory: {}, byFollowCategory: {}, byImportance: {} };
}

/**
 * Compute facets from aggregated stories, not raw FeedItems.
 * The public stories page displays StoryCards, so sidebar counts should match
 * the number of stories a user can reach after choosing a filter.
 */
export function computeStoryFacetsFromStories(stories: PublicStory[]): StoryFacets {
  const facets = emptyStoryFacets();

  for (const story of stories) {
    const game = story.game || '其他';
    const category = story.category || 'other';
    const importance = story.importance || 'low';

    if (FOLLOW_CATEGORIES.has(category)) {
      facets.byFollowCategory[category] = (facets.byFollowCategory[category] || 0) + 1;
    } else {
      facets.byGame[game] = (facets.byGame[game] || 0) + 1;
      facets.byCategory[category] = (facets.byCategory[category] || 0) + 1;
    }

    facets.byImportance[importance] = (facets.byImportance[importance] || 0) + 1;
  }

  return facets;
}
