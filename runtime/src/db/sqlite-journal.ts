import { performance } from "node:perf_hooks";
import type { Database } from "bun:sqlite";

const WAIT_MS = 5000;
const waitCell = new Int32Array(new SharedArrayBuffer(4));

/**
 * WAL transitions can report SQLITE_BUSY without invoking SQLite's busy
 * handler. Retry only that idempotent transition, within the normal startup
 * lock-wait budget. Never accept a different returned journal mode.
 */
export function enableSqliteWal(database: Database): void {
  const previous = (database.query("PRAGMA busy_timeout").get() as { timeout: number }).timeout;
  database.exec("PRAGMA busy_timeout = 0;");
  const deadline = performance.now() + WAIT_MS;
  try {
    for (;;) {
      try {
        const row = database.query("PRAGMA journal_mode = WAL;").get() as { journal_mode?: string } | undefined;
        if (row?.journal_mode?.toLowerCase() !== "wal") throw new Error("SQLite did not enable WAL journal mode.");
        return;
      } catch (error) {
        if ((error as { code?: string })?.code !== "SQLITE_BUSY" || performance.now() >= deadline) throw error;
        Atomics.wait(waitCell, 0, 0, Math.min(10, Math.max(0, deadline - performance.now())));
      }
    }
  } finally {
    database.exec(`PRAGMA busy_timeout = ${previous};`);
  }
}
