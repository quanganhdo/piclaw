import type Database from "bun:sqlite";

export interface ScheduledTaskHead {
  taskId: string;
  revision: number;
  status: "active" | "paused" | "completed" | "deleted";
  nextRunAt: string | null;
}

export function readScheduledTaskHead(database: Database, taskId: string): ScheduledTaskHead | null {
  const row = database.query(`SELECT task_id,current_revision,status,next_run_at FROM main.service_effect_s07_tasks WHERE task_id=?`)
    .get(taskId) as { task_id: string; current_revision: number; status: ScheduledTaskHead["status"]; next_run_at: string | null } | null;
  return row ? { taskId: row.task_id, revision: row.current_revision, status: row.status, nextRunAt: row.next_run_at } : null;
}

/** The sole SQL writer for scheduling heads. The caller owns a synchronous
 * transaction containing definition/decision writes and compatibility projection. */
export function writeScheduledTaskHead(database: Database, previous: ScheduledTaskHead | null,
  next: ScheduledTaskHead, at: string, createdAt = at): boolean {
  if (previous && (next.taskId !== previous.taskId || next.revision < previous.revision)) throw Error("Scheduled task head identity mismatch");
  if (!previous) {
    return database.query(`INSERT INTO main.service_effect_s07_tasks(task_id,current_revision,status,next_run_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?)`).run(next.taskId, next.revision, next.status, next.nextRunAt, createdAt, at).changes === 1;
  }
  return database.query(`UPDATE main.service_effect_s07_tasks SET current_revision=?,status=?,next_run_at=?,updated_at=?
    WHERE task_id=? AND current_revision=? AND status=? AND next_run_at IS ?`)
    .run(next.revision, next.status, next.nextRunAt, at, previous.taskId, previous.revision, previous.status, previous.nextRunAt).changes === 1;
}
