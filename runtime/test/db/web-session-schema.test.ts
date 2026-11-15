import '../helpers.js';
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initDatabase, initializeDatabaseSchema, getDb, closeDatabase } from '../../src/db/connection.js';
import { applyOwnedMigrations } from '../../src/db/migrations.js';
import { createVerifiedSqliteBackup, verifySqliteBackup } from '../../src/db/backup.js';

const migration = {
  owner: 'host.web-sessions', id: 'session-identity-index-v1', order: 1,
  sql: 'CREATE UNIQUE INDEX IF NOT EXISTS idx_web_sessions_session_id ON web_sessions(session_id) WHERE session_id IS NOT NULL',
};
let previousMemory: string | undefined;
beforeEach(() => {
  previousMemory = process.env.PICLAW_DB_IN_MEMORY;
  process.env.PICLAW_DB_IN_MEMORY = '1'; closeDatabase(); initDatabase();
});
afterEach(() => {
  closeDatabase();
  if (previousMemory === undefined) delete process.env.PICLAW_DB_IN_MEMORY;
  else process.env.PICLAW_DB_IN_MEMORY = previousMemory;
});
function fixture(columns: string, index = '') {
  const db = getDb();
  db.exec(`DROP TABLE web_sessions; DELETE FROM piclaw_schema_migrations WHERE owner='host.web-sessions';
    CREATE TABLE web_sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL${columns ? ',' + columns : ''});
    INSERT INTO web_sessions(token,user_id,created_at,expires_at) VALUES('synthetic-bearer','alice','historical-created','historical-expiry'); ${index}`);
  return db;
}
const receipt = (db = getDb()) => db.query('SELECT * FROM piclaw_schema_migrations WHERE owner=? AND id=?').get(migration.owner, migration.id);
const tokens = (db = getDb()) => db.query('SELECT token,user_id,created_at,expires_at FROM web_sessions').all();

for (const [name, columns, index] of [
  ['older-without-either-column', '', ''],
  ['auth-method-only', 'auth_method TEXT', ''],
  ['identity-only', 'session_id TEXT', ''],
  ['both-columns-without-index', 'auth_method TEXT,session_id TEXT', ''],
  ['already-indexed', 'auth_method TEXT,session_id TEXT', migration.sql],
] as const) test(`web-session additive ledger baseline preserves rows and replay: ${name}`, () => {
  const db = fixture(columns, index), before = tokens();
  initializeDatabaseSchema(db);
  expect(receipt()).toMatchObject({ owner: migration.owner, id: migration.id, migration_order: 1,
    checksum: createHash('sha256').update(migration.sql).digest('hex') });
  const applied = receipt();
  expect(tokens()).toEqual(before);
  expect(db.query('SELECT auth_method,session_id FROM web_sessions').get()).toEqual({ auth_method: null, session_id: null });
  expect(db.query("SELECT name FROM pragma_index_list('web_sessions') WHERE name='idx_web_sessions_session_id' AND [unique]=1 AND partial=1").all()).toHaveLength(1);
  initializeDatabaseSchema(db); expect(receipt()).toEqual(applied); expect(tokens()).toEqual(before);
});

test('already-populated login identifiers and bearer bytes survive adoption and FK-enabled replay', () => {
  // This already-upgraded baseline also includes the independent auth-label schema.
  const db = fixture("auth_method TEXT,session_id TEXT,label TEXT NOT NULL DEFAULT ''", migration.sql);
  db.exec("UPDATE web_sessions SET auth_method='passkey',session_id='login-historical'; PRAGMA foreign_keys=ON");
  const before = db.query('SELECT * FROM web_sessions').all();
  initializeDatabaseSchema(db); const applied = receipt(); initializeDatabaseSchema(db);
  expect(db.query('SELECT * FROM web_sessions').all()).toEqual(before);
  expect(receipt()).toEqual(applied);
  expect(db.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
  expect(() => db.exec("INSERT INTO web_sessions(token,user_id,created_at,expires_at,auth_method,session_id) VALUES('other-synthetic-bearer','bob','historical-created','historical-expiry','totp','login-historical')"))
    .toThrow('UNIQUE constraint failed: web_sessions.session_id');
  expect(db.query('SELECT * FROM web_sessions').all()).toEqual(before);
});

test('shared legacy bridge replaces the two selected column probes and indexed DDL does not replay', () => {
  const db = getDb(), prepare = db.prepare.bind(db), exec = db.exec.bind(db), before = receipt();
  let probes = 0, indexCreates = 0;
  const read = spyOn(db, 'prepare').mockImplementation(((sql: string, ...args: unknown[]) => {
    if (/PRAGMA table_(?:x)?info\(web_sessions\)/i.test(sql)) probes++;
    return prepare(sql, ...args as []);
  }) as typeof db.prepare);
  const write = spyOn(db, 'exec').mockImplementation((sql: string) => {
    if (sql === migration.sql) indexCreates++;
    return exec(sql);
  });
  try { initializeDatabaseSchema(db); expect(probes).toBe(1); expect(indexCreates).toBe(0); expect(receipt()).toEqual(before); }
  finally { read.mockRestore(); write.mockRestore(); }
});

for (const [column, definition] of [['auth_method', 'auth_method INTEGER'], ['session_id', 'auth_method TEXT,session_id INTEGER']] as const) {
  test(`incompatible web-session ${column} cannot acquire a ledger receipt`, () => {
    const db = fixture(definition), before = tokens();
    expect(() => initializeDatabaseSchema(db)).toThrow(`Legacy schema postcondition failed: web_sessions.${column}.`);
    expect(receipt()).toBeNull(); expect(tokens()).toEqual(before);
    expect(db.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 0 });
  });
}

