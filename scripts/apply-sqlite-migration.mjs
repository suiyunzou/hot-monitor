import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const databaseUrl = process.env.DATABASE_URL || "file:./prisma/dev.db";
const dbPath = databaseUrl.replace(/^file:/, "");
const resolvedDbPath = resolve(dbPath);

mkdirSync(dirname(resolvedDbPath), { recursive: true });

const db = new Database(resolvedDbPath);
db.pragma("foreign_keys = ON");

const existingTables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
  .all();

if (existingTables.length > 0) {
  applyIncrementalMigrations(db);
  console.log(`SQLite database already has ${existingTables.length} tables. Applied incremental checks.`);
  db.close();
  process.exit(0);
}

const migrationPath = resolve("prisma/migrations/202606040001_init/migration.sql");
const migrationSql = readFileSync(migrationPath, "utf8");
db.exec(migrationSql);
applyIncrementalMigrations(db);
db.close();

console.log(`Applied init migration to ${resolvedDbPath}`);

function applyIncrementalMigrations(database) {
  const tableNames = () =>
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name);
  const rawItemColumns = () =>
    database.prepare("PRAGMA table_info('RawItem')").all().map((row) => row.name);
  const indexNames = () =>
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all()
      .map((row) => row.name);

  // 202606040002 watch keywords
  if (!tableNames().includes("WatchKeyword")) {
    database.exec(readFileSync(resolve("prisma/migrations/202606040002_watch_keywords/migration.sql"), "utf8"));
  }
  if (!rawItemColumns().includes("watchKeywordId")) {
    database.exec('ALTER TABLE "RawItem" ADD COLUMN "watchKeywordId" TEXT;');
  }

  // 202606050001 engagement metrics + translation fields + KolAccount
  applyEngagementKolMigration(database, rawItemColumns, tableNames, indexNames);
}

function applyEngagementKolMigration(database, rawItemColumns, tableNames, indexNames) {
  const existingCols = rawItemColumns();
  const columns = [
    ["titleZh", "TEXT"],
    ["excerptZh", "TEXT"],
    ["viewCount", "INTEGER"],
    ["likeCount", "INTEGER"],
    ["retweetCount", "INTEGER"],
    ["replyCount", "INTEGER"],
    ["engagementScore", "INTEGER"]
  ];
  for (const [name, type] of columns) {
    if (!existingCols.includes(name)) {
      database.exec(`ALTER TABLE "RawItem" ADD COLUMN "${name}" ${type};`);
    }
  }

  if (!indexNames().includes("RawItem_engagementScore_idx")) {
    database.exec('CREATE INDEX "RawItem_engagementScore_idx" ON "RawItem"("engagementScore");');
  }

  if (!tableNames().includes("KolAccount")) {
    database.exec(`CREATE TABLE "KolAccount" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "handle" TEXT NOT NULL,
      "displayName" TEXT,
      "tier" INTEGER NOT NULL DEFAULT 2,
      "enabled" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    );`);
    database.exec('CREATE UNIQUE INDEX "KolAccount_handle_key" ON "KolAccount"("handle");');
    database.exec('CREATE INDEX "KolAccount_enabled_idx" ON "KolAccount"("enabled");');
    database.exec('CREATE INDEX "KolAccount_tier_idx" ON "KolAccount"("tier");');
  }
}
