import type { Database } from 'bun:sqlite';
import { applyOwnedMigrations, type OwnedSchemaMigration } from './migrations.js';

export const legacyCursorArchive = 'host_legacy_chat_cursor_state_v1';
const owner = 'host.chat-cursors';
// Recognition only. Neither migration nor native dispatch interprets these values.
const operationFields: Record<string, 'TEXT' | 'INTEGER'> = {
  operation_id: 'TEXT', operation_source_seq: 'INTEGER', operation_phase: 'TEXT', operation_generation: 'INTEGER',
  operation_cancel_cause: 'TEXT', operation_cancel_requested_at: 'TEXT', operation_settling_fence_id: 'TEXT', operation_settling_fenced_at: 'TEXT',
};
// Exact owner guards captured with the complete S01 cursor generation. Unknown
// dependencies remain fatal; these obsolete guards are removed only atomically
// with the archived table and the distinct owned-migration receipt.
const operationGuards: Record<string, string> = {
  chat_cursors_legacy_owner_exclusion: `CREATE TRIGGER chat_cursors_legacy_owner_exclusion
    BEFORE UPDATE OF cursor_ts, preflight_prev_ts, preflight_message_id, preflight_started_at,
      inflight_prev_ts, inflight_message_id, inflight_started_at,
      failed_prev_ts, failed_ts, failed_message_id, failed_thread_root, failed_created_at,
      compaction_active_started_at, compaction_active_reason
    ON chat_cursors WHEN old.operation_id IS NOT NULL AND new.operation_id IS NOT NULL
    BEGIN SELECT RAISE(ABORT, 'active operation excludes legacy ownership mutation'); END`,
  chat_cursors_active_owner_delete_exclusion: `CREATE TRIGGER chat_cursors_active_owner_delete_exclusion
    BEFORE DELETE ON chat_cursors WHEN old.operation_id IS NOT NULL
    BEGIN SELECT RAISE(ABORT, 'active operation excludes cursor deletion'); END`,
};
const retired: Record<string, 'TEXT' | 'INTEGER'> = {
  ...operationFields,
  preflight_prev_ts: 'TEXT', preflight_message_id: 'TEXT', preflight_started_at: 'TEXT',
  inflight_prev_ts: 'TEXT', inflight_message_id: 'TEXT', inflight_started_at: 'TEXT',
  failed_prev_ts: 'TEXT', failed_ts: 'TEXT', failed_message_id: 'TEXT', failed_thread_root: 'INTEGER', failed_created_at: 'TEXT',
  compaction_active_started_at: 'TEXT', compaction_active_reason: 'TEXT',
  auto_compaction_window_ordinal: 'INTEGER', auto_compaction_baseline_tokens: 'INTEGER', auto_compaction_prefill_tokens: 'INTEGER',
  auto_compaction_success_count: 'INTEGER', auto_compaction_warned_count: 'INTEGER', auto_compaction_updated_at: 'TEXT',
  compaction_failure_count: 'INTEGER', compaction_last_failed_at: 'TEXT', compaction_backoff_until: 'TEXT', compaction_last_error: 'TEXT',
};
// Physical generations in c8c502cd4, 79f2a7b52, 44d036256 and 35e443fc6;
// the four backoff ALTERs were independently additive from 3fbe834cc onward.
const historicalShapes = [['inflight_', 'failed_'], ['preflight_', 'inflight_', 'failed_'],
  ['preflight_', 'inflight_', 'failed_', 'compaction_active_'],
  ['preflight_', 'inflight_', 'failed_', 'compaction_active_', 'auto_compaction_']]
  .flatMap(prefixes => [prefixes, [...prefixes, 'compaction_failure_', 'compaction_last_', 'compaction_backoff_']])
  .map(prefixes => Object.keys(retired).filter(name => prefixes.some(prefix => name.startsWith(prefix))).sort().join(','));
// One additional finite generation: all historical fields plus all eight S01 fields.
historicalShapes.push(Object.keys(retired).sort().join(','));
const activeCursorSql = "CREATE TABLE main.chat_cursors (chat_jid TEXT PRIMARY KEY, cursor_ts TEXT NOT NULL DEFAULT '', queued_followups_json TEXT)";
const fresh: OwnedSchemaMigration = { owner, id: 'polling-frontier-v1', order: 1, sql: activeCursorSql };
/** Exact pre-queue/current historical variants. ALTER retains original schema,
 * column order, rowids and every value; copy advances no execution frontier. */