test('web-session ALTER failure rolls back prior column additions and never records success', () => {
  const db = fixture(''), exec = db.exec.bind(db), before = tokens();
  const spy = spyOn(db, 'exec').mockImplementation((sql: string) => {
    if (sql === 'ALTER TABLE web_sessions ADD COLUMN session_id TEXT') throw Error('PRIVATE_IO_FAILURE');
    return exec(sql);
  });
  try {
    expect(() => initializeDatabaseSchema(db)).toThrow('Legacy schema postcondition failed: web_sessions.session_id.');
    expect(db.query('PRAGMA table_info(web_sessions)').all()).toHaveLength(4);
    expect(receipt()).toBeNull(); expect(tokens()).toEqual(before);
    expect(db.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 0 });
  } finally { spy.mockRestore(); }
});

for (const index of [
  'CREATE INDEX idx_web_sessions_session_id ON web_sessions(session_id)',
  'CREATE UNIQUE INDEX idx_web_sessions_session_id ON web_sessions(user_id) WHERE session_id IS NOT NULL',
  'CREATE UNIQUE INDEX idx_web_sessions_session_id ON web_sessions(session_id) WHERE session_id IS NULL',
]) test(`unknown pre-existing index cannot acquire a receipt: ${index}`, () => {
  const db = fixture('auth_method TEXT,session_id TEXT', index), before = tokens();
  expect(() => initializeDatabaseSchema(db)).toThrow('Web session identity index postcondition failed.');
  expect(receipt()).toBeNull(); expect(tokens()).toEqual(before);
});

test('an applied web-session index is not silently repaired after out-of-band removal', () => {
  const db = getDb(), applied = receipt(); db.exec('DROP INDEX idx_web_sessions_session_id');
  expect(() => initializeDatabaseSchema(db)).toThrow('Web session identity index postcondition failed.');
  expect(receipt()).toEqual(applied);
  expect(db.query("SELECT name FROM sqlite_schema WHERE name='idx_web_sessions_session_id'").all()).toEqual([]);
});

for (const field of ['checksum', 'migration_order'] as const) test(`web-session replay refuses a changed ${field} without rewriting rows or receipts`, () => {
  const db = getDb(), before = tokens();
  db.prepare(`UPDATE piclaw_schema_migrations SET ${field}=? WHERE owner=? AND id=?`).run(field === 'checksum' ? 'changed' : 2, migration.owner, migration.id);
  const damaged = receipt();
  expect(() => initializeDatabaseSchema(db)).toThrow(field === 'checksum' ? 'checksum mismatch' : 'order mismatch');
  expect(receipt()).toEqual(damaged); expect(tokens()).toEqual(before);
});

test('verified owned backup and restored replay preserve web-session rows and exact receipt', () => {
  const db = fixture('auth_method TEXT,session_id TEXT', migration.sql); initializeDatabaseSchema(db);
  const before = tokens(), applied = receipt();
  const directory = mkdtempSync(join(process.env.PICLAW_WORKSPACE!, 'web-session-backup-'));
  const sourcePath = join(directory, 'owned-source.db'), snapshot = join(directory, 'snapshot.db');
  writeFileSync(sourcePath, db.serialize());
  const source = new Database(sourcePath);
  try {
    const manifest = createVerifiedSqliteBackup(source, sourcePath, snapshot);
    const restored = new Database(snapshot);
    try {
      applyOwnedMigrations(restored, [migration]);
      expect(tokens(restored)).toEqual(before); expect(receipt(restored)).toEqual(applied);
      expect(restored.query('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
      expect(verifySqliteBackup(snapshot).migrationLedgers).toEqual(manifest.migrationLedgers);
    } finally { restored.close(); }
  } finally { source.close(); rmSync(directory, { recursive: true, force: true }); }
});
