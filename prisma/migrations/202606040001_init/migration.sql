-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "homepageUrl" TEXT,
    "entryUrl" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "credibilityLevel" TEXT NOT NULL DEFAULT 'MEDIA',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RawItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT,
    "url" TEXT NOT NULL,
    "canonicalUrl" TEXT,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "excerpt" TEXT,
    "content" TEXT,
    "language" TEXT,
    "publishedAt" DATETIME,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceType" TEXT NOT NULL,
    "credibilityLevel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "metadataJson" TEXT,
    CONSTRAINT "RawItem_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HotTopic" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "whyItMatters" TEXT,
    "category" TEXT NOT NULL,
    "hotScore" INTEGER NOT NULL,
    "confidence" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "needsVerification" BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TopicSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topicId" TEXT NOT NULL,
    "rawItemId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TopicSource_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "HotTopic" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TopicSource_rawItemId_fkey" FOREIGN KEY ("rawItemId") REFERENCES "RawItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topicId" TEXT,
    "model" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "inputJson" TEXT NOT NULL,
    "outputJson" TEXT NOT NULL,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiAnalysis_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "HotTopic" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CollectRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "fetchedCount" INTEGER NOT NULL DEFAULT 0,
    "newCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "metadataJson" TEXT
);

-- CreateTable
CREATE TABLE "EmailDigest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subject" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sentAt" DATETIME,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "EmailDigestItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "digestId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailDigestItem_digestId_fkey" FOREIGN KEY ("digestId") REFERENCES "EmailDigest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EmailDigestItem_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "HotTopic" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Source_key_key" ON "Source"("key");

-- CreateIndex
CREATE INDEX "RawItem_publishedAt_idx" ON "RawItem"("publishedAt");

-- CreateIndex
CREATE INDEX "RawItem_fetchedAt_idx" ON "RawItem"("fetchedAt");

-- CreateIndex
CREATE INDEX "RawItem_sourceType_idx" ON "RawItem"("sourceType");

-- CreateIndex
CREATE UNIQUE INDEX "RawItem_sourceId_url_key" ON "RawItem"("sourceId", "url");

-- CreateIndex
CREATE INDEX "HotTopic_hotScore_idx" ON "HotTopic"("hotScore");

-- CreateIndex
CREATE INDEX "HotTopic_lastSeenAt_idx" ON "HotTopic"("lastSeenAt");

-- CreateIndex
CREATE INDEX "HotTopic_status_idx" ON "HotTopic"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TopicSource_topicId_rawItemId_key" ON "TopicSource"("topicId", "rawItemId");

-- CreateIndex
CREATE INDEX "AiAnalysis_task_idx" ON "AiAnalysis"("task");

-- CreateIndex
CREATE INDEX "AiAnalysis_createdAt_idx" ON "AiAnalysis"("createdAt");

-- CreateIndex
CREATE INDEX "CollectRun_startedAt_idx" ON "CollectRun"("startedAt");

-- CreateIndex
CREATE INDEX "CollectRun_status_idx" ON "CollectRun"("status");

-- CreateIndex
CREATE INDEX "EmailDigest_createdAt_idx" ON "EmailDigest"("createdAt");

-- CreateIndex
CREATE INDEX "EmailDigest_status_idx" ON "EmailDigest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDigestItem_digestId_topicId_key" ON "EmailDigestItem"("digestId", "topicId");