function retirement(hadQueue: boolean, guardedOperation = false): OwnedSchemaMigration {
  if (guardedOperation && !hadQueue) fail();
  const migration: OwnedSchemaMigration = { owner, id: hadQueue ? 'native-frontier-v1' : 'native-frontier-prequeue-v1', order: 1,
    sql: `ALTER TABLE main.chat_cursors RENAME TO ${legacyCursorArchive};
${activeCursorSql};
INSERT INTO main.chat_cursors(rowid,chat_jid,cursor_ts,queued_followups_json)
  SELECT rowid,chat_jid,cursor_ts,${hadQueue ? 'queued_followups_json' : 'NULL'} FROM main.${legacyCursorArchive} ORDER BY rowid;` };
  return guardedOperation ? { ...migration, id: 'native-frontier-s01-owner-v1', sql: Object.keys(operationGuards).map(name => `DROP TRIGGER main.${name};`).join('\n') + '\n' + migration.sql } : migration;
}
interface Column { name: string; type: string; notnull: number; dflt_value: string | null; pk: number; hidden: number }
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
function fail(): never { throw Error('Unsupported chat cursor retirement schema or receipt'); }
function columns(db: Database, name: string): Column[] {
  return db.query(`PRAGMA main.table_xinfo(${quote(name)})`).all() as Column[];
}
function sql(db: Database, name: string): string | null {
  const row = db.query('SELECT type,sql FROM main.sqlite_schema WHERE name=? COLLATE NOCASE').get(name) as { type: string; sql: string } | null;
  if (!row) return null;
  if (row.type !== 'table' || typeof row.sql !== 'string') fail();
  return row.sql;
}
/** Bounded declaration recognition, not SQL equivalence. Comments are ignored;
 * quoted tokens, string literals and every constraint stay exact, matching the
 * read-only schema inventory rather than accepting unregistered spellings. */
