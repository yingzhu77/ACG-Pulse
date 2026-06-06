import type { Source, Story } from '../services/api';

export function summarizeHealth(sources: Source[]) {
  return sources.reduce(
    (acc, source) => {
      if (source.healthStatus === 'healthy') acc.healthy++;
      else if (source.healthStatus === 'failed') acc.failed++;
      else acc.unknown++;
      return acc;
    },
    { healthy: 0, failed: 0, unknown: 0 }
  );
}

export function estimateDedupRate(stories: Story[]): number {
  const totalItems = stories.reduce((sum, story) => sum + story.itemCount, 0);
  if (!totalItems) return 0;
  return Math.round(((totalItems - stories.length) / totalItems) * 100);
}
