-- Baseline migration for the schema already managed by prisma db push before
-- the project moved production deploys to prisma migrate deploy.

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "feedItemId" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'in_app',
    "status" TEXT NOT NULL DEFAULT 'created',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_feedItemId_fkey" FOREIGN KEY ("feedItemId") REFERENCES "FeedItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "game" TEXT NOT NULL,
    "url" TEXT,
    "uid" TEXT,
    "avatar" TEXT,
    "route" TEXT,
    "config" TEXT,
    "isOfficial" BOOLEAN NOT NULL DEFAULT false,
    "followed" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 50,
    "healthStatus" TEXT NOT NULL DEFAULT 'unknown',
    "lastSuccessAt" DATETIME,
    "lastCheckedAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SourceHealthLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "checkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SourceHealthLog_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FeedItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT,
    "itemKind" TEXT NOT NULL DEFAULT 'official_post',
    "game" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "authorName" TEXT,
    "authorUrl" TEXT,
    "coverUrl" TEXT,
    "sourceType" TEXT NOT NULL,
    "identityKey" TEXT,
    "contentHash" TEXT NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" DATETIME,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FeedItem_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Analysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "feedItemId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "category" TEXT,
    "importance" TEXT NOT NULL DEFAULT 'low',
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "confidence" INTEGER NOT NULL DEFAULT 50,
    "summary" TEXT,
    "reason" TEXT,
    "dedupKeywords" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "error" TEXT,
    "analyzedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Analysis_feedItemId_fkey" FOREIGN KEY ("feedItemId") REFERENCES "FeedItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AnalysisTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "feedItemId" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "lastError" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "durationMs" INTEGER,
    "nextRunAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "failedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AnalysisTask_feedItemId_fkey" FOREIGN KEY ("feedItemId") REFERENCES "FeedItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CommunityTopic" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "sentiment" TEXT NOT NULL,
    "sentimentScore" REAL NOT NULL DEFAULT 0,
    "sentimentStatus" TEXT NOT NULL DEFAULT 'legacy',
    "sentimentMethod" TEXT NOT NULL DEFAULT 'none',
    "sentimentConfidence" REAL NOT NULL DEFAULT 0,
    "sentimentVersion" TEXT,
    "sentimentAnalyzedAt" DATETIME,
    "heatScore" REAL NOT NULL DEFAULT 0,
    "rawHeatScore" REAL NOT NULL DEFAULT 0,
    "category" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "trend" TEXT NOT NULL DEFAULT '[]',
    "rawHeatTrend" TEXT NOT NULL DEFAULT '[]',
    "summary" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL,
    "publishedAt" DATETIME NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Setting_key_key" ON "Setting"("key");

-- CreateIndex
CREATE INDEX "Source_enabled_type_idx" ON "Source"("enabled", "type");

-- CreateIndex
CREATE INDEX "Source_game_idx" ON "Source"("game");

-- CreateIndex
CREATE INDEX "SourceHealthLog_sourceId_checkedAt_idx" ON "SourceHealthLog"("sourceId", "checkedAt");

-- CreateIndex
CREATE INDEX "SourceHealthLog_checkedAt_idx" ON "SourceHealthLog"("checkedAt");

-- CreateIndex
CREATE INDEX "FeedItem_game_hidden_publishedAt_idx" ON "FeedItem"("game", "hidden", "publishedAt");

-- CreateIndex
CREATE INDEX "FeedItem_hidden_createdAt_idx" ON "FeedItem"("hidden", "createdAt");

-- CreateIndex
CREATE INDEX "FeedItem_itemKind_idx" ON "FeedItem"("itemKind");

-- CreateIndex
CREATE UNIQUE INDEX "FeedItem_sourceId_contentHash_key" ON "FeedItem"("sourceId", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "FeedItem_sourceId_identityKey_key" ON "FeedItem"("sourceId", "identityKey");

-- CreateIndex
CREATE UNIQUE INDEX "Analysis_feedItemId_key" ON "Analysis"("feedItemId");

-- CreateIndex
CREATE INDEX "Analysis_status_idx" ON "Analysis"("status");

-- CreateIndex
CREATE INDEX "Analysis_importance_idx" ON "Analysis"("importance");

-- CreateIndex
CREATE INDEX "Analysis_visibility_idx" ON "Analysis"("visibility");

-- CreateIndex
CREATE INDEX "Analysis_category_idx" ON "Analysis"("category");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisTask_dedupeKey_key" ON "AnalysisTask"("dedupeKey");

-- CreateIndex
CREATE INDEX "AnalysisTask_status_nextRunAt_idx" ON "AnalysisTask"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "AnalysisTask_feedItemId_status_idx" ON "AnalysisTask"("feedItemId", "status");

-- CreateIndex
CREATE INDEX "AnalysisTask_createdAt_idx" ON "AnalysisTask"("createdAt");

-- CreateIndex
CREATE INDEX "CommunityTopic_source_idx" ON "CommunityTopic"("source");

-- CreateIndex
CREATE INDEX "CommunityTopic_sentiment_idx" ON "CommunityTopic"("sentiment");

-- CreateIndex
CREATE INDEX "CommunityTopic_heatScore_idx" ON "CommunityTopic"("heatScore");

-- CreateIndex
CREATE INDEX "CommunityTopic_lastSeenAt_idx" ON "CommunityTopic"("lastSeenAt");
