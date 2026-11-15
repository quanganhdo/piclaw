import { createHash } from "node:crypto";
import type Database from "bun:sqlite";
import type { ScheduledTask } from "../types.js";
import type { ScheduledTaskSnapshot } from "../service-effects/contracts/scheduled-run-store.js";
import { hashCanonicalRequest, type CanonicalJsonValue } from "../service-effects/contracts/common.js";
import { decodeTaskSnapshot, makeTaskSnapshot, normaliseTaskAuthorityInput } from "../service-effects/current-piclaw/scheduled-run-values.js";
import { applyOwnedMigrations } from "./migrations.js";
import { readScheduledTaskHead } from "./scheduled-task-head.js";

export const definitionTable = "host_scheduled_task_definitions";
const tableSql = `CREATE TABLE host_scheduled_task_definitions (
  task_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
  payload_ref TEXT NOT NULL,
  availability TEXT NOT NULL CHECK(availability IN ('known','unavailable','retired')),
  origin TEXT NOT NULL CHECK(origin IN ('authored','legacy_current','unknown')),
  payload_hash TEXT CHECK(payload_hash IS NULL OR (length(payload_hash)=64 AND payload_hash=lower(payload_hash) AND payload_hash NOT GLOB '*[^0-9a-f]*')),
  payload_json TEXT CHECK(payload_json IS NULL OR json_valid(payload_json)),
  captured_at TEXT CHECK(captured_at IS NULL OR (length(captured_at)=24 AND substr(captured_at,11,1)='T' AND substr(captured_at,24,1)='Z')),
  PRIMARY KEY(task_id,revision),
  FOREIGN KEY(task_id,revision) REFERENCES service_effect_s07_task_revisions(task_id,revision),
  CHECK((availability='known' AND origin IN ('authored','legacy_current') AND payload_hash IS NOT NULL AND payload_json IS NOT NULL AND captured_at IS NOT NULL)
    OR (availability='unavailable' AND origin='unknown' AND payload_hash IS NULL AND payload_json IS NULL AND captured_at IS NULL)
    OR (availability='retired' AND payload_json IS NULL))
) STRICT`;
const indexSql = `CREATE INDEX idx_scheduled_task_paused_successor ON service_effect_s07_next_decisions(task_id,task_revision,scheduled_for DESC) WHERE head_disposition='paused'`;
export const scheduledDefinitionMigration = Object.freeze({ owner: "host.scheduled-definitions", id: "versioned-payload-v1", order: 1,
  sql: `${tableSql};\n${indexSql};` });
const checksum = createHash("sha256").update(scheduledDefinitionMigration.sql).digest("hex");

/** Generic S07 compositions have no host payloads. Partial/unowned host state fails. */
export function hasScheduledTaskDefinitions(db: Database): boolean {
  const table = db.query("SELECT name,type,sql FROM main.sqlite_schema WHERE name=? COLLATE NOCASE").get(definitionTable) as { name: string; type: string; sql: string } | null;
  const ledger = db.query("SELECT 1 FROM main.sqlite_schema WHERE type='table' AND name='piclaw_schema_migrations'").get();
  const receipt = ledger ? db.query("SELECT migration_order,checksum FROM main.piclaw_schema_migrations WHERE owner=? AND id=?")
    .get(scheduledDefinitionMigration.owner, scheduledDefinitionMigration.id) as { migration_order: number; checksum: string } | null : null;
  const index = db.query("SELECT sql FROM main.sqlite_schema WHERE name='idx_scheduled_task_paused_successor' COLLATE NOCASE").get() as { sql: string } | null;
  if (!table && !receipt && !index) return false;
  if (!table || table.name !== definitionTable || table.type !== "table" || table.sql !== tableSql
    || !receipt || receipt.migration_order !== 1 || receipt.checksum !== checksum || index?.sql !== indexSql) {
    throw Error("Unsupported scheduled definition schema or receipt");
  }
  return true;
}

/** Schema, initial current-body capture and receipt commit together. No recapture
 * from the compatibility cache on reopen, including after payload loss. */
export function initializeScheduledTaskDefinitions(db: Database, capture: () => void): void {
  db.transaction(() => {
    if (db.query(`SELECT 1 FROM sqlite_temp_schema WHERE name COLLATE NOCASE IN
      ('host_scheduled_task_definitions','idx_scheduled_task_paused_successor','piclaw_schema_migrations')`).get()) throw Error("Scheduled definition schema shadow");
    if (hasScheduledTaskDefinitions(db)) return;
    if (db.query("SELECT 1 FROM main.sqlite_schema WHERE name='idx_scheduled_task_paused_successor' COLLATE NOCASE").get()) throw Error("Unowned scheduled definition index");
    applyOwnedMigrations(db, [scheduledDefinitionMigration]);
    hasScheduledTaskDefinitions(db);
    capture();
  }).immediate();
}

