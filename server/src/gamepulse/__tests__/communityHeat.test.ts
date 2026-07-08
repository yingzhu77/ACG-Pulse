import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculateXiaoheiheHeat, normalizeHeatBySource } from '../community/heat.js';

afterEach(() => {
  vi.useRealTimers();
});

function setTestNow() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-08T04:00:00.000Z'));
}

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

describe('xiaoheihe heat scoring', () => {
  it('ranks higher interaction content above low interaction content at the same age', () => {
    setTestNow();
    const modifyAt = Math.floor(Date.now() / 1000) - 3600;

    const lowInteraction = calculateXiaoheiheHeat({ modify_at: modifyAt });
    const highInteraction = calculateXiaoheiheHeat({
      modify_at: modifyAt,
      comment_num: 80,
      link_award_num: 60,
      forward_num: 12,
      topics: [{ hot_value_v2: 50_000 }]
    });

    expect(highInteraction).toBeGreaterThan(lowInteraction);
  });

  it('only lightly lowers controversial high interaction content', () => {
    setTestNow();
    const modifyAt = Math.floor(Date.now() / 1000) - 3600;

    const noInteraction = calculateXiaoheiheHeat({ modify_at: modifyAt });
    const controversialHighInteraction = calculateXiaoheiheHeat({
      modify_at: modifyAt,
      comment_num: 120,
      link_award_num: 90,
      forward_num: 20,
      down: 10_000
    });

    expect(controversialHighInteraction).toBeGreaterThan(noInteraction);
  });

  it('decays older content below newer content with the same signals', () => {
    setTestNow();
    const nowSeconds = Math.floor(Date.now() / 1000);
    const signals = {
      comment_num: 50,
      link_award_num: 30,
      forward_num: 8,
      topics: [{ hot_value_v2: 20_000 }]
    };

    const newer = calculateXiaoheiheHeat({ ...signals, modify_at: nowSeconds - 3600 });
    const older = calculateXiaoheiheHeat({ ...signals, modify_at: nowSeconds - 72 * 3600 });

    expect(older).toBeLessThan(newer);
  });
});
