import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { initDatabase, getDb } from '../../src/db.js';
import * as cursors from '../../src/db/chat-cursors.js';
import { initializeChatCursorStorage, legacyCursorArchive, hasUnsettledLegacyCursorEvidence } from '../../src/db/chat-cursor-storage.js';
import { ensureOwnedMigrationLedger } from '../../src/db/migrations.js';
import '../helpers.js';

const legacySql = readFileSync(new URL('../fixtures/legacy-chat-cursors.sql', import.meta.url), 'utf8');
const names = (db: Database, table = 'chat_cursors') => (db.query(`PRAGMA main.table_info(${table})`).all() as { name: string }[]).map(row => row.name);
const snapshot = (db: Database) => ({
  schema: db.query('SELECT * FROM main.sqlite_schema ORDER BY type,name').all(),
  temp: db.query('SELECT * FROM sqlite_temp_schema ORDER BY type,name').all(),
  rows: db.query((db.query("SELECT wr FROM pragma_table_list WHERE name='chat_cursors' AND schema='main'").get() as {wr:number}).wr
    ? 'SELECT * FROM main.chat_cursors ORDER BY chat_jid' : 'SELECT rowid,* FROM main.chat_cursors ORDER BY rowid').all(),
  receipts: db.query("SELECT 1 FROM main.sqlite_schema WHERE name='piclaw_schema_migrations'").get()
    ? db.query('SELECT * FROM main.piclaw_schema_migrations ORDER BY owner,migration_order').all() : [],
});
function fixture(body: (db: Database) => void, historical = true) {
  const db = new Database(':memory:', { strict: true });
  try { if (historical) db.exec(legacySql); body(db); } finally { db.close(); }
}
function seed(db: Database) {
  const columns = db.query('PRAGMA main.table_info(chat_cursors)').all() as { name: string; type: string }[];
  const values = columns.map(column => column.name === 'chat_jid' ? 'web:legacy' : column.name === 'cursor_ts' ? '2026-01-01' :
    column.name === 'queued_followups_json' ? '[{"source_id":"immutable-queued","source_accepted":true,"rowId":-1,"queuedContent":"retain bytes","threadId":null,"queuedAt":"2026-01-01","queuedBy":{"source":"runtime","sourceMessageId":"source-1"}}]' :
    column.type === 'INTEGER' ? 23 : `Historical ${column.name}`);
  db.query(`INSERT INTO chat_cursors(rowid,${columns.map(column => column.name).join(',')}) VALUES(71,${columns.map(() => '?').join(',')})`).run(...values);
  db.query("INSERT INTO chat_cursors(rowid,chat_jid,cursor_ts,queued_followups_json) VALUES(93,'web:malformed','still-pending',?)").run('{not valid JSON');
}

test('active cursor storage contains polling position and queued provenance, not execution/recovery ownership', () => {
  initDatabase();
  expect(names(getDb())).toEqual(['chat_jid', 'cursor_ts', 'queued_followups_json']);
  expect(getDb().query('SELECT 1 FROM sqlite_schema WHERE name=?').get(legacyCursorArchive)).toBeNull();
  for (const name of ['beginChatRun', 'beginChatPreflight', 'getInflightRuns', 'rollbackInflightRun', 'getFailedRun', 'getChatCompactionBackoff', 'getChatAutoCompactionWindow']) expect(cursors).not.toHaveProperty(name);
});

test('fresh owned install creates no obsolete fields/archive and replay preserves its exact receipt and rows', () => fixture(db => {
  initializeChatCursorStorage(db);
  expect(names(db)).toEqual(['chat_jid', 'cursor_ts', 'queued_followups_json']);
  expect(db.query('SELECT 1 FROM sqlite_schema WHERE name=?').get(legacyCursorArchive)).toBeNull();
  expect(hasUnsettledLegacyCursorEvidence(db)).toBe(false);
  db.exec("INSERT INTO chat_cursors VALUES('fresh','unadvanced','{malformed')");
  const before = snapshot(db);
  initializeChatCursorStorage(db);
  expect(snapshot(db)).toEqual(before);
  expect(db.query('SELECT owner,id,migration_order FROM piclaw_schema_migrations').all()).toEqual([{ owner: 'host.chat-cursors', id: 'polling-frontier-v1', migration_order: 1 }]);
}, false));

