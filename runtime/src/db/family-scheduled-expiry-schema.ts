import type Database from "bun:sqlite";

/** Additive terminal metadata only. Initialisation never expires or replays work. */
export function initializeFamilyScheduledExpiry(database: Database): void {
  database.exec(`CREATE TABLE IF NOT EXISTS family_scheduled_expiries (
    execution_id TEXT PRIMARY KEY REFERENCES family_scheduled_executions(id),
    created_at INTEGER NOT NULL CHECK(created_at>=0)
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_expiry_valid BEFORE INSERT ON family_scheduled_expiries
    WHEN NOT EXISTS(SELECT 1 FROM family_scheduled_executions e
      JOIN family_scheduled_execution_events a ON a.execution_id=e.id AND a.kind='begin' AND a.created_at=e.created_at
      WHERE e.id=NEW.execution_id AND e.expires_at<=NEW.created_at)
      OR EXISTS(SELECT 1 FROM family_scheduled_results WHERE execution_id=NEW.execution_id)
    BEGIN SELECT RAISE(ABORT,'Scheduled expiry conflicts with execution history'); END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_expiry_immutable BEFORE UPDATE ON family_scheduled_expiries
    BEGIN SELECT RAISE(ABORT,'Scheduled expiry is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_expiry_no_delete BEFORE DELETE ON family_scheduled_expiries
    BEGIN SELECT RAISE(ABORT,'Scheduled expiry cannot be deleted'); END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_result_not_expired BEFORE INSERT ON family_scheduled_results
    WHEN EXISTS(SELECT 1 FROM family_scheduled_expiries WHERE execution_id=NEW.execution_id)
    BEGIN SELECT RAISE(ABORT,'Scheduled execution is terminal'); END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_dispatch_not_expired BEFORE INSERT ON family_scheduled_dispatches
    WHEN EXISTS(SELECT 1 FROM family_scheduled_expiries WHERE execution_id=NEW.execution_id)
    BEGIN SELECT RAISE(ABORT,'Scheduled execution is terminal'); END;`);
}