export interface ScheduledTaskDefinitionBody {
  version: 1;
  id: string;
  revision: number;
  chat_jid: string;
  prompt: string;
  model: string | null;
  task_kind: "agent" | "shell" | "internal";
  command: string | null;
  cwd: string | null;
  timeout_sec: number | null;
  notify_on_complete: boolean;
  schedule_type: "once" | "cron" | "interval";
  schedule_value: string;
  created_at: string;
}
const bodyKeys = ["version", "id", "revision", "chat_jid", "prompt", "model", "task_kind", "command", "cwd", "timeout_sec",
  "notify_on_complete", "schedule_type", "schedule_value", "created_at"].sort().join(",");
const nullableText = (value: unknown) => value === null || typeof value === "string";
export function definitionBody(task: ScheduledTask): Readonly<ScheduledTaskDefinitionBody> {
  return decodeDefinitionBody({ version: 1, id: task.id, revision: task.revision, chat_jid: task.chat_jid, prompt: task.prompt,
    model: task.model ?? null, task_kind: task.task_kind ?? "agent", command: task.command ?? null, cwd: task.cwd ?? null,
    timeout_sec: task.timeout_sec ?? null, notify_on_complete: task.notify_on_complete !== false && task.notify_on_complete !== 0,
    schedule_type: task.schedule_type,
    schedule_value: task.schedule_type === "once" ? new Date(task.schedule_value).toISOString() : task.schedule_value,
    created_at: task.created_at });
}
function decodeDefinitionBody(value: unknown): Readonly<ScheduledTaskDefinitionBody> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid scheduled definition payload");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join(",") !== bodyKeys || v.version !== 1 || typeof v.id !== "string" || !v.id
    || !Number.isSafeInteger(v.revision) || Number(v.revision) < 1 || typeof v.chat_jid !== "string" || !v.chat_jid
    || typeof v.prompt !== "string" || !nullableText(v.model) || !nullableText(v.command) || !nullableText(v.cwd)
    || !["agent", "shell", "internal"].includes(String(v.task_kind))
    || !(v.timeout_sec === null || (Number.isSafeInteger(v.timeout_sec) && Number(v.timeout_sec) >= 0))
    || typeof v.notify_on_complete !== "boolean" || !["once", "cron", "interval"].includes(String(v.schedule_type))
    || typeof v.schedule_value !== "string" || typeof v.created_at !== "string") throw Error("Invalid scheduled definition payload");
  return Object.freeze({ ...v }) as unknown as Readonly<ScheduledTaskDefinitionBody>;
}
export const definitionHash = (body: Readonly<ScheduledTaskDefinitionBody>) => hashCanonicalRequest(body as unknown as CanonicalJsonValue);
export const definitionRef = (body: Readonly<ScheduledTaskDefinitionBody>) => `scheduled_definition:v1:${definitionHash(body)}`;

/** The S07 admission snapshot derives from this version's immutable definition.
 * Preserve the explicit legacy shell inference and presentation fields. */
export function definitionSnapshot(body: Readonly<ScheduledTaskDefinitionBody>, payloadRef: string,
  timezone: string, nextRunAt: string, authoredAt: string): ScheduledTaskSnapshot {
  const kind = body.task_kind === "internal" ? "internal" : body.task_kind === "shell" || body.command ? "shell" : "agent";
  const input = normaliseTaskAuthorityInput({ taskId: body.id, chatJid: body.chat_jid, kind, payloadRef,
    modelLabel: body.model || null, scheduleType: body.schedule_type,
    scheduleValue: body.schedule_type === "once" ? new Date(body.schedule_value).toISOString() : body.schedule_value, timezone,
    notifyOnComplete: body.notify_on_complete, muted: !body.notify_on_complete,
    cwd: kind === "shell" ? body.cwd || null : null, timeoutSec: kind === "shell" ? body.timeout_sec || null : null,
    internalTask: kind === "internal" ? { discriminator: "piclaw_internal", reference: `scheduled_task:${body.id}` } : null,
    redactionClass: "private", executionRepeatability: kind === "agent" ? "agent_source" : "repeatable",
    nextRunAt: new Date(nextRunAt).toISOString(), authoredAt });
  if (!input) throw Error("Scheduled definition cannot be represented by S07");
  return makeTaskSnapshot(input, body.revision);
}

