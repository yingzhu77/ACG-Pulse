ALTER TABLE "Source" ADD COLUMN "firstIngestAt" DATETIME;
ALTER TABLE "FeedItem" ADD COLUMN "isSourceBackfill" BOOLEAN NOT NULL DEFAULT false;
-- Existing sources have already established their baseline. Do not rewrite original item timestamps.
UPDATE "Source"
SET "firstIngestAt" = (SELECT MIN("createdAt") FROM "FeedItem" WHERE "sourceId" = "Source"."id")
WHERE EXISTS (SELECT 1 FROM "FeedItem" WHERE "sourceId" = "Source"."id");
