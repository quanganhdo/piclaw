import "../helpers.js";
import { Database } from "bun:sqlite";
import { expect, test, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { applyOwnedMigrations, listAppliedOwnedMigrations } from "../../src/db/migrations.js";

const first = { owner: "fixture.owner", id: "one", order: 1, sql: "CREATE TABLE owned(value TEXT); INSERT INTO owned VALUES ('original');" };
const rows = (db: Database) => db.query("SELECT * FROM piclaw_schema_migrations ORDER BY owner,migration_order").all();

test("owned migration rejects changed persisted order without rewriting its receipt", () => {
  const db = new Database(":memory:");
  try {
    applyOwnedMigrations(db, [first]); const before = rows(db);
    expect(() => applyOwnedMigrations(db, [{ ...first, order: 2 }])).toThrow("order mismatch");
    expect(rows(db)).toEqual(before); expect(db.query("SELECT * FROM owned").all()).toEqual([{ value: "original" }]);
  } finally { db.close(); }
});

test("owned migration replay preserves checksum, order, timestamp and legacy/SDK markers", () => {
  const db = new Database(":memory:");
  try {
    db.exec("PRAGMA user_version=7; CREATE TABLE durable_schema(version INTEGER); INSERT INTO durable_schema VALUES(99); CREATE TABLE core_schema_migrations(name TEXT PRIMARY KEY,applied_at TEXT); INSERT INTO core_schema_migrations VALUES('old','historical');");
    applyOwnedMigrations(db, [first]); const before = rows(db); applyOwnedMigrations(db, [first]);
    expect(rows(db)).toEqual(before);
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 7 });
    expect(db.query("SELECT * FROM durable_schema").all()).toEqual([{ version: 99 }]);
    expect(db.query("SELECT * FROM core_schema_migrations").all()).toEqual([{ name: "old", applied_at: "historical" }]);
    expect(() => applyOwnedMigrations(db, [{ ...first, sql: first.sql + " -- changed" }])).toThrow("checksum mismatch");
    expect(rows(db)).toEqual(before);
  } finally { db.close(); }
});

for (const duplicate of ["identity", "order"] as const) test(`duplicate ${duplicate} validates the whole declaration before DDL`, () => {
  const db = new Database(":memory:");
  try {
    const second = { ...first, id: duplicate === "identity" ? "one" : "two", order: duplicate === "identity" ? 2 : 1, sql: "CREATE TABLE other(value TEXT)" };
    expect(() => applyOwnedMigrations(db, [first, second])).toThrow("Duplicate schema migration");
    expect(db.query("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([]);
  } finally { db.close(); }
});

test("mid-batch DDL failure rolls back the batch and receipts, then retries idempotently", () => {
  const db = new Database(":memory:");
  try {
    const second = { owner: first.owner, id: "two", order: 2, sql: "CREATE TABLE partial(value TEXT); INSERT INTO missing VALUES(1);" };
    expect(() => applyOwnedMigrations(db, [first, second])).toThrow();
    expect(db.query("SELECT name FROM sqlite_master WHERE name IN ('owned','partial','piclaw_schema_migrations')").all()).toEqual([]);
    const fixed = { ...second, sql: "CREATE TABLE partial(value TEXT)" };
    applyOwnedMigrations(db, [fixed, first]); applyOwnedMigrations(db, [first, fixed]);
    expect(rows(db)).toHaveLength(2);
  } finally { db.close(); }
});

test("applied-state reads and ledger writes occur under the writer transaction, including replay", () => {
  const db = new Database(":memory:"); const prepare = db.prepare.bind(db); let lookups = 0;
  const spy = spyOn(db, "prepare").mockImplementation(((sql: string, ...args: unknown[]) => {
    if (sql.includes("SELECT owner, id, migration_order, checksum")) { expect(db.inTransaction).toBe(true); lookups++; }
    return prepare(sql, ...args as []);
  }) as typeof db.prepare);
  try { applyOwnedMigrations(db, [first]); applyOwnedMigrations(db, [first]); expect(lookups).toBe(2); }
  finally { spy.mockRestore(); db.close(); }
});

test("nested owned migrations remain in the caller's transaction", () => {
  const db = new Database(":memory:");
  try {
    expect(() => db.transaction(() => { applyOwnedMigrations(db, [first]); throw Error("outer rollback"); }).immediate()).toThrow("outer rollback");
    expect(db.query("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([]);
    applyOwnedMigrations(db, [first]); expect(listAppliedOwnedMigrations(db)).toHaveLength(1);
  } finally { db.close(); }
});

test("persisted identities cannot be silently retargeted by a case-insensitive legacy ledger", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE piclaw_schema_migrations(owner TEXT COLLATE NOCASE,id TEXT COLLATE NOCASE,migration_order INTEGER,checksum TEXT,applied_at TEXT,PRIMARY KEY(owner,id)) WITHOUT ROWID;");
    applyOwnedMigrations(db, [first]); const before = rows(db);
    expect(() => applyOwnedMigrations(db, [{ ...first, owner: first.owner.toUpperCase() }])).toThrow("identity mismatch");
    expect(rows(db)).toEqual(before);
  } finally { db.close(); }
});

test("competing initializers serialize lookup/application without duplicate DDL", async () => {
  const dir = mkdtempSync(join(process.env.PICLAW_WORKSPACE!, "migration-race-"));
  const path = join(dir, "fixture.sqlite");
  const source = new URL("../../src/db/migrations.ts", import.meta.url).pathname;
  const code = `import{Database}from'bun:sqlite';import{applyOwnedMigrations}from${JSON.stringify(source)};const d=new Database(${JSON.stringify(path)});d.exec('PRAGMA busy_timeout=10000');applyOwnedMigrations(d,[${JSON.stringify(first)}]);d.close();`;
  try {
    const children = [0, 1, 2].map(() => Bun.spawn([process.execPath, "-e", code], { stdout: "pipe", stderr: "pipe" }));
    const results = await Promise.all(children.map(async child => ({ code: await child.exited, error: await new Response(child.stderr).text() })));
    expect(results).toEqual(results.map(() => ({ code: 0, error: "" })));
    const db = new Database(path);
    try { expect(rows(db)).toHaveLength(1); expect(db.query("SELECT * FROM owned").all()).toEqual([{ value: "original" }]); }
    finally { db.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 30000);
