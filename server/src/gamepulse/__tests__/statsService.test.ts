import { describe, expect, test } from 'vitest';
import { buildAnalysisBreakdown, buildHourlyTrend, type AnalysisGroupRow } from '../services/statsService.js';

describe('stats service computations', () => {
  test('buckets timestamps into the latest 24 local hours', () => {
    const now = new Date('2026-06-20T12:30:00+08:00');
    const result = buildHourlyTrend([
      new Date('2026-06-20T12:10:00+08:00'),
      new Date('2026-06-20T12:20:00+08:00'),
      new Date('2026-06-20T11:59:00+08:00'),
      new Date('2026-06-19T12:59:00+08:00'),
    ], now);

    expect(result).toHaveLength(24);
    expect(result.at(-1)?.count).toBe(2);
    expect(result.at(-2)?.count).toBe(1);
    expect(result.reduce((sum, point) => sum + point.count, 0)).toBe(3);
  });

  test('aggregates game, followed-source and normalized importance counts', () => {
    const rows: AnalysisGroupRow[] = [
      { category: 'announcement', importance: 'urgent', followed: 0, count: 3n },
      { category: 'creator_video', importance: 'medium', followed: 1, count: 4n },
      { category: 'other', importance: 'low', followed: 0, count: 2n },
      { category: 'unknown', importance: 'low', followed: 0, count: 9n },
    ];

    expect(buildAnalysisBreakdown(rows)).toEqual({
      byCategory: { announcement: 3, other: 2 },
      byFollowCategory: { creator_video: 4 },
      byImportance: { high: 3, medium: 4, low: 11 },
    });
  });
});
