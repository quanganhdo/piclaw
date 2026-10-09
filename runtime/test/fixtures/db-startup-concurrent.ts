import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { initDatabase, getDb, closeDatabase } from "../../src/db/connection.js";
import { assertPathWithinTestFilesystemIsolation } from "../../scripts/test-filesystem-isolation.js";
const [ready, go] = process.argv.slice(2);
assertPathWithinTestFilesystemIsolation(ready, process.env, { allowRoot: false });
assertPathWithinTestFilesystemIsolation(go, process.env, { allowRoot: false });
writeFileSync(ready, "ready");
const deadline = Date.now() + 10000;
while (!existsSync(go)) { assert(Date.now() < deadline, "start barrier timed out"); await Bun.sleep(5); }
try {
  initDatabase(); const db = getDb();
  assert.equal((db.query("PRAGMA quick_check").get() as any).quick_check, "ok");
  assert.equal((db.query("PRAGMA auto_vacuum").get() as any).auto_vacuum, 2);
  assert.equal((db.query("PRAGMA journal_mode").get() as any).journal_mode, "wal");
  assert.equal((db.query("PRAGMA synchronous").get() as any).synchronous, 2);
  assert(db.query("SELECT name FROM sqlite_schema WHERE name='messages_fts'").get());
  console.log("CONCURRENT_INIT_OK");
} finally { closeDatabase({ shrinkMemory: false }); }
