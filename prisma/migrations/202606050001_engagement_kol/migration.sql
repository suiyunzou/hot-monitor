-- AlterTable: engagement metrics + Chinese translation fields on RawItem
ALTER TABLE "RawItem" ADD COLUMN "titleZh" TEXT;
ALTER TABLE "RawItem" ADD COLUMN "excerptZh" TEXT;
ALTER TABLE "RawItem" ADD COLUMN "viewCount" INTEGER;
ALTER TABLE "RawItem" ADD COLUMN "likeCount" INTEGER;
ALTER TABLE "RawItem" ADD COLUMN "retweetCount" INTEGER;
ALTER TABLE "RawItem" ADD COLUMN "replyCount" INTEGER;
ALTER TABLE "RawItem" ADD COLUMN "engagementScore" INTEGER;

-- CreateIndex
CREATE INDEX "RawItem_engagementScore_idx" ON "RawItem"("engagementScore");

-- CreateTable
CREATE TABLE "KolAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "handle" TEXT NOT NULL,
    "displayName" TEXT,
    "tier" INTEGER NOT NULL DEFAULT 2,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "KolAccount_handle_key" ON "KolAccount"("handle");

-- CreateIndex
CREATE INDEX "KolAccount_enabled_idx" ON "KolAccount"("enabled");

-- CreateIndex
CREATE INDEX "KolAccount_tier_idx" ON "KolAccount"("tier");
