// Wipe collected/derived content for a clean slate while preserving
// configuration (Source, WatchKeyword, KolAccount). Use after a pipeline change
// when old rows (e.g. pre-translation English topics, items without engagement
// metrics) should not mix with freshly collected data.
//
//   node scripts/reset-content.mjs
import Database from "better-sqlite3";
import { resolve } from "node:path";

const dbPath = (process.env.DATABASE_URL || "file:./prisma/dev.db").replace(/^file:/, "");
const db = new Database(resolve(dbPath));
db.pragma("foreign_keys = ON");

// Child → parent order so we never rely on cascade behaviour.
const contentTables = [
  "EmailDigestItem",
  "EmailDigest",
  "AiAnalysis",
  "TopicSource",
  "HotTopic",
  "RawItem",
  "CollectRun"
];
const preserved = ["Source", "WatchKeyword", "KolAccount"];

const countOf = (table) => db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get().c;

const before = Object.fromEntries([...contentTables, ...preserved].map((t) => [t, countOf(t)]));

const wipe = db.transaction(() => {
  for (const table of contentTables) {
    db.prepare(`DELETE FROM "${table}"`).run();
  }
});
wipe();

const after = Object.fromEntries([...contentTables, ...preserved].map((t) => [t, countOf(t)]));

console.log("Cleared content tables (config preserved).");
console.log(JSON.stringify({ before, after }, null, 2));

db.close();
