import { describe, expect, it } from 'vitest';
import { normalizeHeatBySource } from '../community/heat.js';

describe('community heat normalization', () => {
  it('normalizes within each source instead of comparing raw source scales', () => {
    const topics = normalizeHeatBySource([
      { source: 'bilibili', heatScore: 1, trend: [1] },
      { source: 'bilibili', heatScore: 1000, trend: [1000] },
      { source: 'nga', heatScore: 5, trend: [5] },
      { source: 'nga', heatScore: 10, trend: [10] }
    ]);

    expect(topics.map(topic => topic.heatScore)).toEqual([10, 100, 10, 100]);
    expect(topics.map(topic => topic.trend)).toEqual([[10], [100], [10], [100]]);
  });

  it('uses the midpoint for a source with only one topic', () => {
    const [topic] = normalizeHeatBySource([{ source: 'xiaoheihe', heatScore: 50, trend: [50] }]);
    expect(topic.heatScore).toBe(55);
  });
});
