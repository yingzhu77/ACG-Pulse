import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ensureFTS5,
  rebuildFTS5,
  searchFeedItems,
  isFTS5Ready,
  dropFTS5
} from '../search.js';
import { prisma } from '../../db.js';

// Mock Prisma for unit tests
vi.mock('../../db.js', () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(),
    $executeRawUnsafe: vi.fn()
  }
}));

const mockPrisma = vi.mocked(prisma);

/**
 * Mock the full isFTS5Ready check sequence:
 * 1. ftsExists() → sqlite_master check
 * 2. triggerExists('FeedItem_ai')
 * 3. triggerExists('FeedItem_ad')
 * 4. triggerExists('FeedItem_au')
 * 5. COUNT(*) query
 */
function mockIsFTS5ReadySequence(tableExists: boolean, triggersAllExist = true, count = 100) {
  if (!tableExists) {
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([]); // ftsExists → false
    return;
  }
  mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ name: 'FeedItemFTS' }]); // ftsExists → true
  if (triggersAllExist) {
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ name: 'FeedItem_ai' }]);
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ name: 'FeedItem_ad' }]);
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ name: 'FeedItem_au' }]);
  } else {
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ name: 'FeedItem_ai' }]);
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([]); // FeedItem_ad missing
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ name: 'FeedItem_au' }]);
  }
  mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ cnt: count }]); // count
}

