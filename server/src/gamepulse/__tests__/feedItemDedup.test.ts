import { describe, expect, test, vi } from 'vitest';

vi.mock('../../db.js', () => ({ prisma: {} }));
vi.mock('../services/statsService.js', () => ({ invalidatePublicStatsCache: vi.fn() }));

import { planFeedItemIdentityBackfill } from '../services/feedItemDedup.js';

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    sourceId: 'source-1',
    externalId: 'POST-1',
    url: 'https://example.com/post/1',
    identityKey: null,
    hidden: false,
    coverUrl: null,
    publishedAt: new Date('2026-06-21T10:00:00Z'),
    createdAt: new Date('2026-06-21T10:00:00Z'),
    analysis: { status: 'completed', importance: 'low', confidence: 70 },
    ...overrides
  };
}

describe('feed item identity backfill', () => {
  test('keeps the strongest analysis for duplicate platform identities', () => {
    const plan = planFeedItemIdentityBackfill([
      candidate({ id: 'low', externalId: 'BV1JEjt6QEuN', url: 'https://bilibili.com/video/BV1JEjt6QEuN' }),
      candidate({
        id: 'high',
        externalId: 'https://www.bilibili.com/video/BV1JEjt6QEuN',
        url: 'https://www.bilibili.com/video/BV1JEjt6QEuN',
        analysis: { status: 'completed', importance: 'high', confidence: 92 }
      })
    ]);

    expect(plan.duplicateIds).toEqual(['low']);
    expect(plan.assignments).toEqual([{ id: 'high', identityKey: 'bilibili:BV1JEJT6QEUN' }]);
  });

  test('never merges identical identities from different sources', () => {
    const plan = planFeedItemIdentityBackfill([
      candidate({ id: 'source-a', sourceId: 'source-a' }),
      candidate({ id: 'source-b', sourceId: 'source-b' })
    ]);

    expect(plan.duplicateIds).toEqual([]);
    expect(plan.assignments).toHaveLength(2);
  });

  test('prefers an already migrated keeper during a resumed backfill', () => {
    const plan = planFeedItemIdentityBackfill([
      candidate({ id: 'migrated', identityKey: 'external:post-1', hidden: true }),
      candidate({ id: 'pending', hidden: false })
    ]);

    expect(plan.duplicateIds).toEqual(['pending']);
    expect(plan.assignments).toEqual([]);
  });
});
