import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Real SQLite integration test for FTS5 lifecycle.
 * Uses node:sqlite (Node.js built-in) with in-memory database.
 *
 * Tests the actual SQL patterns used by search.ts:
 * - FTS5 virtual table with tokenize='unicode61'
 * - Trigger-based sync using DELETE FROM ... WHERE rowid IN (SELECT ...)
 *   (NOT the FTS5 'delete' command which doesn't work in all SQLite builds)
 * - Insert, update, delete lifecycle
 * - Trigger repair after missing trigger detection
 * - Full rebuild consistency
 *
 * Note: CJK single-character search may not work with unicode61 tokenizer
 * (it doesn't do word segmentation). This is a known FTS5 limitation, not a bug.
 */

let db: ReturnType<typeof createDb>;

function createDb() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite');
  return new DatabaseSync(':memory:');
}

const FTS_TABLE = 'FeedItemFTS';

function setupSchema(database: ReturnType<typeof createDb>) {
  database.exec(`
    CREATE TABLE Source (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'rss',
      game TEXT NOT NULL DEFAULT ''
    )
  `);
  database.exec(`
    CREATE TABLE FeedItem (
      id TEXT PRIMARY KEY,
      sourceId TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      authorName TEXT,
      sourceType TEXT NOT NULL DEFAULT '',
      contentHash TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (sourceId) REFERENCES Source(id)
    )
  `);
}

function createFTS5(database: ReturnType<typeof createDb>) {
  database.exec(`
    CREATE VIRTUAL TABLE ${FTS_TABLE} USING fts5(
      feedItemId UNINDEXED,
      title,
      content,
      authorName,
      sourceName,
      tokenize='unicode61'
    )
  `);
}

function createTriggers(database: ReturnType<typeof createDb>) {
  database.exec(`
    CREATE TRIGGER FeedItem_ai AFTER INSERT ON FeedItem BEGIN
      INSERT INTO ${FTS_TABLE}(feedItemId, title, content, authorName, sourceName)
      SELECT new.id, new.title, new.content, new.authorName, s.name
      FROM Source s WHERE s.id = new.sourceId;
    END
  `);
  database.exec(`
    CREATE TRIGGER FeedItem_ad AFTER DELETE ON FeedItem BEGIN
      DELETE FROM ${FTS_TABLE} WHERE rowid IN (
        SELECT rowid FROM ${FTS_TABLE} WHERE feedItemId = old.id
      );
    END
  `);
  database.exec(`
    CREATE TRIGGER FeedItem_au AFTER UPDATE ON FeedItem BEGIN
      DELETE FROM ${FTS_TABLE} WHERE rowid IN (
        SELECT rowid FROM ${FTS_TABLE} WHERE feedItemId = old.id
      );
      INSERT INTO ${FTS_TABLE}(feedItemId, title, content, authorName, sourceName)
      SELECT new.id, new.title, new.content, new.authorName, s.name
      FROM Source s WHERE s.id = new.sourceId;
    END
  `);
}

function ftsMatch(database: ReturnType<typeof createDb>, query: string) {
  return database.prepare(`SELECT feedItemId, title FROM ${FTS_TABLE} WHERE ${FTS_TABLE} MATCH ?`).all(query);
}

function triggerExists(database: ReturnType<typeof createDb>, name: string) {
  const rows = database.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name=?").all(name);
  return rows.length > 0;
}

function ftsCount(database: ReturnType<typeof createDb>) {
  const r = database.prepare(`SELECT COUNT(*) as cnt FROM ${FTS_TABLE}`).get();
  return r.cnt;
}

// Skip if node:sqlite is not available (Node.js < 22)
let sqliteAvailable = true;
try {
  require('node:sqlite');
} catch {
  sqliteAvailable = false;
}

describe.skipIf(!sqliteAvailable)('FTS5 Integration (node:sqlite)', () => {
  describe('full lifecycle with triggers', () => {
    beforeAll(() => {
      db = createDb();
      setupSchema(db);
      createFTS5(db);
      createTriggers(db);

      db.exec("INSERT INTO Source VALUES('src1', 'miHoYo', 'official', 'genshin')");
      db.exec("INSERT INTO Source VALUES('src2', 'NGA', 'forum', 'starrail')");
      db.exec("INSERT INTO FeedItem VALUES('item1', 'src1', 'Genshin 5.0 Preview', 'Natlan region opens', 'Official', '', 'h1')");
      db.exec("INSERT INTO FeedItem VALUES('item2', 'src2', 'Star Rail new version', 'Penacony story analysis', 'Player', '', 'h2')");
      db.exec("INSERT INTO FeedItem VALUES('item3', 'src1', 'ZZZ release date', 'miHoYo new game coming', 'Official', '', 'h3')");
    });

    afterAll(() => {
      db.close();
    });

    it('should have all triggers created', () => {
      expect(triggerExists(db, 'FeedItem_ai')).toBe(true);
      expect(triggerExists(db, 'FeedItem_ad')).toBe(true);
      expect(triggerExists(db, 'FeedItem_au')).toBe(true);
    });

    it('should have FTS data from initial inserts (via trigger)', () => {
      const results = ftsMatch(db, 'Genshin');
      expect(results).toHaveLength(1);
      expect(results[0].feedItemId).toBe('item1');
    });

    it('should search by content field', () => {
      const results = ftsMatch(db, 'Penacony');
      expect(results).toHaveLength(1);
      expect(results[0].feedItemId).toBe('item2');
    });

    it('should search by source name', () => {
      const results = ftsMatch(db, 'NGA');
      expect(results).toHaveLength(1);
      expect(results[0].feedItemId).toBe('item2');
    });

    it('should verify FTS table has all rows', () => {
      expect(ftsCount(db)).toBe(3);
    });

    it('should handle update trigger: old content removed, new content searchable', () => {
      // Use quoted phrase to avoid FTS5 syntax issues with dots
      db.exec("UPDATE FeedItem SET title='Genshin Natlan Expansion' WHERE id='item1'");

      const oldResults = ftsMatch(db, '"Genshin Preview"');
      expect(oldResults).toHaveLength(0);

      const newResults = ftsMatch(db, 'Natlan');
      expect(newResults).toHaveLength(1);
      expect(newResults[0].feedItemId).toBe('item1');

      // Restore
      db.exec("UPDATE FeedItem SET title='Genshin 5.0 Preview' WHERE id='item1'");
    });

    it('should handle delete trigger: removed from FTS', () => {
      db.exec("DELETE FROM FeedItem WHERE id='item3'");

      const results = ftsMatch(db, 'ZZZ');
      expect(results).toHaveLength(0);

      // item1 still searchable
      const remaining = ftsMatch(db, 'Genshin');
      expect(remaining).toHaveLength(1);

      // Restore for later tests
      db.exec("INSERT INTO FeedItem VALUES('item3', 'src1', 'ZZZ release date', 'miHoYo new game coming', 'Official', '', 'h3')");
    });

    it('should handle insert trigger: new data searchable', () => {
      db.exec("INSERT INTO FeedItem VALUES('item4', 'src2', 'Wuthering Waves new character', 'Kuro Games latest', 'Leaker', '', 'h4')");

      const results = ftsMatch(db, '"Wuthering Waves"');
      expect(results).toHaveLength(1);
      expect(results[0].feedItemId).toBe('item4');
    });

    it('should rebuild index correctly', () => {
      db.exec(`DELETE FROM ${FTS_TABLE}`);
      db.exec(`
        INSERT INTO ${FTS_TABLE}(feedItemId, title, content, authorName, sourceName)
        SELECT f.id, f.title, f.content, f.authorName, s.name
        FROM FeedItem f
        JOIN Source s ON s.id = f.sourceId
      `);

      const results = ftsMatch(db, '"Star Rail"');
      expect(results).toHaveLength(1);
      expect(results[0].feedItemId).toBe('item2');
    });
  });

  describe('trigger repair scenario', () => {
    beforeAll(() => {
      db = createDb();
      setupSchema(db);
      createFTS5(db);

      // Only create insert trigger, skip update/delete
      db.exec(`
        CREATE TRIGGER FeedItem_ai AFTER INSERT ON FeedItem BEGIN
          INSERT INTO ${FTS_TABLE}(feedItemId, title, content, authorName, sourceName)
          SELECT new.id, new.title, new.content, new.authorName, s.name
          FROM Source s WHERE s.id = new.sourceId;
        END
      `);

      db.exec("INSERT INTO Source VALUES('src1', 'miHoYo', 'official', 'genshin')");
      // Use unique terms per field so FTS MATCH targets the right column
      db.exec("INSERT INTO FeedItem VALUES('item1', 'src1', 'UniqueTitleXYZ', 'UniqueContentABC', 'UniqueAuthorDEF', '', 'h1')");
    });

    afterAll(() => {
      db.close();
    });

    it('should detect missing triggers', () => {
      expect(triggerExists(db, 'FeedItem_ai')).toBe(true);
      expect(triggerExists(db, 'FeedItem_ad')).toBe(false);
      expect(triggerExists(db, 'FeedItem_au')).toBe(false);
    });

    it('should allow creating missing triggers and they work', () => {
      // Create missing triggers (same SQL as ensureFTS5 would use)
      db.exec(`
        CREATE TRIGGER FeedItem_ad AFTER DELETE ON FeedItem BEGIN
          DELETE FROM ${FTS_TABLE} WHERE rowid IN (
            SELECT rowid FROM ${FTS_TABLE} WHERE feedItemId = old.id
          );
        END
      `);
      db.exec(`
        CREATE TRIGGER FeedItem_au AFTER UPDATE ON FeedItem BEGIN
          DELETE FROM ${FTS_TABLE} WHERE rowid IN (
            SELECT rowid FROM ${FTS_TABLE} WHERE feedItemId = old.id
          );
          INSERT INTO ${FTS_TABLE}(feedItemId, title, content, authorName, sourceName)
          SELECT new.id, new.title, new.content, new.authorName, s.name
          FROM Source s WHERE s.id = new.sourceId;
        END
      `);

      expect(triggerExists(db, 'FeedItem_ad')).toBe(true);
      expect(triggerExists(db, 'FeedItem_au')).toBe(true);

      // Rebuild FTS to ensure consistency
      db.exec(`DELETE FROM ${FTS_TABLE}`);
      db.exec(`
        INSERT INTO ${FTS_TABLE}(feedItemId, title, content, authorName, sourceName)
        SELECT f.id, f.title, f.content, f.authorName, s.name
        FROM FeedItem f
        JOIN Source s ON s.id = f.sourceId
      `);

      // Update should work via trigger — search for term unique to old title
      db.exec("UPDATE FeedItem SET title='ReplacedTitlePQR' WHERE id='item1'");
      const oldResults = ftsMatch(db, 'UniqueTitleXYZ');
      expect(oldResults).toHaveLength(0);
      const newResults = ftsMatch(db, 'ReplacedTitlePQR');
      expect(newResults).toHaveLength(1);

      // Content unchanged, still searchable
      const contentResults = ftsMatch(db, 'UniqueContentABC');
      expect(contentResults).toHaveLength(1);

      // Delete should work via trigger
      db.exec("DELETE FROM FeedItem WHERE id='item1'");
      const deletedResults = ftsMatch(db, 'ReplacedTitlePQR');
      expect(deletedResults).toHaveLength(0);
    });
  });
});
