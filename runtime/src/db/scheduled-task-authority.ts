import type Database from "bun:sqlite";

import type { ScheduledTask } from "../types.js";
import type { ScheduledTaskAuthorityInput, ScheduledTaskSnapshot } from "../service-effects/contracts/scheduled-run-store.js";
import {
  makeTaskSnapshot,
  normaliseTaskAuthorityInput,
} from "../service-effects/current-piclaw/scheduled-run-values.js";

const TASKS = "service_effect_s07_tasks";
const REVISIONS = "service_effect_s07_task_revisions";

function taskKind(task: ScheduledTask): "agent" | "shell" | "internal" {
  if (task.task_kind === "internal") return "internal";
  if (task.task_kind === "shell" || task.command) return "shell";
  return "agent";
}

function taskAuthorityInput(task: ScheduledTask): ScheduledTaskAuthorityInput | null {
  const kind = taskKind(task);
  const authoredAt = /^\d{4}-\d{2}-\d{2}T/.test(task.created_at)
    ? new Date(task.created_at).toISOString()
    : new Date().toISOString();
  const onceAt = task.schedule_type === "once" ? new Date(task.schedule_value).toISOString() : null;
  const authorityNextRun = task.next_run ? new Date(task.next_run).toISOString() : (onceAt || authoredAt);
  const candidate: ScheduledTaskAuthorityInput = {
    taskId: task.id,
    chatJid: task.chat_jid,
    kind,
    payloadRef: `scheduled_task:${task.id}:revision:${task.revision}`,
    modelLabel: task.model || null,
    scheduleType: task.schedule_type,
    scheduleValue: onceAt || task.schedule_value,
    timezone: process.env.TZ || "UTC",
    notifyOnComplete: task.notify_on_complete !== false && task.notify_on_complete !== 0,
    muted: task.notify_on_complete === false || task.notify_on_complete === 0,
    cwd: kind === "shell" ? task.cwd || null : null,
    timeoutSec: kind === "shell" ? task.timeout_sec || null : null,
    internalTask: kind === "internal"
      ? { discriminator: "piclaw_internal", reference: `scheduled_task:${task.id}` }
      : null,
    redactionClass: "private",
    executionRepeatability: kind === "agent" ? "agent_source" : "repeatable",
    nextRunAt: authorityNextRun,
    authoredAt,
  };
  return normaliseTaskAuthorityInput(candidate);
}

function insertRevision(database: Database, task: ScheduledTask): ScheduledTaskSnapshot {
  const input = taskAuthorityInput(task);
  if (!input) throw new Error(`Scheduled task ${task.id} cannot be represented by EF-S07.`);
  const snapshot = makeTaskSnapshot(input, task.revision);
  database.query(
    `INSERT INTO ${REVISIONS}(task_id,revision,config_hash,snapshot_json,authored_at)
     VALUES(?,?,?,?,?)`,
  ).run(task.id, task.revision, snapshot.configHash, JSON.stringify(snapshot), input.authoredAt);
  return snapshot;
}

export function createScheduledTaskAuthorityRecord(database: Database, task: ScheduledTask): void {
  const input = taskAuthorityInput(task);
  if (!input) throw new Error(`Scheduled task ${task.id} cannot be represented by EF-S07.`);
  const status = task.status === "paused" ? "paused" : task.status === "completed" ? "completed" : "active";
  database.query(
    `INSERT INTO ${TASKS}(task_id,current_revision,status,next_run_at,created_at,updated_at)
     VALUES(?,?,?,?,?,?)`,
  ).run(task.id, task.revision, status, status === "completed" ? null : task.next_run, input.authoredAt, input.authoredAt);
  insertRevision(database, task);
}

export function reviseScheduledTaskAuthorityRecord(database: Database, task: ScheduledTask, updatedAt: string): void {
  insertRevision(database, task);
  const status = task.status === "paused" ? "paused" : task.status === "completed" ? "completed" : "active";
  const changed = database.query(
    `UPDATE ${TASKS}
     SET current_revision=?,status=?,next_run_at=?,updated_at=?
     WHERE task_id=? AND current_revision<? AND status<>'deleted'`,
  ).run(task.revision, status, status === "completed" ? null : task.next_run, updatedAt, task.id, task.revision);
  if (changed.changes !== 1) throw new Error(`Scheduled task ${task.id} authority revision mismatch.`);
}

export function setScheduledTaskAuthorityStatus(
  database: Database,
  taskId: string,
  status: "active" | "paused" | "completed",
  updatedAt: string,
): string | null | undefined {
  const head = database.query(
    `SELECT current_revision,status,next_run_at FROM ${TASKS} WHERE task_id=?`,
  ).get(taskId) as { current_revision: number; status: string; next_run_at: string | null } | undefined;
  if (!head || head.status === "deleted") return undefined;

  let nextRunAt = head.next_run_at;
  let nextStatus: "active" | "paused" | "completed" = status;
  if (status === "active" && head.status === "paused") {
    const held = database.query(
      `SELECT computed_next_run_at FROM service_effect_s07_next_decisions
       WHERE task_id=? AND task_revision=? AND head_disposition='paused'
       ORDER BY scheduled_for DESC LIMIT 1`,
    ).get(taskId, head.current_revision) as { computed_next_run_at: string | null } | undefined;
    if (held) nextRunAt = held.computed_next_run_at;
    if (nextRunAt === null) nextStatus = "completed";
  } else if (status === "completed") {
    nextRunAt = null;
  }

  database.query(
    `UPDATE ${TASKS} SET status=?,next_run_at=?,updated_at=? WHERE task_id=? AND status<>'deleted'`,
  ).run(nextStatus, nextRunAt, updatedAt, taskId);
  return nextRunAt;
}

export function deleteScheduledTaskAuthorityRecord(database: Database, taskId: string, updatedAt: string): void {
  database.query(
    `UPDATE ${TASKS} SET status='deleted',next_run_at=NULL,updated_at=? WHERE task_id=? AND status<>'deleted'`,
  ).run(updatedAt, taskId);
}

export function migrateScheduledTaskAuthorities(database: Database): void {
  const tasks = database.query("SELECT * FROM scheduled_tasks ORDER BY created_at,id").all() as ScheduledTask[];
  const insert = database.transaction(() => {
    for (const task of tasks) {
      if (task.next_run) task.next_run = new Date(task.next_run).toISOString();
      if (task.schedule_type === "once") task.schedule_value = new Date(task.schedule_value).toISOString();
      database.query("UPDATE scheduled_tasks SET next_run=?,schedule_value=? WHERE id=?").run(task.next_run, task.schedule_value, task.id);
      const known = database.query(`SELECT task_id FROM ${TASKS} WHERE task_id=?`).get(task.id);
      if (!known) createScheduledTaskAuthorityRecord(database, task);
    }
  });
  insert.immediate();
}
