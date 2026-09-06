/**
 * CRUD operations for scheduled task definitions and their execution history.
 * The legacy `scheduled_tasks` rows remain the user-facing payload store while
 * EF-S07 task heads/revisions provide durable scheduler authority.
 */

import type { ScheduledRunRecord } from "../service-effects/contracts/scheduled-run-store.js";
import type Database from "bun:sqlite";
import type { ScheduledTask, TaskRunLog } from "../types.js";
import { getDb } from "./connection.js";
import {
  createScheduledTaskAuthorityRecord,
  deleteScheduledTaskAuthorityRecord,
  reviseScheduledTaskAuthorityRecord,
  setScheduledTaskAuthorityStatus,
} from "./scheduled-task-authority.js";

type SqlBinding = string | number | bigint | boolean | Uint8Array | null;
type TaskUpdate = Partial<Pick<ScheduledTask,
  "prompt" | "model" | "task_kind" | "command" | "cwd" | "timeout_sec" | "notify_on_complete" |
  "schedule_type" | "schedule_value" | "next_run" | "status"
>>;

const CONFIG_FIELDS: ReadonlyArray<keyof TaskUpdate> = [
  "prompt", "model", "task_kind", "command", "cwd", "timeout_sec", "notify_on_complete",
  "schedule_type", "schedule_value", "next_run",
];

function equivalent(field: keyof TaskUpdate, left: unknown, right: unknown): boolean {
  if (field === "notify_on_complete") {
    return (left !== false && left !== 0) === (right !== false && right !== 0);
  }
  return (left ?? null) === (right ?? null);
}

/** Insert a task and its first durable authority revision atomically. */
export function createTask(task: Omit<ScheduledTask, "last_run" | "last_result" | "revision">, db: Database = getDb()): void {
  const canonicalNextRun = task.next_run ? new Date(task.next_run).toISOString() : null;
  const canonicalScheduleValue = task.schedule_type === "once" && canonicalNextRun ? canonicalNextRun : task.schedule_value;
  const stored: ScheduledTask = {
    ...task,
    schedule_value: canonicalScheduleValue,
    next_run: canonicalNextRun,
    revision: 1,
    last_run: null,
    last_result: null,
  };
  db.transaction(() => {
    db.prepare(
      `INSERT INTO scheduled_tasks (
        id, chat_jid, prompt, model, task_kind, command, cwd, timeout_sec, notify_on_complete,
        schedule_type, schedule_value, next_run, status, created_at, revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      task.id,
      task.chat_jid,
      task.prompt,
      task.model ?? null,
      task.task_kind ?? "agent",
      task.command ?? null,
      task.cwd ?? null,
      task.timeout_sec ?? null,
      task.notify_on_complete === false || task.notify_on_complete === 0 ? 0 : 1,
      task.schedule_type,
      canonicalScheduleValue,
      canonicalNextRun,
      task.status,
      task.created_at,
      1,
    );
    createScheduledTaskAuthorityRecord(db, stored);
  }).immediate();
}

export function getTaskById(id: string): ScheduledTask | undefined {
  return getDb().prepare("SELECT * FROM scheduled_tasks WHERE id = ?").get(id) as ScheduledTask | undefined;
}

/** Update user-facing task data and fence configuration changes with a revision. */
export function updateTask(id: string, updates: TaskUpdate): void {
  if (Object.keys(updates).length === 0) return;
  const db = getDb();
  db.transaction(() => {
    const previous = db.prepare("SELECT * FROM scheduled_tasks WHERE id = ?").get(id) as ScheduledTask | undefined;
    if (!previous) return;

    const fields: string[] = [];
    const values: SqlBinding[] = [];
    const add = (column: string, value: SqlBinding) => { fields.push(`${column} = ?`); values.push(value); };
    if (updates.prompt !== undefined) add("prompt", updates.prompt);
    if (updates.model !== undefined) add("model", updates.model);
    if (updates.task_kind !== undefined) add("task_kind", updates.task_kind);
    if (updates.command !== undefined) add("command", updates.command);
    if (updates.cwd !== undefined) add("cwd", updates.cwd);
    if (updates.timeout_sec !== undefined) add("timeout_sec", updates.timeout_sec);
    if (updates.notify_on_complete !== undefined) add("notify_on_complete", updates.notify_on_complete === false || updates.notify_on_complete === 0 ? 0 : 1);
    if (updates.schedule_type !== undefined) add("schedule_type", updates.schedule_type);
    if (updates.schedule_value !== undefined) add("schedule_value", updates.schedule_value);
    if (updates.next_run !== undefined) add("next_run", updates.next_run);
    if (updates.status !== undefined) add("status", updates.status);

    const configurationChanged = CONFIG_FIELDS.some((field) =>
      updates[field] !== undefined && !equivalent(field, previous[field as keyof ScheduledTask], updates[field]),
    );
    if (configurationChanged) fields.push("revision = revision + 1");
    if (fields.length === 0) return;

    values.push(id);
    db.prepare(`UPDATE scheduled_tasks SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    const current = db.prepare("SELECT * FROM scheduled_tasks WHERE id = ?").get(id) as ScheduledTask;
    const now = new Date().toISOString();

    if (configurationChanged) {
      reviseScheduledTaskAuthorityRecord(db, current, now);
    } else if (updates.status !== undefined && updates.status !== previous.status) {
      const authorityNextRun = setScheduledTaskAuthorityStatus(db, id, updates.status, now);
      if (authorityNextRun !== undefined && authorityNextRun !== current.next_run) {
        db.prepare("UPDATE scheduled_tasks SET next_run=?,status=? WHERE id=?").run(
          authorityNextRun,
          authorityNextRun === null ? "completed" : updates.status,
          id,
        );
      }
    }
  }).immediate();
}

/** Tombstone durable authority before removing the user-facing task payload. */
export function deleteTask(id: string): void {
  const db = getDb();
  db.transaction(() => {
    deleteScheduledTaskAuthorityRecord(db, id, new Date().toISOString());
    db.prepare("DELETE FROM task_run_logs WHERE task_id = ?").run(id);
    db.prepare("DELETE FROM scheduled_tasks WHERE id = ?").run(id);
  }).immediate();
}

/** Legacy query retained for management/tests; production scheduling does not call it. */
export function getDueTasks(): ScheduledTask[] {
  const now = new Date().toISOString();
  return getDb().prepare(
    `SELECT * FROM scheduled_tasks
     WHERE status = 'active' AND next_run IS NOT NULL AND next_run <= ?
     ORDER BY next_run`,
  ).all(now) as ScheduledTask[];
}

/** Compatibility settlement for direct callers outside the durable scheduler path. */
export function updateTaskAfterRun(id: string, nextRun: string | null, lastResult: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(
      `UPDATE scheduled_tasks
       SET next_run = ?, last_run = ?, last_result = ?, status = CASE WHEN ? IS NULL THEN 'completed' ELSE status END
       WHERE id = ?`,
    ).run(nextRun, now, lastResult, nextRun, id);
    const status = nextRun === null ? "completed" : (getTaskById(id)?.status ?? "active");
    setScheduledTaskAuthorityStatus(db, id, status, now);
    db.query("UPDATE service_effect_s07_tasks SET next_run_at=?,updated_at=? WHERE task_id=? AND status<>'deleted'").run(nextRun, now, id);
  }).immediate();
}