test('lost fresh-root receipt cannot silently adopt native polling storage as legacy history', () => fixture(db => {
  initializeChatCursorStorage(db);
  db.exec("INSERT INTO chat_cursors VALUES('fresh','native-position','unparsed'); DELETE FROM piclaw_schema_migrations WHERE owner='host.chat-cursors'");
  const before = snapshot(db);
  expect(() => initializeChatCursorStorage(db)).toThrow('Unsupported chat cursor');
  expect(snapshot(db)).toEqual(before);
}, false));

test('populated current upgrade preserves every historical field, rowid, malformed queue byte and unrelated receipt', () => fixture(db => {
  seed(db); ensureOwnedMigrationLedger(db);
  db.exec("INSERT INTO piclaw_schema_migrations VALUES('other-owner','retain-receipt',4,'exact-checksum','original-time')");
  const oldRows = db.query('SELECT rowid,* FROM chat_cursors ORDER BY rowid').all();
  const frontier = db.query('SELECT rowid,chat_jid,cursor_ts,queued_followups_json FROM chat_cursors ORDER BY rowid').all();
  const other = db.query("SELECT * FROM piclaw_schema_migrations WHERE owner='other-owner'").all();
  initializeChatCursorStorage(db);
  expect(names(db)).toEqual(['chat_jid', 'cursor_ts', 'queued_followups_json']);
  expect(db.query(`SELECT rowid,* FROM ${legacyCursorArchive} ORDER BY rowid`).all()).toEqual(oldRows);
  expect(db.query('SELECT rowid,* FROM chat_cursors ORDER BY rowid').all()).toEqual(frontier);
  expect(db.query("SELECT * FROM piclaw_schema_migrations WHERE owner='other-owner'").all()).toEqual(other);
  expect(hasUnsettledLegacyCursorEvidence(db)).toBe(true);
  const before = snapshot(db);
  db.exec("UPDATE chat_cursors SET cursor_ts='new-native-ack' WHERE chat_jid='web:legacy'");
  initializeChatCursorStorage(db);
  expect(db.query(`SELECT rowid,* FROM ${legacyCursorArchive} ORDER BY rowid`).all()).toEqual(oldRows);
  expect(snapshot(db).receipts).toEqual(before.receipts);
  expect(db.query("SELECT cursor_ts FROM chat_cursors WHERE chat_jid='web:legacy'").get()).toEqual({ cursor_ts: 'new-native-ack' });
}));

test('unusual legacy values and full-width rowids retain their SQL storage classes without normalisation', () => fixture(db => {
  db.exec("INSERT INTO chat_cursors(rowid,chat_jid,cursor_ts,queued_followups_json,compaction_failure_count) VALUES(9223372036854775807,NULL,x'00ff',x'fe00','invalid old count')");
  const before = db.query("SELECT CAST(rowid AS TEXT) AS original_rowid,typeof(chat_jid) AS jid_type,quote(cursor_ts) AS cursor_bytes,quote(queued_followups_json) AS queue_bytes,quote(compaction_failure_count) AS count_bytes FROM chat_cursors").all();
  initializeChatCursorStorage(db);
  expect(db.query(`SELECT CAST(rowid AS TEXT) AS original_rowid,typeof(chat_jid) AS jid_type,quote(cursor_ts) AS cursor_bytes,quote(queued_followups_json) AS queue_bytes,quote(compaction_failure_count) AS count_bytes FROM ${legacyCursorArchive}`).all()).toEqual(before);
  expect(db.query("SELECT CAST(rowid AS TEXT) AS original_rowid,typeof(chat_jid) AS jid_type,quote(cursor_ts) AS cursor_bytes,quote(queued_followups_json) AS queue_bytes FROM chat_cursors").get()).toEqual({original_rowid:'9223372036854775807',jid_type:'null',cursor_bytes:"X'00FF'",queue_bytes:"X'FE00'"});
}));

