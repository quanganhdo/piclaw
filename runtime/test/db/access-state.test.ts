import Database from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { initializeAccessSchema, readAccessState, validateAccessStartup } from "../../src/db/access-state.js";

const databases: Database[] = [];
const dirs: string[] = [];
function database(): Database { const db = new Database(":memory:"); databases.push(db); return db; }
function config(mode?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "piclaw-access-state-")); dirs.push(dir);
  const path = join(dir, "config.json");
  if (mode !== undefined) writeFileSync(path, JSON.stringify({ domains: { access: { mode } } }));
  return path;
}
afterEach(() => { for (const db of databases.splice(0)) db.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

test("additive schema and marker initialisation are idempotent", () => {
  const db = database();
  db.exec("CREATE TABLE legacy(value TEXT); INSERT INTO legacy VALUES ('preserved')");
  initializeAccessSchema(db);
  initializeAccessSchema(db, "Ignored new name");
  expect(readAccessState(db)).toEqual({ activatedMode: "single-user", schemaVersion: 1 });
  expect(db.query("SELECT * FROM legacy").all()).toEqual([{ value: "preserved" }]);
  expect(db.query("SELECT COUNT(*) AS n FROM users").get()).toEqual({ n: 1 });
  expect(validateAccessStartup(db, config())).toEqual({ configuredMode: "single-user", effectiveMode: "single-user", modeExplicit: false });
});

test("missing marker or unsupported schema is not recreated as single-user", () => {
  const db = database(); initializeAccessSchema(db);
  db.exec("DELETE FROM access_state");
  expect(() => initializeAccessSchema(db)).toThrow("missing or unsupported");
  db.exec("DROP TABLE access_state");
  expect(() => initializeAccessSchema(db)).toThrow("Users exist without");
  const future = database(); initializeAccessSchema(future);
  future.exec("UPDATE access_state SET schema_version = 2");
  expect(() => initializeAccessSchema(future)).toThrow("missing or unsupported");
});

test("reopening a marked store never recreates a deleted legacy administrator", () => {
  const db = database(); initializeAccessSchema(db);
  db.exec("DELETE FROM users WHERE id = 'default'");
  initializeAccessSchema(db);
  expect(db.query("SELECT COUNT(*) AS n FROM users").get()).toEqual({ n: 0 });
  db.exec("DROP TABLE users");
  expect(() => initializeAccessSchema(db)).toThrow("without users");
});

test("startup rejects a corrupt store without an enabled administrator", () => {
  const db = database(); initializeAccessSchema(db);
  db.exec("UPDATE users SET enabled = 0");
  expect(() => validateAccessStartup(db, config())).toThrow("no enabled administrator");
});
