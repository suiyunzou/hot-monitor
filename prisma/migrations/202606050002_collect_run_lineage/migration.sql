-- Collect run event timeline + data lineage fields
ALTER TABLE "RawItem" ADD COLUMN "collectRunId" TEXT;
ALTER TABLE "HotTopic" ADD COLUMN "collectRunId" TEXT;
ALTER TABLE "AiAnalysis" ADD COLUMN "collectRunId" TEXT;

CREATE TABLE "CollectRunEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "detailsJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CollectRunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CollectRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "RawItem_collectRunId_idx" ON "RawItem"("collectRunId");
CREATE INDEX "HotTopic_collectRunId_idx" ON "HotTopic"("collectRunId");
CREATE INDEX "AiAnalysis_collectRunId_idx" ON "AiAnalysis"("collectRunId");
CREATE INDEX "CollectRunEvent_runId_createdAt_idx" ON "CollectRunEvent"("runId", "createdAt");
CREATE INDEX "CollectRunEvent_level_idx" ON "CollectRunEvent"("level");
CREATE INDEX "CollectRunEvent_phase_idx" ON "CollectRunEvent"("phase");
CREATE INDEX "CollectRunEvent_eventType_idx" ON "CollectRunEvent"("eventType");
