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
  const tables = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name);

  if (!tables.includes("WatchKeyword")) {
    database.exec(readFileSync(resolve("prisma/migrations/202606040002_watch_keywords/migration.sql"), "utf8"));
    return;
  }

  const rawItemColumns = database.prepare("PRAGMA table_info('RawItem')").all().map((row) => row.name);
  if (!rawItemColumns.includes("watchKeywordId")) {
    database.exec('ALTER TABLE "RawItem" ADD COLUMN "watchKeywordId" TEXT;');
  }
}
