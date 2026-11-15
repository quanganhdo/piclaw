import "../helpers.js";
import { Database } from "bun:sqlite";
import { expect, test, spyOn } from "bun:test";
import { ensureLegacyColumns } from "../../src/db/legacy-columns.js";
import { initDatabase, initializeDatabaseSchema, getDb, closeDatabase } from "../../src/db/connection.js";

const text = [{ name: "content_blocks", type: "TEXT" as const }];
const notes = [{ name: "user_note", type: "TEXT" as const, notNull: true, defaultSql: "''" as const }];

for (const failure of ["io", "incompatible"]) test(`full schema boundary refuses missing/wrong selected column and preserves FK policy: ${failure}`, () => {
  const previous = process.env.PICLAW_DB_IN_MEMORY; process.env.PICLAW_DB_IN_MEMORY = "1"; closeDatabase();
  let spy: ReturnType<typeof spyOn> | undefined;
  try {
    initDatabase(); const db = getDb(); db.exec("ALTER TABLE messages DROP COLUMN annotations");
    if (failure === "incompatible") db.exec("ALTER TABLE messages ADD COLUMN annotations INTEGER");
    else {
      const exec = db.exec.bind(db);
      spy = spyOn(db, "exec").mockImplementation((sql: string) => {
        if (sql === "ALTER TABLE messages ADD COLUMN annotations TEXT") throw Error("PRIVATE_IO_FAILURE");
        return exec(sql);
      });
    }
    expect(() => initializeDatabaseSchema(db)).toThrow("Legacy schema postcondition failed: messages.annotations.");
    expect(db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 0 });
    const columns = db.query("PRAGMA table_info(messages)").all() as { name: string; type: string }[];
    expect(columns.find(column => column.name === "annotations")?.type).toBe(failure === "io" ? undefined : "INTEGER");
  } finally {
    spy?.mockRestore(); closeDatabase(); if (previous === undefined) delete process.env.PICLAW_DB_IN_MEMORY; else process.env.PICLAW_DB_IN_MEMORY = previous;
  }
});

test("selected legacy columns add and verify fresh shapes, then replay without ALTER", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE messages(id INTEGER); CREATE TABLE keychain_entries(id INTEGER); INSERT INTO keychain_entries VALUES(1)");
    ensureLegacyColumns(db, "messages", text); ensureLegacyColumns(db, "keychain_entries", notes);
    const before = db.query("SELECT sql FROM sqlite_master ORDER BY name").all();
    ensureLegacyColumns(db, "messages", text); ensureLegacyColumns(db, "keychain_entries", notes);
    expect(db.query("SELECT sql FROM sqlite_master ORDER BY name").all()).toEqual(before);
    expect(db.query("SELECT user_note FROM keychain_entries").get()).toEqual({ user_note: "" });
  } finally { db.close(); }
});

for (const definition of ["INTEGER", "TEXT NOT NULL DEFAULT ''", "TEXT DEFAULT 'wrong'", "TEXT GENERATED ALWAYS AS ('generated') VIRTUAL"]) {
  test(`already-present incompatible column is refused: ${definition}`, () => {
    const db = new Database(":memory:");
    try {
      db.exec(`CREATE TABLE messages(id INTEGER, content_blocks ${definition})`);
      expect(() => ensureLegacyColumns(db, "messages", text)).toThrow("postcondition failed");
    } finally { db.close(); }
  });
}

for (const compatible of [true, false]) test(`failed ALTER accepts a concurrent column only with matching shape=${compatible}`, () => {
  const db = new Database(":memory:"); db.exec("CREATE TABLE messages(id INTEGER)");
  const exec = db.exec.bind(db);
  const spy = spyOn(db, "exec").mockImplementation((sql: string) => {
    if (sql.startsWith("ALTER TABLE messages")) {
      exec(`ALTER TABLE messages ADD COLUMN content_blocks ${compatible ? "TEXT" : "INTEGER"}`);
      throw Error("PRIVATE_SQLITE_FAILURE");
    }
    return exec(sql);
  });
  try {
    if (compatible) expect(() => ensureLegacyColumns(db, "messages", text)).not.toThrow();
    else expect(() => ensureLegacyColumns(db, "messages", text)).toThrow("postcondition failed");
  } finally { spy.mockRestore(); db.close(); }
});

for (const failure of ["SQLITE_IOERR", "SQLITE_READONLY"]) test(`missing ALTER postcondition propagates bounded diagnostics after ${failure}`, () => {
  const db = new Database(":memory:"); db.exec("CREATE TABLE messages(id INTEGER)");
  const exec = db.exec.bind(db);
  const spy = spyOn(db, "exec").mockImplementation((sql: string) => {
    if (sql.startsWith("ALTER TABLE messages")) throw Error(`${failure}: PRIVATE_PATH_AND_SECRET`);
    return exec(sql);
  });
  try {
    let error: unknown;
    try { ensureLegacyColumns(db, "messages", text); } catch (caught) { error = caught; }
    expect(String(error)).toContain("postcondition failed: messages.content_blocks");
    expect(String(error)).not.toContain("PRIVATE");
    expect(db.query("PRAGMA table_info(messages)").all()).toHaveLength(1);
  } finally { spy.mockRestore(); db.close(); }
});

test("a no-op ALTER cannot masquerade as a successful schema change", () => {
  const db = new Database(":memory:"); db.exec("CREATE TABLE messages(id INTEGER)");
  const spy = spyOn(db, "exec").mockImplementation(() => db);
  try { expect(() => ensureLegacyColumns(db, "messages", text)).toThrow("postcondition failed"); }
  finally { spy.mockRestore(); db.close(); }
});

test("inspection failure is bounded and never labelled an already-applied race", () => {
  const db = new Database(":memory:");
  const spy = spyOn(db, "prepare").mockImplementation(() => { throw Error("PRIVATE_SCHEMA_ERROR"); });
  try {
    expect(() => ensureLegacyColumns(db, "messages", text)).toThrow("Cannot inspect legacy schema postconditions: messages.");
  } finally { spy.mockRestore(); db.close(); }
});

test("outer initialization transaction rolls back earlier selected DDL on a later failure", () => {
  const db = new Database(":memory:"); db.exec("CREATE TABLE messages(id INTEGER)");
  const exec = db.exec.bind(db);
  const spy = spyOn(db, "exec").mockImplementation((sql: string) => {
    if (sql.includes("ADD COLUMN link_previews")) throw Error("PRIVATE_DISK_FAILURE");
    return exec(sql);
  });
  try {
    expect(() => db.transaction(() => ensureLegacyColumns(db, "messages", [...text, { name: "link_previews", type: "TEXT" }])).immediate())
      .toThrow("postcondition failed");
    expect(db.query("PRAGMA table_info(messages)").all()).toHaveLength(1);
  } finally { spy.mockRestore(); db.close(); }
});

test("default/nullability checks distinguish correct keychain notes and equivalent parenthesized literals", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE keychain_entries(id INTEGER,user_note text NOT NULL DEFAULT (('')))");
    expect(() => ensureLegacyColumns(db, "keychain_entries", notes)).not.toThrow();
    db.exec("CREATE TABLE messages(id INTEGER,is_steering_message integer DEFAULT ((0)))");
    expect(() => ensureLegacyColumns(db, "messages", [{ name: "is_steering_message", type: "INTEGER", defaultSql: "0" }])).not.toThrow();
  } finally { db.close(); }
});
