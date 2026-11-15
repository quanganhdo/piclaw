import { createHash } from "node:crypto";
import type Database from "bun:sqlite";
import { hasScheduledTaskDefinitions, projectScheduledTask } from "../../db/scheduled-task-definitions.js";
import type { CompleteScheduledRunRequest, ScheduledRunResultPayload } from "../contracts/scheduled-run-store.js";
import { normaliseComplete } from "./scheduled-run-values.js";

export class ScheduledHistoryError extends Error {
  constructor(readonly tag: "corrupt_state" | "idempotency_conflict") { super(`Scheduled history ${tag}`); }
}
export const scheduledResultRef = (runId: string) => `task_run_result:${runId}`;
const scheduledResultPayloadHash = (payload: ScheduledRunResultPayload) =>
  createHash("sha256").update(JSON.stringify({ version: payload.version, result: payload.result, error: payload.error })).digest("hex");

/** Generic S07 fixtures may have no host projection. Partial host schema fails. */
export function hasScheduledHistoryProjection(database: Database): boolean {
  const columns = database.query("PRAGMA main.table_info(task_run_logs)").all() as { name: string }[];
  const expected = ["occurrence_id", "payload_version", "payload_hash"];
  const count = expected.filter(name => columns.some(column => column.name === name)).length;
  if (count !== 0 && count !== expected.length) throw new ScheduledHistoryError("corrupt_state");
  return count === expected.length;
}

type Canonical = {
  run_id: string; task_id: string; task_revision: number; scheduled_for: string;
  completed_at: string; duration_ms: number; status: "success" | "error"; result_ref: string | null; error_code: string | null;
  state: string; occurrence_task_id: string; occurrence_revision: number; occurrence_scheduled_for: string;
  settled_at: string; occurrence_duration: number; occurrence_status: string; occurrence_result: string | null; occurrence_error: string | null;
};
type PayloadRow = { id: number; result: string | null; error: string | null; payload_version: number; payload_hash: string };
export type ScheduledHistoryProjectionResult =
  | { state: "projected"; logId: number; resultIdentity: string }
  | { state: "unavailable" | "retired" };

/** Rebuild cache metadata from committed S07 identity and retained payload bytes.
 * New/restored bytes require the complete sealed request and its exact persisted
 * completion decision. This function cannot create another payload authority.
 * Missing bytes without that evidence are explicit, never invented/reexecuted. */
