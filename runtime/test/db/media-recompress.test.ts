import "../helpers.js";
import { Database } from "bun:sqlite";
import { expect, test, spyOn } from "bun:test";
import { createHash } from "node:crypto";
import { gunzipSync } from "bun";
import * as compression from "../../src/db/media-compression.js";
import { migrateMediaCompression, recompressExistingMedia } from "../../src/db/media-recompress.js";
import { initDatabase, initializeDatabaseSchema, getDb, closeDatabase } from "../../src/db/connection.js";

const raw = new TextEncoder().encode("Original source bytes must survive compression and retry.\n".repeat(100));
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function fixture() {
  const db = new Database(":memory:");
  db.exec("PRAGMA user_version=1; CREATE TABLE media(id INTEGER PRIMARY KEY,content_type TEXT,data BLOB,metadata TEXT)");
  return db;
}
function insert(db: Database, id: number, data = raw, type = "text/plain", metadata: string | null = '{"source":"fixture"}') {
  db.query("INSERT INTO media VALUES(?,?,?,?)").run(id, type, data, metadata);
}
const version = (db: Database) => (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
const stored = (db: Database, id = 1) => db.query("SELECT data,metadata FROM media WHERE id=?").get(id) as { data: Uint8Array; metadata: string | null };

for (const trigger of ["BEFORE UPDATE ON media WHEN OLD.id=2 BEGIN SELECT RAISE(ABORT,'PRIVATE_ROW_ERROR'); END",
  "AFTER UPDATE ON media WHEN OLD.id=2 BEGIN SELECT RAISE(FAIL,'PRIVATE_ROW_ERROR'); END",
  "BEFORE UPDATE ON media WHEN OLD.id=2 BEGIN SELECT RAISE(IGNORE); END",
  "AFTER UPDATE ON media WHEN OLD.id=2 BEGIN UPDATE media SET data=x'00' WHERE id=NEW.id; END"]) {
  test(`partial migration retains failed bytes/marker and retries remaining rows: ${trigger.slice(0, 35)}`, () => {
    const db = fixture();
    try {
      for (const id of [1, 2, 3]) insert(db, id);
      const original = stored(db, 2);
      db.exec(`CREATE TRIGGER fail_media ${trigger}`);
      expect(migrateMediaCompression(db)).toMatchObject({ status: "partial", scanned: 3, compressed: 2, errors: 1 });
      expect(version(db)).toBe(1); expect(stored(db, 2)).toEqual(original);
      const done = stored(db, 1); expect(hash(gunzipSync(done.data))).toBe(hash(raw));
      db.exec("DROP TRIGGER fail_media");
      expect(migrateMediaCompression(db)).toMatchObject({ status: "complete", compressed: 1, skipped: 2, errors: 0 });
      expect(version(db)).toBe(2); expect(stored(db, 1)).toEqual(done);
      for (const id of [1, 2, 3]) expect(hash(gunzipSync(stored(db, id).data))).toBe(hash(raw));
      expect(migrateMediaCompression(db)).toEqual({ status: "already_complete" });
    } finally { db.close(); }
  });
}

for (const nested of [false, true]) test(`transaction-wide rollback cannot autocommit later rows or conceal lost startup ownership: nested=${nested}`, () => {
  const db = fixture();
  try {
    for (const id of [1, 2, 3]) insert(db, id);
    const before = [stored(db, 1), stored(db, 2), stored(db, 3)];
    db.exec("CREATE TRIGGER fail_media AFTER UPDATE ON media WHEN OLD.id=2 BEGIN SELECT RAISE(ROLLBACK,'PRIVATE_ROLLBACK'); END");
    if (nested) expect(() => db.transaction(() => migrateMediaCompression(db)).immediate()).toThrow("invalidated the startup transaction");
    else expect(migrateMediaCompression(db)).toEqual({ status: "failed" });
    expect(version(db)).toBe(1); expect(db.inTransaction).toBe(false);
    expect([stored(db, 1), stored(db, 2), stored(db, 3)]).toEqual(before);
  } finally { db.close(); }
});

test("top-level scan failure does not mark media completion", () => {
  const db = fixture();
  try { db.exec("DROP TABLE media"); expect(migrateMediaCompression(db)).toEqual({ status: "failed" }); expect(version(db)).toBe(1); }
  finally { db.close(); }
});

for (const ignored of [false, true]) test(`failed or ignored completion marker rolls back byte updates: ignored=${ignored}`, () => {
  const db = fixture(); insert(db, 1); const before = stored(db);
  const exec = db.exec.bind(db);
  const spy = spyOn(db, "exec").mockImplementation((sql: string) => {
    if (sql === "PRAGMA user_version = 2;") { if (ignored) return db; throw Error("PRIVATE_MARKER_FAILURE"); }
    return exec(sql);
  });
  try {
    expect(migrateMediaCompression(db)).toEqual({ status: "failed" }); expect(version(db)).toBe(1); expect(stored(db)).toEqual(before);
  } finally { spy.mockRestore(); db.close(); }
});

test("compressor exceptions are failures, never successful no-op rows", () => {
  const db = fixture(); insert(db, 1); const before = stored(db);
  const spy = spyOn(compression, "compressMedia").mockImplementation(() => { throw Error("PRIVATE_COMPRESSOR_FAILURE"); });
  try {
    expect(migrateMediaCompression(db)).toMatchObject({ status: "failed", errors: 1, skipped: 0 });
    expect(version(db)).toBe(1); expect(stored(db)).toEqual(before);
  } finally { spy.mockRestore(); db.close(); }
});

test("lossy compressor output is rejected before overwriting original bytes", () => {
  const db = fixture(); insert(db, 1); const before = stored(db);
  const spy = spyOn(compression, "compressMedia").mockImplementation(() => ({ data: new Uint8Array([0, 1]), metadata: { compressed: "gzip" } }));
  try {
    expect(migrateMediaCompression(db)).toMatchObject({ status: "failed", errors: 1 }); expect(stored(db)).toEqual(before); expect(version(db)).toBe(1);
  } finally { spy.mockRestore(); db.close(); }
});

for (const metadata of ["{broken", "[]", '"private string"', "42", '{"compressed":"unknown"}']) {
  test(`malformed/unsupported metadata is preserved without inventing completion: ${metadata}`, () => {
    const db = fixture(); insert(db, 1, raw, "text/plain", metadata); const before = stored(db);
    try {
      expect(migrateMediaCompression(db)).toMatchObject({ status: "failed", errors: 1 }); expect(stored(db)).toEqual(before); expect(version(db)).toBe(1);
    } finally { db.close(); }
  });
}

test("mixed compressed, binary, tiny and null-metadata media are idempotent and lossless", () => {
  const db = fixture(); const gzip = compression.maybeCompress(raw, "text/plain", { fixture: true });
  try {
    insert(db, 1, gzip.data, "text/plain", JSON.stringify(gzip.metadata)); insert(db, 2, raw, "image/png");
    insert(db, 3, new TextEncoder().encode("tiny")); insert(db, 4, raw, "text/plain", null);
    const existing = [stored(db, 1), stored(db, 2), stored(db, 3)];
    expect(recompressExistingMedia(db)).toMatchObject({ status: "complete", compressed: 1, skipped: 3, errors: 0 });
    expect([stored(db, 1), stored(db, 2), stored(db, 3)]).toEqual(existing);
    const once = stored(db, 4); expect(hash(gunzipSync(once.data))).toBe(hash(raw));
    expect(recompressExistingMedia(db)).toMatchObject({ status: "complete", compressed: 0, skipped: 4 }); expect(stored(db, 4)).toEqual(once);
  } finally { db.close(); }
});

for (const marker of [2, 7]) test(`historical marker${marker} is authoritative; no replay or schema rewrite`, () => {
  const db = fixture(); insert(db, 1); db.exec(`PRAGMA user_version=${marker}`); const before = stored(db);
  const spy = spyOn(db, "transaction");
  try {
    expect(migrateMediaCompression(db)).toEqual({ status: "already_complete" }); expect(spy).not.toHaveBeenCalled();
    expect(version(db)).toBe(marker); expect(stored(db)).toEqual(before);
  } finally { spy.mockRestore(); db.close(); }
});

test("empty eligible work completes, while outer startup rollback restores data and marker", () => {
  const db = fixture();
  try {
    expect(migrateMediaCompression(db)).toMatchObject({ status: "complete", scanned: 0 }); expect(version(db)).toBe(2);
    db.exec("PRAGMA user_version=1"); insert(db, 1); const before = stored(db);
    expect(() => db.transaction(() => { expect(migrateMediaCompression(db)).toMatchObject({ status: "complete" }); throw Error("outer failed"); }).immediate()).toThrow("outer failed");
    expect(version(db)).toBe(1); expect(stored(db)).toEqual(before);
  } finally { db.close(); }
});

test("full schema boundary does not record v2 on per-row errors and retries without rerunning FTS", () => {
  const previous = process.env.PICLAW_DB_IN_MEMORY; process.env.PICLAW_DB_IN_MEMORY = "1"; closeDatabase();
  try {
    initDatabase(); const db = getDb();
    db.exec("PRAGMA user_version=1");
    db.query("INSERT INTO media(id,filename,content_type,data,metadata) VALUES(1,'fixture.txt','text/plain',?,'{}')").run(raw);
    const before = stored(db);
    db.exec("CREATE TRIGGER fail_media BEFORE UPDATE ON media BEGIN SELECT RAISE(ABORT,'PRIVATE_ROW_ERROR'); END");
    initializeDatabaseSchema(db); expect(version(db)).toBe(1); expect(stored(db)).toEqual(before);
    db.exec("DROP TRIGGER fail_media"); initializeDatabaseSchema(db); expect(version(db)).toBe(2); expect(hash(gunzipSync(stored(db).data))).toBe(hash(raw));
  } finally { closeDatabase(); if (previous === undefined) delete process.env.PICLAW_DB_IN_MEMORY; else process.env.PICLAW_DB_IN_MEMORY = previous; }
});
