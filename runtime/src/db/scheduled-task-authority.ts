import type Database from "bun:sqlite";
import type { ScheduledTask } from "../types.js";
import { decodeTaskSnapshot } from "../service-effects/current-piclaw/scheduled-run-values.js";
import { readScheduledTaskHead, writeScheduledTaskHead } from "./scheduled-task-head.js";
import { definitionBody, definitionRef, definitionSnapshot, initializeScheduledTaskDefinitions, insertScheduledDefinition,
  projectScheduledTask, visibleScheduledNextRun } from "./scheduled-task-definitions.js";

function authoredAt(task: ScheduledTask): string {
  return /^\d{4}-\d{2}-\d{2}T/.test(task.created_at) ? new Date(task.created_at).toISOString() : new Date().toISOString();
}
function insertVersion(database: Database, task: ScheduledTask, at: string) {
  const body = definitionBody(task);
  const snapshot = definitionSnapshot(body, definitionRef(body), process.env.TZ || "UTC",
    task.next_run || (task.schedule_type === "once" ? task.schedule_value : at), at);
  database.query(`INSERT INTO main.service_effect_s07_task_revisions(task_id,revision,config_hash,snapshot_json,authored_at) VALUES(?,?,?,?,?)`)
    .run(task.id, task.revision, snapshot.configHash, JSON.stringify(snapshot), at);
  insertScheduledDefinition(database, snapshot, body, "authored", at);
}

/** Each owner mutation commits definition/head/projection as one SQL frame. */
export function createScheduledTaskAuthorityRecord(database: Database, task: ScheduledTask): void {
  database.transaction(() => {
    if (database.query("SELECT 1 FROM main.scheduled_tasks WHERE id=?").get(task.id)
      || readScheduledTaskHead(database, task.id)) throw Error("Scheduled task identity already exists");
    const at = authoredAt(task);
    if (!writeScheduledTaskHead(database, null, { taskId: task.id, revision: task.revision, status: task.status,
      nextRunAt: task.status === "completed" ? null : task.next_run }, at)) throw Error("Scheduled task creation conflict");
    insertVersion(database, task, at);
    projectScheduledTask(database, task.id);
  }).immediate();
}

export function reviseScheduledTaskAuthorityRecord(database: Database, task: ScheduledTask, updatedAt: string): void {
  database.transaction(() => {
    const previous = readScheduledTaskHead(database, task.id);
    if (!previous || previous.status === "deleted" || previous.revision !== task.revision - 1) throw Error("Scheduled task authority revision mismatch");
    insertVersion(database, task, updatedAt);
    if (!writeScheduledTaskHead(database, previous, { taskId: task.id, revision: task.revision, status: task.status,
      nextRunAt: task.status === "completed" ? null : task.next_run }, updatedAt)) throw Error("Scheduled task authority revision mismatch");
    projectScheduledTask(database, task.id);
  }).immediate();
}

export function setScheduledTaskAuthorityStatus(database: Database, taskId: string,
  status: "active" | "paused" | "completed", updatedAt: string): string | null | undefined {
  return database.transaction(() => {
    const head = readScheduledTaskHead(database, taskId);
    if (!head || head.status === "deleted") return undefined;
    let nextRunAt = head.nextRunAt, nextStatus = status;
    if (status === "active" && head.status === "paused") {
      nextRunAt = visibleScheduledNextRun(database, taskId, head.revision, head.nextRunAt, true);
      if (nextRunAt === null) nextStatus = "completed";
    } else if (status === "completed") nextRunAt = null;
    if (!writeScheduledTaskHead(database, head, { ...head, status: nextStatus, nextRunAt }, updatedAt)) throw Error("Scheduled task status conflict");
    projectScheduledTask(database, taskId);
    return nextRunAt;
  }).immediate();
}