export function projectScheduledHistory(
  database: Database, runId: string, completion?: CompleteScheduledRunRequest,
): ScheduledHistoryProjectionResult {
  const project = (): ScheduledHistoryProjectionResult => {
    const evidence = completion ? normaliseComplete(completion) : null;
    if (completion && (!evidence?.resultPayload || evidence.runId !== runId)) throw new ScheduledHistoryError("idempotency_conflict");
    const payload = evidence?.resultPayload;
    if (evidence) {
      const decision = database.query("SELECT method,run_id,request_hash FROM main.service_effect_s07_decisions WHERE decision_key=?")
        .get(`effect:${evidence.effect.idempotencyKey}`) as { method: string; run_id: string; request_hash: string } | null;
      if (!decision || decision.method !== "complete" || decision.run_id !== runId || decision.request_hash !== evidence.effect.requestHash) {
        throw new ScheduledHistoryError("idempotency_conflict");
      }
    }
    if (!hasScheduledHistoryProjection(database)) {
      if (payload) throw new ScheduledHistoryError("corrupt_state");
      return { state: "unavailable" };
    }
    const canonical = database.query(`SELECT l.*,o.state,o.task_id AS occurrence_task_id,o.task_revision AS occurrence_revision,
      o.scheduled_for AS occurrence_scheduled_for,o.settled_at,o.duration_ms AS occurrence_duration,
      o.result_status AS occurrence_status,o.result_ref AS occurrence_result,o.error_code AS occurrence_error
      FROM main.service_effect_s07_run_logs l JOIN main.service_effect_s07_occurrences o ON o.run_id=l.run_id WHERE l.run_id=?`)
      .get(runId) as Canonical | null;
    if (!canonical) {
      if (payload) throw new ScheduledHistoryError("corrupt_state");
      return { state: "unavailable" };
    }
    if (!["success", "error"].includes(canonical.status) || !Number.isSafeInteger(canonical.duration_ms) || canonical.duration_ms < 0
      || canonical.state !== "completed" || canonical.task_id !== canonical.occurrence_task_id
      || canonical.task_revision !== canonical.occurrence_revision || canonical.scheduled_for !== canonical.occurrence_scheduled_for
      || canonical.completed_at !== canonical.settled_at || canonical.duration_ms !== canonical.occurrence_duration
      || canonical.status !== canonical.occurrence_status || canonical.result_ref !== canonical.occurrence_result
      || canonical.error_code !== canonical.occurrence_error) throw new ScheduledHistoryError("corrupt_state");
    if (evidence && (canonical.task_revision !== evidence.expectedTaskRevision || canonical.status !== evidence.status
      || canonical.completed_at !== evidence.completedAt || canonical.duration_ms !== evidence.durationMs
      || canonical.result_ref !== evidence.resultRef || canonical.error_code !== evidence.errorCode)) {
      throw new ScheduledHistoryError("corrupt_state");
    }
    let task = database.query("SELECT id FROM main.scheduled_tasks WHERE id=?").get(canonical.task_id);
    const head = database.query("SELECT status FROM main.service_effect_s07_tasks WHERE task_id=?").get(canonical.task_id) as { status: string } | null;
    // Explicit owner deletion suppresses repair, including old sealed requests.
    if (!head) throw new ScheduledHistoryError("corrupt_state");
    if (head.status === "deleted") return { state: "retired" };
    if (!task && hasScheduledTaskDefinitions(database)) {
      projectScheduledTask(database, canonical.task_id);
      task = database.query("SELECT id FROM main.scheduled_tasks WHERE id=?").get(canonical.task_id);
    }
    if (!task) return { state: "retired" };
    const stored = database.query("SELECT id,result,error,payload_version,payload_hash FROM main.task_run_logs WHERE occurrence_id=?")
      .get(runId) as PayloadRow | null;
    if (canonical.status === "success" && canonical.result_ref !== scheduledResultRef(runId)) {
      if (stored || payload) throw new ScheduledHistoryError("corrupt_state");
      return { state: "unavailable" }; // Old opaque references retain their original ownership.
    }
    if (stored) {
      if (stored.payload_version !== 1 || (stored.result !== null && typeof stored.result !== "string")
        || (stored.error !== null && typeof stored.error !== "string")
        || scheduledResultPayloadHash({ version: 1, result: stored.result, error: stored.error }) !== stored.payload_hash) {
        throw new ScheduledHistoryError("corrupt_state");
      }
      if (payload && scheduledResultPayloadHash(payload) !== stored.payload_hash) throw new ScheduledHistoryError("idempotency_conflict");
      database.query("UPDATE main.task_run_logs SET task_id=?,run_at=?,duration_ms=?,status=? WHERE id=? AND occurrence_id=?")
        .run(canonical.task_id, canonical.completed_at, canonical.duration_ms, canonical.status, stored.id, runId);
      return { state: "projected", logId: stored.id, resultIdentity: scheduledResultRef(runId) };
    }
    if (!payload) return { state: "unavailable" };
    const inserted = database.query(`INSERT INTO main.task_run_logs
      (task_id,run_at,duration_ms,status,result,error,occurrence_id,payload_version,payload_hash) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(canonical.task_id, canonical.completed_at, canonical.duration_ms, canonical.status,
        payload.result, payload.error, runId, payload.version, scheduledResultPayloadHash(payload));
    return { state: "projected", logId: Number(inserted.lastInsertRowid), resultIdentity: scheduledResultRef(runId) };
  };
  return database.inTransaction ? project() : database.transaction(project).immediate();
}
