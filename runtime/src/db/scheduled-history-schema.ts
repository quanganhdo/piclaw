import type { Database } from "bun:sqlite";
import { applyOwnedMigrations } from "./migrations.js";

const indexName = "idx_task_run_logs_occurrence";
const additions = ["occurrence_id", "payload_version", "payload_hash"];
const payloadCheck = `CHECK (
  (occurrence_id IS NULL AND payload_version IS NULL AND payload_hash IS NULL)
  OR (occurrence_id IS NOT NULL AND typeof(occurrence_id)='text' AND length(occurrence_id) BETWEEN 1 AND 512
    AND payload_version IS NOT NULL AND payload_version=1
    AND payload_hash IS NOT NULL AND typeof(payload_hash)='text' AND length(payload_hash)=64
    AND payload_hash=lower(payload_hash) AND payload_hash NOT GLOB '*[^0-9a-f]*')
)`;
export const scheduledHistoryMigration = Object.freeze({
  owner: "host.scheduled-history", id: "occurrence-payload-v1", order: 1,
  sql: `ALTER TABLE main.task_run_logs ADD COLUMN occurrence_id TEXT;
ALTER TABLE main.task_run_logs ADD COLUMN payload_version INTEGER;
ALTER TABLE main.task_run_logs ADD COLUMN payload_hash TEXT ${payloadCheck};
CREATE UNIQUE INDEX main.${indexName} ON task_run_logs(occurrence_id) WHERE occurrence_id IS NOT NULL;`,
});
const base = [
  ["id", "INTEGER", 0, 1], ["task_id", "TEXT", 1, 0], ["run_at", "TEXT", 1, 0],
  ["duration_ms", "INTEGER", 1, 0], ["status", "TEXT", 1, 0], ["result", "TEXT", 0, 0], ["error", "TEXT", 0, 0],
] as const;
type Column = { name: string; type: string; notnull: number; pk: number; dflt_value: unknown; hidden: number };
function columns(database: Database): Column[] {
  return database.query("PRAGMA main.table_xinfo(task_run_logs)").all() as Column[];
}
function verifyColumns(actual: Column[], extended: boolean): void {
  const expected = extended ? [...base, ["occurrence_id", "TEXT", 0, 0], ["payload_version", "INTEGER", 0, 0], ["payload_hash", "TEXT", 0, 0]] : base;
  if (actual.length !== expected.length || expected.some(([name, type, nullable, pk]) => {
    const column = actual.find(column => column.name === name);
    return !column || column.type.toUpperCase() !== type || column.notnull !== nullable || column.pk !== pk
      || column.dflt_value !== null || column.hidden !== 0;
  })) throw Error("Unsupported scheduled history columns");
}
function verifyIndex(database: Database): void {
  const index = (database.query("PRAGMA main.index_list(task_run_logs)").all() as { name: string; unique: number; partial: number; origin: string }[])
    .find(index => index.name === indexName);
  const keys = database.query(`PRAGMA main.index_xinfo(${indexName})`).all() as { name: string; key: number; desc: number; coll: string }[];
  const keyed = keys.filter(key => key.key === 1);
  const sql = (database.query("SELECT sql FROM main.sqlite_schema WHERE type='index' AND name=?").get(indexName) as { sql: string } | null)?.sql;
  if (!index || index.unique !== 1 || index.partial !== 1 || index.origin !== "c" || keyed.length !== 1
    || keyed[0]!.name !== "occurrence_id" || keyed[0]!.desc !== 0 || keyed[0]!.coll !== "BINARY"
    || !sql || !/WHERE\s+occurrence_id\s+IS\s+NOT\s+NULL\s*$/i.test(sql)) throw Error("Unsupported scheduled history index");
}

/** Add identity only to future admitted results. Historical rows stay unlinked.
 * Receipt/shape drift is an error; never adopt partial or unowned additions. */
export function initializeScheduledHistorySchema(database: Database): void {
  database.transaction(() => {
    if (database.query("SELECT 1 FROM sqlite_temp_schema WHERE name COLLATE NOCASE IN ('task_run_logs','piclaw_schema_migrations',?)").get(indexName)) {
      throw Error("Unsupported scheduled history schema shadow");
    }
    const ledger = database.query("SELECT 1 FROM main.sqlite_schema WHERE type='table' AND name='piclaw_schema_migrations'").get();
    const applied = ledger && database.query("SELECT 1 FROM main.piclaw_schema_migrations WHERE owner=? AND id=?")
      .get(scheduledHistoryMigration.owner, scheduledHistoryMigration.id);
    const actual = columns(database);
    verifyColumns(actual, !!applied);
    if (!applied && (actual.some(column => additions.includes(column.name))
      || database.query("SELECT 1 FROM main.sqlite_schema WHERE name=? COLLATE NOCASE").get(indexName))) {
      throw Error("Unowned scheduled history additions");
    }
    applyOwnedMigrations(database, [scheduledHistoryMigration]);
    verifyColumns(columns(database), true);
    verifyIndex(database);
    const sql = (database.query("SELECT sql FROM main.sqlite_schema WHERE type='table' AND name='task_run_logs'").get() as { sql: string }).sql;
    if (!sql.replace(/\s+/g, "").includes(payloadCheck.replace(/\s+/g, ""))) throw Error("Unsupported scheduled history payload constraint");
  }).immediate();
}
