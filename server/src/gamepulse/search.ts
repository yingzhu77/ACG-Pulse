import { prisma } from '../db.js';

const FTS_TABLE = 'FeedItemFTS';
const REQUIRED_TRIGGERS = ['FeedItem_ai', 'FeedItem_ad', 'FeedItem_au'] as const;

/**
 * Check if FTS5 virtual table exists
 */
async function ftsExists(): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    FTS_TABLE
  );
  return rows.length > 0;
}

/**
 * Check if a specific trigger exists in the database
 */
async function triggerExists(triggerName: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type='trigger' AND name=?",
    triggerName
  );
  return rows.length > 0;
}

/**
 * Check which required triggers are missing
 * Returns array of missing trigger names
 */
async function getMissingTriggers(): Promise<string[]> {
  const results = await Promise.all(
    REQUIRED_TRIGGERS.map(async (name) => ({
      name,
      exists: await triggerExists(name)
    }))
  );
  return results.filter(r => !r.exists).map(r => r.name);
}

async function getLegacyDeleteTriggers(): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'trigger'
      AND name IN ('FeedItem_ad', 'FeedItem_au')
      AND sql LIKE '%VALUES(''delete''%'
  `);
  return (rows || []).map(row => row.name);
}

/**
 * Create FTS5 virtual table and sync triggers
 * Uses feedItemId as the link back to FeedItem (UUID primary key)
 *
 * Checks table AND each trigger independently:
 * - Table missing → create table + all triggers + rebuild index
 * - Table exists but triggers missing → create missing triggers + rebuild index
 * - Everything present → no-op
 */
export async function ensureFTS5(): Promise<void> {
  const tableExists = await ftsExists();
  const missingTriggers = await getMissingTriggers();
  const legacyTriggers = tableExists && missingTriggers.length === 0
    ? await getLegacyDeleteTriggers()
    : [];

  if (tableExists && missingTriggers.length === 0 && legacyTriggers.length === 0) {
    return; // All good
  }

  if (!tableExists) {
    // Full creation: table + triggers + initial data
    await prisma.$executeRawUnsafe(`
      CREATE VIRTUAL TABLE IF NOT EXISTS ${FTS_TABLE} USING fts5(
        feedItemId UNINDEXED,
        title,
        content,
        authorName,
        sourceName,
        tokenize='unicode61'
      )
    `);
    console.log('[FTS5] Created virtual table');
  }

  // Drop old triggers before recreating — ensures SQL changes take effect.
  // INSERT trigger is idempotent (same SQL), but we drop/recreate all for consistency.
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS FeedItem_ai');
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS FeedItem_ad');
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS FeedItem_au');

  // Uses DELETE FROM ... WHERE rowid IN (SELECT ...) for portability.
  // The FTS5 'delete' command (INSERT INTO fts(fts, ...) VALUES('delete', ...))
  // does not work reliably across all SQLite builds (e.g., node:sqlite).
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER FeedItem_ai AFTER INSERT ON FeedItem BEGIN
      INSERT INTO ${FTS_TABLE}(feedItemId, title, content, authorName, sourceName)
      SELECT new.id, new.title, new.content, new.authorName, s.name
      FROM Source s WHERE s.id = new.sourceId;
    END
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER FeedItem_ad AFTER DELETE ON FeedItem BEGIN
      DELETE FROM ${FTS_TABLE} WHERE rowid IN (
        SELECT rowid FROM ${FTS_TABLE} WHERE feedItemId = old.id
      );
    END
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER FeedItem_au AFTER UPDATE ON FeedItem BEGIN
      DELETE FROM ${FTS_TABLE} WHERE rowid IN (
        SELECT rowid FROM ${FTS_TABLE} WHERE feedItemId = old.id
      );
      INSERT INTO ${FTS_TABLE}(feedItemId, title, content, authorName, sourceName)
      SELECT new.id, new.title, new.content, new.authorName, s.name
      FROM Source s WHERE s.id = new.sourceId;
    END
  `);

  if (!tableExists) {
    console.log('[FTS5] Created all sync triggers');
    // Full rebuild for new table
    await rebuildFTS5();
  } else {
    // Table existed but triggers were missing — data may be out of sync
    const repairedTriggers = [...new Set([...missingTriggers, ...legacyTriggers])];
    console.warn(
      `[FTS5] Repaired sync triggers: ${repairedTriggers.join(', ')}. Rebuilding index to ensure consistency.`
    );
    await rebuildFTS5();
  }
}

/**
 * Rebuild FTS5 index from scratch
 */
export async function rebuildFTS5(): Promise<void> {
  await prisma.$executeRawUnsafe(`DELETE FROM ${FTS_TABLE}`);
  await prisma.$executeRawUnsafe(`
    INSERT INTO ${FTS_TABLE}(feedItemId, title, content, authorName, sourceName)
    SELECT f.id, f.title, f.content, f.authorName, s.name
    FROM FeedItem f
    JOIN Source s ON s.id = f.sourceId
  `);
}

/**
 * Escape FTS5 special characters for safe querying
 */
function escapeFTS5(query: string): string {
  return query
    .replace(/[""]/g, '""')
    .trim();
}

/**
 * Search feed items using FTS5
 * Returns matching feedItemIds ranked by relevance
 */
export async function searchFeedItems(
  query: string,
  options: { limit?: number; offset?: number } = {}
): Promise<{ feedItemIds: string[]; total: number }> {
  const { limit = 100, offset = 0 } = options;
  const safeQuery = escapeFTS5(query);

  if (!safeQuery) {
    return { feedItemIds: [], total: 0 };
  }

  if (!(await ftsExists())) {
    return { feedItemIds: [], total: 0 };
  }

  try {
    const results = await prisma.$queryRawUnsafe<Array<{ feedItemId: string; rank: number }>>(
      `SELECT feedItemId, rank FROM ${FTS_TABLE} WHERE ${FTS_TABLE} MATCH ? ORDER BY rank LIMIT ? OFFSET ?`,
      safeQuery,
      limit,
      offset
    );

    const countResult = await prisma.$queryRawUnsafe<Array<{ total: number }>>(
      `SELECT COUNT(*) as total FROM ${FTS_TABLE} WHERE ${FTS_TABLE} MATCH ?`,
      safeQuery
    );

    return {
      feedItemIds: results.map(r => r.feedItemId),
      total: Number(countResult[0]?.total || 0)
    };
  } catch (error) {
    console.warn('FTS5 search failed, falling back:', error);
    return { feedItemIds: [], total: 0 };
  }
}

/**
 * Check if FTS5 is available, populated, and has all sync triggers
 */
export async function isFTS5Ready(): Promise<boolean> {
  if (!(await ftsExists())) return false;
  const missingTriggers = await getMissingTriggers();
  if (missingTriggers.length > 0) {
    console.warn(`[FTS5] Index exists but missing triggers: ${missingTriggers.join(', ')}`);
    return false;
  }
  const legacyTriggers = await getLegacyDeleteTriggers();
  if (legacyTriggers.length > 0) {
    console.warn(`[FTS5] Index has outdated triggers: ${legacyTriggers.join(', ')}`);
    return false;
  }
  const count = await prisma.$queryRawUnsafe<Array<{ cnt: number }>>(
    `SELECT COUNT(*) as cnt FROM ${FTS_TABLE}`
  );
  return Number(count[0]?.cnt || 0) > 0;
}

/**
 * Drop FTS5 table and triggers (for rollback)
 */
export async function dropFTS5(): Promise<void> {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS FeedItem_ai`);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS FeedItem_ad`);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS FeedItem_au`);
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${FTS_TABLE}`);
}
