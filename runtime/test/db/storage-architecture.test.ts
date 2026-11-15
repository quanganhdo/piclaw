import Database from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "bun:test";

import { createVerifiedSqliteBackup, verifySqliteBackup } from "../../src/db/backup.js";
import { applyOwnedMigrations, listAppliedOwnedMigrations } from "../../src/db/migrations.js";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDbPaths() {
  const dir = mkdtempSync(join(tmpdir(), "piclaw-storage-architecture-"));
  tempDirs.push(dir);
  return { source: join(dir, "messages.db"), backup: join(dir, "backups", "messages.db") };
}

test("verified SQLite backup includes committed WAL data and preserves schema metadata", () => {
  const paths = tempDbPaths();
  const source = new Database(paths.source);
  source.exec("PRAGMA journal_mode=WAL; PRAGMA user_version=7; CREATE TABLE messages(id INTEGER PRIMARY KEY, content TEXT); INSERT INTO messages(content) VALUES ('before'), ('from-wal');");

  const manifest = createVerifiedSqliteBackup(source, paths.source, paths.backup);
  expect(manifest.integrityCheck).toBe("ok");
  expect(manifest.userVersion).toBe(7);
  expect(manifest.tableCount).toBe(1);
  expect(manifest.backupBytes).toBeGreaterThan(0);

  const backup = new Database(paths.backup, { readonly: true });
  expect(backup.query("SELECT content FROM messages ORDER BY id").all()).toEqual([
    { content: "before" },
    { content: "from-wal" },
  ]);
  backup.close();
  source.close();
});

test("verified SQLite backup never overwrites destinations and removes failed snapshots", () => {
  const paths = tempDbPaths();
  const source = new Database(paths.source);
  source.exec("CREATE TABLE t(value TEXT)");
  createVerifiedSqliteBackup(source, paths.source, paths.backup);
  expect(() => createVerifiedSqliteBackup(source, paths.source, paths.backup)).toThrow("already exists");
  expect(existsSync(paths.backup)).toBe(true);
  source.close();
});

test("backup verification releases its read transaction before an immediate writer reopen", () => {
  const paths = tempDbPaths();
  const source = new Database(paths.source);
  let writer: Database | undefined;
  try {
    source.exec("CREATE TABLE t(value TEXT);INSERT INTO t VALUES('preserved source')");
    createVerifiedSqliteBackup(source, paths.source, paths.backup);
    expect(verifySqliteBackup(paths.backup).integrityCheck).toBe("ok");
    writer = new Database(paths.backup);
    writer.exec("PRAGMA busy_timeout=50;BEGIN IMMEDIATE;UPDATE t SET value='updated backup';COMMIT");
    expect(writer.query("SELECT value FROM t").get()).toEqual({value:"updated backup"});
    expect(source.query("SELECT value FROM t").get()).toEqual({value:"preserved source"});
  } finally {
    if (writer?.inTransaction) writer.exec("ROLLBACK");
    writer?.close(); source.close();
  }
});

test("backup verifier rejects corrupt files", () => {
  const paths = tempDbPaths();
  mkdirSync(dirname(paths.backup), { recursive: true });
  writeFileSync(paths.backup, "not sqlite");
  expect(existsSync(paths.backup)).toBe(true);
  expect(() => verifySqliteBackup(paths.backup)).toThrow("file is not a database");
});

test("owner-scoped migrations are transactional, idempotent, and checksum guarded", () => {
  const database = new Database(":memory:");
  const migration = {
    owner: "piclaw.core",
    id: "001-example",
    order: 1,
    sql: "CREATE TABLE example(id INTEGER PRIMARY KEY, value TEXT); INSERT INTO example(value) VALUES ('ok');",
  };
  applyOwnedMigrations(database, [migration]);
  applyOwnedMigrations(database, [migration]);
  expect(database.query("SELECT value FROM example").all()).toEqual([{ value: "ok" }]);
  expect(listAppliedOwnedMigrations(database, "piclaw.core")).toHaveLength(1);
  expect(() => applyOwnedMigrations(database, [{ ...migration, sql: `${migration.sql} -- changed` }])).toThrow("checksum mismatch");
  database.close();
});

test("failed owner migration rolls back schema and ledger row", () => {
  const database = new Database(":memory:");
  expect(() => applyOwnedMigrations(database, [{
    owner: "piclaw.sessions",
    id: "001-fails",
    order: 1,
    sql: "CREATE TABLE partial(id INTEGER); INSERT INTO missing_table VALUES (1);",
  }])).toThrow();
  expect(database.query("SELECT name FROM sqlite_master WHERE name = 'partial'").get()).toBeNull();
  expect(listAppliedOwnedMigrations(database, "piclaw.sessions")).toEqual([]);
  database.close();
});

test("different schema owners may reuse migration ids and order values", () => {
  const database = new Database(":memory:");
  applyOwnedMigrations(database, [
    { owner: "piclaw.core", id: "001", order: 1, sql: "CREATE TABLE core_owned(id INTEGER);" },
    { owner: "earendil.sessions", id: "001", order: 1, sql: "CREATE TABLE session_owned(id INTEGER);" },
  ]);
  expect(listAppliedOwnedMigrations(database).map(({ owner, id }) => ({ owner, id }))).toEqual([
    { owner: "earendil.sessions", id: "001" },
    { owner: "piclaw.core", id: "001" },
  ]);
  database.close();
});
