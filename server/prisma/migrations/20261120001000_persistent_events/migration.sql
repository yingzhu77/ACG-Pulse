CREATE TABLE "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "game" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "EventAlias" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT,
    CONSTRAINT "EventAlias_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "FeedItem" ADD COLUMN "eventId" TEXT REFERENCES "Event" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FeedItem" ADD COLUMN "eventProgress" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FeedItem" ADD COLUMN "eventSplit" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FeedItem" ADD COLUMN "eventArchived" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "FeedItem_eventId_idx" ON "FeedItem"("eventId");
CREATE INDEX "FeedItem_eventArchived_createdAt_idx" ON "FeedItem"("eventArchived", "createdAt");
CREATE INDEX "EventAlias_eventId_idx" ON "EventAlias"("eventId");