export function insertScheduledDefinition(db: Database, snapshot: ScheduledTaskSnapshot,
  body: Readonly<ScheduledTaskDefinitionBody> | null, origin: "authored" | "legacy_current" | "unknown", capturedAt: string | null): void {
  if (body) {
    const derived = definitionSnapshot(body, snapshot.payloadRef, snapshot.timezone,
      snapshot.scheduleType === "once" ? snapshot.scheduleValue : "2000-01-01T00:00:00.000Z", "2000-01-01T00:00:00.000Z");
    if (derived.configHash !== snapshot.configHash || body.id !== snapshot.taskId || body.revision !== snapshot.revision
      || (origin === "authored" && snapshot.payloadRef !== definitionRef(body))
      || (origin === "legacy_current" && snapshot.payloadRef !== `scheduled_task:${body.id}:revision:${body.revision}`)) {
      throw Error("Scheduled definition metadata mismatch");
    }
  }
  db.query(`INSERT INTO main.host_scheduled_task_definitions
    (task_id,revision,payload_ref,availability,origin,payload_hash,payload_json,captured_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run(snapshot.taskId, snapshot.revision, snapshot.payloadRef, body ? "known" : "unavailable", origin,
      body ? definitionHash(body) : null, body ? JSON.stringify(body) : null, capturedAt);
}

export function readScheduledDefinition(db: Database, taskId: string, revision: number) {
  if (!hasScheduledTaskDefinitions(db)) throw Error("Scheduled definition store unavailable");
  const row = db.query(`SELECT r.snapshot_json,r.config_hash,d.payload_ref,d.availability,d.origin,d.payload_hash,d.payload_json,d.captured_at
    FROM main.service_effect_s07_task_revisions r LEFT JOIN main.host_scheduled_task_definitions d
      ON d.task_id=r.task_id AND d.revision=r.revision WHERE r.task_id=? AND r.revision=?`)
    .get(taskId, revision) as { snapshot_json: string; config_hash: string; payload_ref: string | null; availability: "known" | "unavailable" | "retired" | null;
      origin: "authored" | "legacy_current" | "unknown"; payload_hash: string | null; payload_json: string | null; captured_at: string | null } | null;
  if (!row || !row.availability || !row.payload_ref) throw Error("Scheduled definition payload unavailable");
  let snapshot: ScheduledTaskSnapshot | null;
  try { snapshot = decodeTaskSnapshot(JSON.parse(row.snapshot_json)); } catch { throw Error("Corrupt scheduled definition snapshot"); }
  if (!snapshot || snapshot.taskId !== taskId || snapshot.revision !== revision || snapshot.configHash !== row.config_hash
    || snapshot.payloadRef !== row.payload_ref) throw Error("Corrupt scheduled definition snapshot");
  if (row.availability !== "known") return { snapshot, availability: row.availability, origin: row.origin, capturedAt: row.captured_at, body: null } as const;
  let body: Readonly<ScheduledTaskDefinitionBody>;
  try { body = decodeDefinitionBody(JSON.parse(row.payload_json!)); } catch { throw Error("Corrupt scheduled definition payload"); }
  const derived = definitionSnapshot(body, snapshot.payloadRef, snapshot.timezone,
    snapshot.scheduleType === "once" ? snapshot.scheduleValue : "2000-01-01T00:00:00.000Z", "2000-01-01T00:00:00.000Z");
  if (body.id !== taskId || body.revision !== revision || definitionHash(body) !== row.payload_hash || derived.configHash !== snapshot.configHash
    || (row.origin === "authored" && definitionRef(body) !== snapshot.payloadRef)
    || (row.origin === "legacy_current" && snapshot.payloadRef !== `scheduled_task:${taskId}:revision:${revision}`)) throw Error("Corrupt scheduled definition binding");
  return { snapshot, availability: row.availability, origin: row.origin, capturedAt: row.captured_at, body } as const;
}

export function visibleScheduledNextRun(db: Database, taskId: string, revision: number, heldSlot: string | null, paused: boolean): string | null {
  if (!paused) return heldSlot;
  const held = db.query(`SELECT computed_next_run_at FROM main.service_effect_s07_next_decisions
    WHERE task_id=? AND task_revision=? AND scheduled_for=? AND head_disposition='paused' LIMIT 1`)
    .get(taskId, revision, heldSlot) as { computed_next_run_at: string | null } | null;
  return held ? held.computed_next_run_at : heldSlot;
}

/** Execution and API payload reads never consult mutable compatibility bytes. */
export function readCanonicalScheduledTask(db: Database, taskId: string): ScheduledTask | undefined {
  return db.transaction(() => {
    const head = readScheduledTaskHead(db, taskId);
    if (!head || head.status === "deleted") return undefined;
    const definition = readScheduledDefinition(db, taskId, head.revision);
    if (!definition.body) throw Error("Scheduled definition payload unavailable");
    const { version: _version, ...body } = definition.body;
    const cached = db.query("SELECT last_run,last_result FROM main.scheduled_tasks WHERE id=?").get(taskId) as { last_run: string | null; last_result: string | null } | null;
    return { ...body, notify_on_complete: body.notify_on_complete ? 1 : 0, status: head.status,
      next_run: visibleScheduledNextRun(db, taskId, head.revision, head.nextRunAt, head.status === "paused"),
      last_run: cached?.last_run ?? null, last_result: cached?.last_result ?? null };
  })();
}

/** Read-only metadata source for bounded UI filters/counts/order; payloads are
 * validated by readCanonicalScheduledTask before returning any selected row. */
export const canonicalScheduledTasksSql = `SELECT h.task_id AS id,h.current_revision AS revision,h.status,
  json_extract(d.payload_json,'$.chat_jid') AS chat_jid,json_extract(d.payload_json,'$.created_at') AS created_at,
  CASE WHEN h.status='paused' AND EXISTS(SELECT 1 FROM main.service_effect_s07_next_decisions n
    WHERE n.task_id=h.task_id AND n.task_revision=h.current_revision AND n.scheduled_for=h.next_run_at AND n.head_disposition='paused')
  THEN (SELECT n.computed_next_run_at FROM main.service_effect_s07_next_decisions n WHERE n.task_id=h.task_id
    AND n.task_revision=h.current_revision AND n.scheduled_for=h.next_run_at AND n.head_disposition='paused' LIMIT 1)
  ELSE h.next_run_at END AS next_run
  FROM main.service_effect_s07_tasks h JOIN main.host_scheduled_task_definitions d ON d.task_id=h.task_id AND d.revision=h.current_revision
  WHERE h.status<>'deleted' AND d.availability='known'`;

/** Sole compatibility row projector. Head changes and this write share their
 * owner's transaction. last_run/result retain legacy UI evidence only. */
export function projectScheduledTask(db: Database, taskId: string, runId?: string): void {
  db.transaction(() => {
    if (!hasScheduledTaskDefinitions(db)) return;
    const task = readCanonicalScheduledTask(db, taskId);
    if (!task) return; // Only explicit deletion may remove existing payload/history.
    const latest = db.query(`SELECT run_at,status,result,error FROM main.task_run_logs WHERE task_id=? ORDER BY run_at DESC,id DESC LIMIT 1`)
      .get(taskId) as { run_at: string; status: string; result: string | null; error: string | null } | null;
    if (latest && (!task.last_run || latest.run_at >= task.last_run)) {
      task.last_run = latest.run_at;
      task.last_result = latest.status === "error" ? `Error: ${latest.error || "Unknown"}` : latest.result?.slice(0, 200) || "Completed";
    }
    const terminal = runId ? db.query(`SELECT state,settled_at,result_status,error_code,abandonment_reason_tag
      FROM main.service_effect_s07_occurrences WHERE run_id=? AND task_id=? AND state IN ('completed','abandoned')`)
      .get(runId, taskId) as { state: string; settled_at: string; result_status: string | null; error_code: string | null; abandonment_reason_tag: string | null } | null : null;
    if (terminal && (!task.last_run || terminal.settled_at > task.last_run)) {
      task.last_run = terminal.settled_at;
      task.last_result = terminal.state === "abandoned" ? `Skipped: ${terminal.abandonment_reason_tag}`
        : terminal.result_status === "error" ? `Error: ${terminal.error_code}` : "Completed";
    }
    db.query(`INSERT INTO main.scheduled_tasks
      (id,chat_jid,prompt,model,task_kind,command,cwd,timeout_sec,notify_on_complete,schedule_type,schedule_value,next_run,last_run,last_result,status,created_at,revision)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      chat_jid=excluded.chat_jid,prompt=excluded.prompt,model=excluded.model,task_kind=excluded.task_kind,command=excluded.command,cwd=excluded.cwd,
      timeout_sec=excluded.timeout_sec,notify_on_complete=excluded.notify_on_complete,schedule_type=excluded.schedule_type,schedule_value=excluded.schedule_value,
      next_run=excluded.next_run,last_run=excluded.last_run,last_result=excluded.last_result,status=excluded.status,created_at=excluded.created_at,revision=excluded.revision`)
      .run(task.id, task.chat_jid, task.prompt, task.model ?? null, task.task_kind ?? "agent", task.command ?? null, task.cwd ?? null, task.timeout_sec ?? null,
        task.notify_on_complete ? 1 : 0, task.schedule_type, task.schedule_value, task.next_run, task.last_run, task.last_result, task.status, task.created_at, task.revision);
  })();
}
