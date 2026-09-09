import type Database from "bun:sqlite";

/** Terminal metadata for an admitted dispatcher which could not settle. No failure text or token. */
export function initializeFamilyScheduledInterruptions(database: Database): void {
  database.exec(`CREATE TABLE IF NOT EXISTS family_scheduled_interruptions (
    execution_id TEXT PRIMARY KEY REFERENCES family_scheduled_executions(id),
    started_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL CHECK(created_at>=started_at)
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_interruption_valid BEFORE INSERT ON family_scheduled_interruptions
    WHEN NOT EXISTS(SELECT 1 FROM family_scheduled_executions e
      JOIN family_scheduled_dispatches d ON d.execution_id=e.id
      JOIN family_scheduled_execution_events a ON a.execution_id=e.id AND a.kind='begin' AND a.created_at=e.created_at
      WHERE e.id=NEW.execution_id AND d.started_at=NEW.started_at AND d.started_at>=e.created_at AND d.started_at<e.expires_at)
      OR EXISTS(SELECT 1 FROM family_scheduled_results WHERE execution_id=NEW.execution_id)
      OR EXISTS(SELECT 1 FROM family_scheduled_expiries WHERE execution_id=NEW.execution_id)
      OR EXISTS(SELECT 1 FROM family_scheduled_execution_events WHERE execution_id=NEW.execution_id AND kind='settle')
    BEGIN SELECT RAISE(ABORT,'Scheduled interruption conflicts with execution history'); END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_interruption_immutable BEFORE UPDATE ON family_scheduled_interruptions
    BEGIN SELECT RAISE(ABORT,'Scheduled interruption is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_interruption_no_delete BEFORE DELETE ON family_scheduled_interruptions
    BEGIN SELECT RAISE(ABORT,'Scheduled interruption cannot be deleted'); END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_result_not_interrupted BEFORE INSERT ON family_scheduled_results
    WHEN EXISTS(SELECT 1 FROM family_scheduled_interruptions WHERE execution_id=NEW.execution_id)
    BEGIN SELECT RAISE(ABORT,'Scheduled execution is terminal'); END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_expiry_not_interrupted BEFORE INSERT ON family_scheduled_expiries
    WHEN EXISTS(SELECT 1 FROM family_scheduled_interruptions WHERE execution_id=NEW.execution_id)
    BEGIN SELECT RAISE(ABORT,'Scheduled execution is terminal'); END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_settle_event_not_interrupted BEFORE INSERT ON family_scheduled_execution_events
    WHEN NEW.kind='settle' AND EXISTS(SELECT 1 FROM family_scheduled_interruptions WHERE execution_id=NEW.execution_id)
    BEGIN SELECT RAISE(ABORT,'Scheduled execution is terminal'); END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_dispatch_not_interrupted BEFORE INSERT ON family_scheduled_dispatches
    WHEN EXISTS(SELECT 1 FROM family_scheduled_interruptions WHERE execution_id=NEW.execution_id)
    BEGIN SELECT RAISE(ABORT,'Scheduled execution is terminal'); END;`);
}
