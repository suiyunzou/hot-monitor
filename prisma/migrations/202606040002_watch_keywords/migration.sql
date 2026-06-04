-- CreateTable
CREATE TABLE "WatchKeyword" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "keyword" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- AlterTable
ALTER TABLE "RawItem" ADD COLUMN "watchKeywordId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "WatchKeyword_keyword_key" ON "WatchKeyword"("keyword");

-- CreateIndex
CREATE INDEX "WatchKeyword_enabled_idx" ON "WatchKeyword"("enabled");

-- CreateIndex
CREATE INDEX "RawItem_watchKeywordId_idx" ON "RawItem"("watchKeywordId");
