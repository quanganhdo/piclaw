import type Database from "bun:sqlite";

/** Permanent owner revocation of one handoff, never proof that external work stopped. */
export function initializeFamilyScheduledCancellations(database: Database): void {
  database.exec(`CREATE TABLE IF NOT EXISTS family_scheduled_cancellations (
    execution_id TEXT PRIMARY KEY REFERENCES family_scheduled_executions(id),
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    login_session_id TEXT NOT NULL CHECK(length(login_session_id) BETWEEN 1 AND 128),
    created_at INTEGER NOT NULL
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_cancellation_valid BEFORE INSERT ON family_scheduled_cancellations
    WHEN NOT EXISTS(SELECT 1 FROM family_scheduled_executions e
      JOIN family_scheduled_execution_events a ON a.execution_id=e.id AND a.kind='begin' AND a.created_at=e.created_at
      WHERE e.id=NEW.execution_id AND e.owner_user_id=NEW.owner_user_id AND NEW.created_at>=e.created_at AND NEW.created_at<e.expires_at)
      OR EXISTS(SELECT 1 FROM family_scheduled_results WHERE execution_id=NEW.execution_id)
      OR EXISTS(SELECT 1 FROM family_scheduled_expiries WHERE execution_id=NEW.execution_id)
      OR EXISTS(SELECT 1 FROM family_scheduled_interruptions WHERE execution_id=NEW.execution_id)
      OR EXISTS(SELECT 1 FROM family_scheduled_execution_events WHERE execution_id=NEW.execution_id AND kind='settle')
    BEGIN SELECT RAISE(ABORT,'Scheduled cancellation conflicts with execution history'); END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_cancellation_immutable BEFORE UPDATE ON family_scheduled_cancellations
    BEGIN SELECT RAISE(ABORT,'Scheduled cancellation is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_cancellation_no_delete BEFORE DELETE ON family_scheduled_cancellations
    BEGIN SELECT RAISE(ABORT,'Scheduled cancellation cannot be deleted'); END;`);
  for(const table of ['results','expiries','interruptions','dispatches']) {
    database.exec(`CREATE TRIGGER IF NOT EXISTS family_scheduled_${table}_not_cancelled BEFORE INSERT ON family_scheduled_${table}
      WHEN EXISTS(SELECT 1 FROM family_scheduled_cancellations WHERE execution_id=NEW.execution_id)
      BEGIN SELECT RAISE(ABORT,'Scheduled execution is cancelled'); END;`);
  }
  database.exec(`CREATE TRIGGER IF NOT EXISTS family_scheduled_settle_event_not_cancelled BEFORE INSERT ON family_scheduled_execution_events
    WHEN NEW.kind='settle' AND EXISTS(SELECT 1 FROM family_scheduled_cancellations WHERE execution_id=NEW.execution_id)
    BEGIN SELECT RAISE(ABORT,'Scheduled execution is cancelled'); END;`);
}
