import type Database from "bun:sqlite";

/** One attempt per handoff; loss after admission cannot be silently replayed. */
export function initializeFamilyScheduledDispatch(database: Database): void {
  database.exec(`CREATE TABLE IF NOT EXISTS family_scheduled_dispatches (
    execution_id TEXT PRIMARY KEY REFERENCES family_scheduled_executions(id),
    started_at INTEGER NOT NULL
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_dispatch_immutable BEFORE UPDATE ON family_scheduled_dispatches
    BEGIN SELECT RAISE(ABORT,'Scheduled dispatch is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_dispatch_no_delete BEFORE DELETE ON family_scheduled_dispatches
    BEGIN SELECT RAISE(ABORT,'Scheduled dispatch cannot be replayed'); END;`);
}