test('pre-queue upgrade preserves the exact smaller archive and does not invent queued work', () => fixture(db => {
  db.exec("CREATE TABLE chat_cursors(chat_jid TEXT PRIMARY KEY, cursor_ts TEXT NOT NULL DEFAULT '', inflight_prev_ts TEXT,inflight_message_id TEXT,inflight_started_at TEXT,failed_prev_ts TEXT,failed_ts TEXT,failed_message_id TEXT,failed_thread_root INTEGER,failed_created_at TEXT); INSERT INTO chat_cursors(chat_jid,cursor_ts,inflight_message_id) VALUES('old','position','unsettled')");
  const before = db.query('SELECT rowid,* FROM chat_cursors').all();
  initializeChatCursorStorage(db);
  expect(names(db, legacyCursorArchive)).toEqual(['chat_jid', 'cursor_ts', 'inflight_prev_ts', 'inflight_message_id', 'inflight_started_at', 'failed_prev_ts', 'failed_ts', 'failed_message_id', 'failed_thread_root', 'failed_created_at']);
  expect(db.query(`SELECT rowid,* FROM ${legacyCursorArchive}`).all()).toEqual(before);
  expect(db.query('SELECT * FROM chat_cursors').all()).toEqual([{ chat_jid: 'old', cursor_ts: 'position', queued_followups_json: null }]);
  expect(hasUnsettledLegacyCursorEvidence(db)).toBe(true);
  const migrated = snapshot(db); initializeChatCursorStorage(db); expect(snapshot(db)).toEqual(migrated);
}, false));

test('receipt insertion failure rolls back rename, replacement table, copied data and receipt together', () => fixture(db => {
  seed(db); ensureOwnedMigrationLedger(db);
  db.exec("CREATE TRIGGER refuse_cursor_receipt BEFORE INSERT ON piclaw_schema_migrations WHEN NEW.owner='host.chat-cursors' BEGIN SELECT RAISE(ABORT,'injected receipt failure'); END");
  const before = snapshot(db);
  expect(() => initializeChatCursorStorage(db)).toThrow('injected receipt failure');
  expect(snapshot(db)).toEqual(before);
  expect(db.query('SELECT 1 FROM sqlite_schema WHERE name=?').get(legacyCursorArchive)).toBeNull();
}));

test('caller rollback includes the entire nested migration, and a later attempt succeeds', () => fixture(db => {
  seed(db); const before = snapshot(db);
  expect(() => db.transaction(() => { initializeChatCursorStorage(db); throw Error('outer rollback'); })()).toThrow('outer rollback');
  expect(snapshot(db)).toEqual(before);
  initializeChatCursorStorage(db); expect(names(db)).toHaveLength(3);
}));

