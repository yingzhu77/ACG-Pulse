CREATE TABLE "DailyEdition" (
    "date" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL,
    "publishedAt" DATETIME,
    "health" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "DailyEditionEntry" (
    "editionDate" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "feedItemId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "discoveredAt" DATETIME NOT NULL,
    "story" JSONB NOT NULL,
    "withdrawnAt" DATETIME,
    "correction" JSONB,
    "correctedAt" DATETIME,
    PRIMARY KEY ("editionDate", "eventId"),
    CONSTRAINT "DailyEditionEntry_editionDate_fkey" FOREIGN KEY ("editionDate") REFERENCES "DailyEdition" ("date") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "DailyEdition_status_date_idx" ON "DailyEdition"("status", "date");
CREATE UNIQUE INDEX "DailyEditionEntry_feedItemId_key" ON "DailyEditionEntry"("feedItemId");
CREATE INDEX "DailyEditionEntry_eventId_editionDate_idx" ON "DailyEditionEntry"("eventId", "editionDate");
CREATE INDEX "DailyEditionEntry_sourceId_idx" ON "DailyEditionEntry"("sourceId");

-- A snapshot survives routine feed pruning, but a retraction survives pruning too.
-- Prisma's SQLite engine reads INTEGER milliseconds as DateTime.
CREATE TRIGGER "daily_edition_feed_hidden"
AFTER UPDATE OF "hidden" ON "FeedItem" WHEN NEW."hidden" = 1
BEGIN
  UPDATE "DailyEditionEntry"
  SET "withdrawnAt" = CAST(strftime('%s', 'now') AS INTEGER) * 1000
  WHERE "feedItemId" = NEW."id" AND "withdrawnAt" IS NULL;
END;

CREATE TRIGGER "daily_edition_analysis_restricted_insert"
AFTER INSERT ON "Analysis" WHEN NEW."visibility" IN ('hidden', 'muted')
BEGIN
  UPDATE "DailyEditionEntry"
  SET "withdrawnAt" = CAST(strftime('%s', 'now') AS INTEGER) * 1000
  WHERE "feedItemId" = NEW."feedItemId" AND "withdrawnAt" IS NULL;
END;

CREATE TRIGGER "daily_edition_analysis_restricted_update"
AFTER UPDATE OF "visibility" ON "Analysis" WHEN NEW."visibility" IN ('hidden', 'muted')
BEGIN
  UPDATE "DailyEditionEntry"
  SET "withdrawnAt" = CAST(strftime('%s', 'now') AS INTEGER) * 1000
  WHERE "feedItemId" = NEW."feedItemId" AND "withdrawnAt" IS NULL;
END;

CREATE TRIGGER "daily_edition_source_removed"
BEFORE DELETE ON "Source"
BEGIN
  UPDATE "DailyEditionEntry"
  SET "withdrawnAt" = CAST(strftime('%s', 'now') AS INTEGER) * 1000
  WHERE "sourceId" = OLD."id" AND "withdrawnAt" IS NULL;
END;

-- An explicit regroup/split must not keep advertising an incorrect event link.
CREATE TRIGGER "daily_edition_event_reassigned"
AFTER UPDATE OF "eventId" ON "FeedItem"
WHEN OLD."eventId" IS NOT NULL AND NEW."eventId" IS NOT OLD."eventId"
BEGIN
  UPDATE "DailyEditionEntry"
  SET "withdrawnAt" = CAST(strftime('%s', 'now') AS INTEGER) * 1000
  WHERE "feedItemId" = NEW."id" AND "withdrawnAt" IS NULL;
END;