/** Mirror an EF-S07 terminal decision into the legacy task projection. */
export function applyScheduledRunToTask(
  record: ScheduledRunRecord,
  lastResult: string,
): void {
  const db = getDb();
  const settledAt = record.settledAt || new Date().toISOString();
  db.transaction(() => {
    db.prepare("UPDATE scheduled_tasks SET last_run=?,last_result=? WHERE id=?").run(settledAt, lastResult, record.taskId);
    if (record.headDisposition === "advanced") {
      db.prepare(
        `UPDATE scheduled_tasks SET next_run=?,status=CASE WHEN ? IS NULL THEN 'completed' ELSE 'active' END
         WHERE id=? AND revision=?`,
      ).run(record.nextRunAt, record.nextRunAt, record.taskId, record.taskRevision);
    } else if (record.headDisposition === "paused") {
      db.prepare("UPDATE scheduled_tasks SET next_run=? WHERE id=? AND revision=? AND status='paused'").run(
        record.nextRunAt,
        record.taskId,
        record.taskRevision,
      );
    }
  }).immediate();
}

/** Record one execution and return a stable result reference for EF-S07. */
export function logTaskRun(log: TaskRunLog): number {
  const result = getDb().prepare(
    `INSERT INTO task_run_logs (task_id, run_at, duration_ms, status, result, error)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(log.task_id, log.run_at, log.duration_ms, log.status, log.result, log.error);
  return Number(result.lastInsertRowid);
}

export function getTaskRunLogs(taskId: string): TaskRunLog[] {
  return getDb().prepare("SELECT * FROM task_run_logs WHERE task_id = ? ORDER BY run_at").all(taskId) as TaskRunLog[];
}