export function settleDirectScheduledTask(database: Database, taskId: string, nextRunAt: string | null,
  lastResult: string, at: string, expectedRevision?: number): void {
  database.transaction(() => {
    const head = readScheduledTaskHead(database, taskId);
    if (!head || head.status === "deleted" || (expectedRevision !== undefined && head.revision !== expectedRevision)) return;
    if (!writeScheduledTaskHead(database, head, { ...head, nextRunAt, status: nextRunAt === null ? "completed" : head.status }, at)) throw Error("Scheduled task direct settlement conflict");
    projectScheduledTask(database, taskId);
    // Retained unlinked/direct UI summary; never scheduling or payload authority.
    database.query("UPDATE main.scheduled_tasks SET last_run=?,last_result=? WHERE id=?").run(at, lastResult, taskId);
  }).immediate();
}

/** Explicit user deletion retires executable bodies and preserves S07 identities. */
export function deleteScheduledTaskAuthorityRecord(database: Database, taskId: string, updatedAt: string): void {
  database.transaction(() => {
    const head = readScheduledTaskHead(database, taskId);
    if (head && head.status !== "deleted" && !writeScheduledTaskHead(database, head, { ...head, status: "deleted", nextRunAt: null }, updatedAt)) throw Error("Scheduled task deletion conflict");
    database.query("UPDATE main.host_scheduled_task_definitions SET availability='retired',payload_json=NULL WHERE task_id=?").run(taskId);
    database.query("DELETE FROM main.task_run_logs WHERE task_id=?").run(taskId);
    database.query("DELETE FROM main.scheduled_tasks WHERE id=?").run(taskId);
  }).immediate();
}

/** Capture only the current legacy body at cutover. Old revision bodies were
 * never stored: retain their original snapshots/hashes and mark unavailable. */
export function migrateScheduledTaskAuthorities(database: Database): void {
  initializeScheduledTaskDefinitions(database, () => {
    const at = new Date().toISOString();
    const legacy = new Map((database.query("SELECT * FROM main.scheduled_tasks ORDER BY created_at,id").all() as ScheduledTask[])
      .map(task => {
        if (task.next_run) task.next_run = new Date(task.next_run).toISOString();
        if (task.schedule_type === "once") task.schedule_value = new Date(task.schedule_value).toISOString();
        return [task.id, task] as const;
      }));
    for (const task of legacy.values()) {
      if (readScheduledTaskHead(database, task.id)) continue;
      const stamp = authoredAt(task), body = definitionBody(task);
      const snapshot = definitionSnapshot(body, `scheduled_task:${task.id}:revision:${task.revision}`, process.env.TZ || "UTC",
        task.next_run || (task.schedule_type === "once" ? task.schedule_value : stamp), stamp);
      writeScheduledTaskHead(database, null, { taskId: task.id, revision: task.revision, status: task.status,
        nextRunAt: task.status === "completed" ? null : task.next_run }, stamp);
      database.query(`INSERT INTO main.service_effect_s07_task_revisions(task_id,revision,config_hash,snapshot_json,authored_at) VALUES(?,?,?,?,?)`)
        .run(task.id, task.revision, snapshot.configHash, JSON.stringify(snapshot), stamp);
    }
    const revisions = database.query("SELECT task_id,revision,config_hash,snapshot_json FROM main.service_effect_s07_task_revisions ORDER BY task_id,revision")
      .all() as { task_id: string; revision: number; config_hash: string; snapshot_json: string }[];
    for (const row of revisions) {
      const snapshot = decodeTaskSnapshot(JSON.parse(row.snapshot_json));
      if (!snapshot || snapshot.configHash !== row.config_hash || snapshot.taskId !== row.task_id || snapshot.revision !== row.revision) throw Error("Corrupt legacy scheduled snapshot");
      const head = readScheduledTaskHead(database, row.task_id), task = legacy.get(row.task_id);
      const current = head?.status !== "deleted" && head?.revision === row.revision && task?.revision === row.revision;
      insertScheduledDefinition(database, snapshot, current ? definitionBody(task!) : null, current ? "legacy_current" : "unknown", current ? at : null);
    }
    for (const task of legacy.values()) projectScheduledTask(database, task.id);
  });
}
