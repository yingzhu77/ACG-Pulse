import { describe, expect, it } from 'vitest';
import { normalizeHeatBySource } from '../community/heat.js';

describe('community heat normalization', () => {
  it('normalizes within each source instead of comparing raw source scales', () => {
    const topics = normalizeHeatBySource([
      { source: 'bilibili', heatScore: 0, rawHeatScore: 1 },
      { source: 'bilibili', heatScore: 0, rawHeatScore: 1000 },
      { source: 'nga', heatScore: 0, rawHeatScore: 5 },
      { source: 'nga', heatScore: 0, rawHeatScore: 10 }
    ]);

    expect(topics.map(topic => topic.heatScore)).toEqual([10, 100, 10, 100]);
    expect(topics.map(topic => topic.rawHeatScore)).toEqual([1, 1000, 5, 10]);
  });

  it('uses the midpoint for a source with only one topic', () => {
    const [topic] = normalizeHeatBySource([{
      source: 'xiaoheihe',
      heatScore: 0,
      rawHeatScore: 50,
      marker: 'untouched'
    }]);
    expect(topic.heatScore).toBe(55);
    expect(topic.rawHeatScore).toBe(50);
    expect(topic.marker).toBe('untouched');
  });
});