function normalise(text: string): string {
  const tokens = (text.match(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[a-zA-Z_][a-zA-Z_0-9$]*|[^\s]/g) ?? [])
    .filter(token => !token.startsWith('--') && !token.startsWith('/*'))
    .map(token => /^['"`\[]/.test(token) ? token : token.toLowerCase());
  if (tokens[2] === 'if' && tokens[3] === 'not' && tokens[4] === 'exists') tokens.splice(2, 3);
  if (tokens.at(-1) === ';') tokens.pop();
  return tokens.join(' ');
}
function assertShape(db: Database, name: string, active: boolean): Column[] {
  const definition = sql(db, name);
  if (!definition) fail();
  const rows = columns(db, name);
  if (rows.length < 2 || new Set(rows.map(row => row.name)).size !== rows.length) fail();
  const expected = rows.map(row => {
    const type = row.name === 'chat_jid' || row.name === 'cursor_ts' || row.name === 'queued_followups_json' ? 'TEXT' : retired[row.name];
    if (!type || row.type.toUpperCase() !== type || row.hidden !== 0 || row.pk !== (row.name === 'chat_jid' ? 1 : 0) ||
      row.notnull !== (row.name === 'cursor_ts' ? 1 : 0) || row.dflt_value !== (row.name === 'cursor_ts' ? "''" : null)) fail();
    return row.name === 'chat_jid' ? 'chat_jid TEXT PRIMARY KEY' : row.name === 'cursor_ts' ? "cursor_ts TEXT NOT NULL DEFAULT ''" : `${row.name} ${type}`;
  });
  if (!rows.some(row => row.name === 'chat_jid') || !rows.some(row => row.name === 'cursor_ts')) fail();
  if (!active && !historicalShapes.includes(rows.filter(row => Object.hasOwn(retired, row.name)).map(row => row.name).sort().join(','))) fail();
  if (active && rows.map(row => row.name).join(',') !== 'chat_jid,cursor_ts,queued_followups_json') fail();
  const header = name === legacyCursorArchive ? quote(name) : name;
  if (normalise(definition) !== normalise(`CREATE TABLE ${header} (${expected.join(',')})`)) fail();
  const indexes = db.query(`PRAGMA main.index_list(${quote(name)})`).all() as { origin: string }[];
  if (indexes.some(index => index.origin !== 'pk')) fail();
  return rows;
}
function assertNoDependents(db: Database, guardedOperation = false): void {
  const recognised = new Set<string>();
  for (const schema of ['main', 'temp']) {
    const objects = schema === 'main' ? 'main.sqlite_schema' : 'sqlite_temp_schema';
    const dependents = db.query(`SELECT type,name,tbl_name,sql FROM ${objects} WHERE type IN ('trigger','view') AND
      (tbl_name='chat_cursors' COLLATE NOCASE OR instr(lower(coalesce(sql,'')),'chat_cursors')>0 OR instr(lower(coalesce(sql,'')),?)>0)`).all(legacyCursorArchive) as {type:string;name:string;tbl_name:string;sql:string}[];
    for (const dependent of dependents) {
      const name = dependent.name.toLowerCase();
      if (!guardedOperation || schema !== 'main' || dependent.type !== 'trigger' || dependent.tbl_name.toLowerCase() !== 'chat_cursors' ||
        !Object.hasOwn(operationGuards, name) || normalise(dependent.sql) !== normalise(operationGuards[name]!)) fail();
      recognised.add(name);
    }
    if (db.query(`SELECT 1 FROM ${objects} s,pragma_foreign_key_list(s.name,?) f
      WHERE s.type='table' AND lower(f."table") IN ('chat_cursors',?) LIMIT 1`).get(schema, legacyCursorArchive)) fail();
  }
  if (guardedOperation && recognised.size !== Object.keys(operationGuards).length) fail();
}
/** Caller owns the root connection. A nested call is a savepoint; failed
 * recognition, copy, receipt or postcondition rolls back all retirement work.
 * Fresh roots create only active storage, never obsolete fields or an archive. */
export function initializeChatCursorStorage(db: Database): void {
  db.transaction(() => {
    if (db.query("SELECT 1 FROM sqlite_temp_schema WHERE name COLLATE NOCASE IN ('chat_cursors',?, 'piclaw_schema_migrations') LIMIT 1").get(legacyCursorArchive)) fail();
    const archive = sql(db, legacyCursorArchive), current = sql(db, 'chat_cursors');
    const ledger = db.query("SELECT 1 FROM main.sqlite_schema WHERE name='piclaw_schema_migrations' COLLATE NOCASE").get();
    const receipt = ledger ? db.query('SELECT id FROM main.piclaw_schema_migrations WHERE owner=?').all(owner) as { id: string }[] : [];
    const original = current && receipt.length === 0 ? assertShape(db, 'chat_cursors', false) : null;
    const guardedOperation = original?.some(row => row.name === 'operation_id') ?? false;
    assertNoDependents(db, guardedOperation);
    if (receipt.length) {
      if (receipt.length !== 1) fail();
      assertShape(db, 'chat_cursors', true);
      const archived = archive ? assertShape(db, legacyCursorArchive, false) : null;
      const migration = archived ? retirement(archived.some(row => row.name === 'queued_followups_json'), archived.some(row => row.name === 'operation_id')) : fresh;
      if (receipt[0]?.id !== migration.id) fail();
      applyOwnedMigrations(db, [migration]);
      return;
    }
    if (archive) fail(); // Unreceipted evidence is never overwritten or adopted.
    applyOwnedMigrations(db, [original ? retirement(original.some(row => row.name === 'queued_followups_json'), guardedOperation) : fresh]);
    assertShape(db, 'chat_cursors', true);
    if (original) assertShape(db, legacyCursorArchive, false);
  }).immediate();
}
/** Explicit historical capture only. Archived markers never drive native
 * execution; they can refuse capture of unsettled legacy evidence. */
export function hasUnsettledLegacyCursorEvidence(db: Database): boolean {
  if (!sql(db, legacyCursorArchive)) return false;
  const names = new Set(columns(db, legacyCursorArchive).map(row => row.name));
  const markers = ['preflight_message_id', 'inflight_message_id'].filter(name => names.has(name));
  return markers.length > 0 && !!db.query(`SELECT 1 FROM main.${legacyCursorArchive} WHERE ${markers.map(name => `${name} IS NOT NULL`).join(' OR ')} LIMIT 1`).get();
}