for (const [label, change] of [
  ['unknown column', 'ALTER TABLE chat_cursors ADD COLUMN mystery TEXT'],
  ['partial historical group', 'ALTER TABLE chat_cursors DROP COLUMN preflight_prev_ts'],
  ['unregistered quoted column spelling', 'ALTER TABLE chat_cursors RENAME COLUMN queued_followups_json TO "temporary_payload"; ALTER TABLE chat_cursors RENAME COLUMN temporary_payload TO "queued_followups_json"'],
  ['unowned index', 'CREATE INDEX extra_cursor_index ON chat_cursors(cursor_ts)'],
  ['inbound foreign key', 'CREATE TABLE dependent(chat TEXT REFERENCES chat_cursors(chat_jid))'],
  ['uppercase inbound foreign key', 'CREATE TABLE dependent(chat TEXT REFERENCES CHAT_CURSORS(chat_jid))'],
  ['uppercase temporary cursor shadow', 'CREATE TEMP TABLE CHAT_CURSORS(untouched TEXT)'],
  ['uppercase temporary ledger shadow', 'CREATE TEMP TABLE PICLAW_SCHEMA_MIGRATIONS(untouched TEXT)'],
  ['view', 'CREATE VIEW cursor_view AS SELECT * FROM chat_cursors'],
  ['temporary view', 'CREATE TEMP VIEW cursor_view AS SELECT * FROM main.chat_cursors'],
  ['trigger', 'CREATE TRIGGER cursor_trigger AFTER INSERT ON chat_cursors BEGIN SELECT 1; END'],
  ['temporary table shadow', 'CREATE TEMP TABLE chat_cursors(untouched TEXT)'],
  ['temporary archive shadow', `CREATE TEMP TABLE ${legacyCursorArchive}(untouched TEXT)`],
  ['temporary ledger shadow', 'CREATE TEMP TABLE piclaw_schema_migrations(untouched TEXT)'],
  ['unreceipted archive', `CREATE TABLE ${legacyCursorArchive}(untouched TEXT)`],
] as const) test(`unknown ${label} refuses retirement without changing original schema/data/receipts`, () => fixture(db => {
  seed(db); db.exec(change); const before = snapshot(db);
  if (label === 'unregistered quoted column spelling') expect((db.query("SELECT sql FROM sqlite_schema WHERE name='chat_cursors'").get() as {sql:string}).sql).toContain('"queued_followups_json"');
  expect(() => initializeChatCursorStorage(db)).toThrow('Unsupported chat cursor');
  expect(snapshot(db)).toEqual(before);
}));

for (const definition of [
  "CREATE TABLE chat_cursors(chat_jid TEXT PRIMARY KEY,cursor_ts TEXT NOT NULL DEFAULT '' CHECK(cursor_ts <> 'forbidden'))",
  "CREATE TABLE chat_cursors(chat_jid TEXT PRIMARY KEY,cursor_ts TEXT NOT NULL DEFAULT 'different')",
  "CREATE TABLE chat_cursors(chat_jid TEXT PRIMARY KEY,cursor_ts TEXT NOT NULL DEFAULT '') WITHOUT ROWID",
  "CREATE TABLE chat_cursors(chat_jid TEXT PRIMARY KEY,cursor_ts TEXT NOT NULL DEFAULT '',queued_followups_json INTEGER)",
]) test(`malformed/unknown declaration refuses unchanged: ${definition}`, () => fixture(db => {
  db.exec(definition); const before = snapshot(db);
  expect(() => initializeChatCursorStorage(db)).toThrow('Unsupported chat cursor'); expect(snapshot(db)).toEqual(before);
}, false));

for (const mutation of [
  "UPDATE piclaw_schema_migrations SET checksum='wrong' WHERE owner='host.chat-cursors'",
  "UPDATE piclaw_schema_migrations SET migration_order=2 WHERE owner='host.chat-cursors'",
  "UPDATE piclaw_schema_migrations SET id='unknown' WHERE owner='host.chat-cursors'",
  "DELETE FROM piclaw_schema_migrations WHERE owner='host.chat-cursors'",
  `DROP TABLE ${legacyCursorArchive}`,
  'ALTER TABLE chat_cursors ADD COLUMN inflight_message_id TEXT',
]) test(`post-upgrade receipt/schema drift refuses unchanged: ${mutation}`, () => fixture(db => {
  seed(db); initializeChatCursorStorage(db); db.exec(mutation); const before = snapshot(db);
  expect(() => initializeChatCursorStorage(db)).toThrow(); expect(snapshot(db)).toEqual(before);
}));