describe('FTS5 Search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$queryRawUnsafe.mockReset();
    mockPrisma.$executeRawUnsafe.mockReset();
  });

  describe('ensureFTS5', () => {
    it('should create FTS5 table + triggers when nothing exists', async () => {
      // Table does not exist, all 3 triggers missing
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([])  // ftsExists → false
        .mockResolvedValueOnce([])  // triggerExists('FeedItem_ai') → missing
        .mockResolvedValueOnce([])  // triggerExists('FeedItem_ad') → missing
        .mockResolvedValueOnce([]); // triggerExists('FeedItem_au') → missing
      mockPrisma.$executeRawUnsafe.mockResolvedValue(0);
      // rebuildFTS5 uses DELETE + INSERT
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([]);

      await ensureFTS5();

      // Should create virtual table
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('CREATE VIRTUAL TABLE')
      );

      // Should drop old triggers first
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('DROP TRIGGER IF EXISTS FeedItem_ai')
      );
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('DROP TRIGGER IF EXISTS FeedItem_ad')
      );
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('DROP TRIGGER IF EXISTS FeedItem_au')
      );

      // Should create triggers with DELETE FROM approach (not FTS5 'delete' command)
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TRIGGER FeedItem_ai')
      );
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TRIGGER FeedItem_ad')
      );
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TRIGGER FeedItem_au')
      );

      // Delete trigger should use DELETE FROM, not FTS5 'delete' command
      const deleteCalls = mockPrisma.$executeRawUnsafe.mock.calls.map(c => c[0]);
      const adTrigger = deleteCalls.find((c: string) => c.includes('CREATE TRIGGER FeedItem_ad'));
      expect(adTrigger).toContain('DELETE FROM');
      expect(adTrigger).not.toContain("VALUES('delete'");
    });

    it('should skip everything if table and all triggers exist', async () => {
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ name: 'FeedItemFTS' }])  // ftsExists → true
        .mockResolvedValueOnce([{ name: 'FeedItem_ai' }])   // triggerExists → exists
        .mockResolvedValueOnce([{ name: 'FeedItem_ad' }])   // triggerExists → exists
        .mockResolvedValueOnce([{ name: 'FeedItem_au' }]);  // triggerExists → exists

      await ensureFTS5();

      // Should not create anything
      expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('should repair missing triggers when table exists', async () => {
      // Table exists, but FeedItem_ad and FeedItem_au are missing
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ name: 'FeedItemFTS' }])  // ftsExists → true
        .mockResolvedValueOnce([{ name: 'FeedItem_ai' }])   // triggerExists('FeedItem_ai') → exists
        .mockResolvedValueOnce([])                           // triggerExists('FeedItem_ad') → missing
        .mockResolvedValueOnce([])                           // triggerExists('FeedItem_au') → missing
        .mockResolvedValueOnce([]);                          // rebuildFTS5 count query
      mockPrisma.$executeRawUnsafe.mockResolvedValue(0);

      await ensureFTS5();

      // Should NOT create virtual table (it already exists)
      expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalledWith(
        expect.stringContaining('CREATE VIRTUAL TABLE')
      );

      // Should drop old triggers before recreating
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('DROP TRIGGER IF EXISTS FeedItem_ai')
      );

      // Should create all triggers
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TRIGGER FeedItem_ad')
      );
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TRIGGER FeedItem_au')
      );

      // Should rebuild index (data may be out of sync)
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM FeedItemFTS')
      );
    });

    it('should repair when only one trigger is missing', async () => {
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ name: 'FeedItemFTS' }])  // ftsExists → true
        .mockResolvedValueOnce([{ name: 'FeedItem_ai' }])   // triggerExists → exists
        .mockResolvedValueOnce([{ name: 'FeedItem_ad' }])   // triggerExists → exists
        .mockResolvedValueOnce([])                           // triggerExists('FeedItem_au') → missing
        .mockResolvedValueOnce([]);                          // rebuildFTS5 count query
      mockPrisma.$executeRawUnsafe.mockResolvedValue(0);

      await ensureFTS5();

      // Should rebuild (trigger was missing, data may be stale)
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM FeedItemFTS')
      );
    });
  });

  describe('searchFeedItems', () => {
    it('should return empty for empty query', async () => {
      const result = await searchFeedItems('');
      expect(result.feedItemIds).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should search and return matching feedItemIds', async () => {
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ name: 'FeedItemFTS' }])  // ftsExists
        .mockResolvedValueOnce([
          { feedItemId: 'id1', rank: -0.5 },
          { feedItemId: 'id2', rank: -0.3 }
        ])
        .mockResolvedValueOnce([{ total: 2 }]);

      const result = await searchFeedItems('原神', { limit: 10, offset: 0 });

      expect(result.feedItemIds).toEqual(['id1', 'id2']);
      expect(result.total).toBe(2);
    });

    it('should fallback gracefully on FTS query error', async () => {
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ name: 'FeedItemFTS' }])  // ftsExists
        .mockRejectedValueOnce(new Error('FTS syntax error'));

      const result = await searchFeedItems('invalid [query');

      expect(result.feedItemIds).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should return empty if FTS table does not exist', async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([]);

      const result = await searchFeedItems('test');

      expect(result.feedItemIds).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('isFTS5Ready', () => {
    it('should return true if FTS exists with data and all triggers', async () => {
      mockIsFTS5ReadySequence(true, true, 100);

      const ready = await isFTS5Ready();
      expect(ready).toBe(true);
    });

    it('should return false if FTS does not exist', async () => {
      mockIsFTS5ReadySequence(false);

      const ready = await isFTS5Ready();
      expect(ready).toBe(false);
    });

    it('should return false if FTS exists but is empty', async () => {
      mockIsFTS5ReadySequence(true, true, 0);

      const ready = await isFTS5Ready();
      expect(ready).toBe(false);
    });

    it('should return false if FTS exists but triggers are missing', async () => {
      mockIsFTS5ReadySequence(true, false, 100);

      const ready = await isFTS5Ready();
      expect(ready).toBe(false);
    });
  });

  describe('dropFTS5', () => {
    it('should drop triggers and table', async () => {
      mockPrisma.$executeRawUnsafe.mockResolvedValue(0);

      await dropFTS5();

      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('DROP TRIGGER IF EXISTS FeedItem_ai')
      );
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('DROP TRIGGER IF EXISTS FeedItem_ad')
      );
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('DROP TRIGGER IF EXISTS FeedItem_au')
      );
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('DROP TABLE IF EXISTS FeedItemFTS')
      );
    });
  });
});
