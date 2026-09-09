import type Database from "bun:sqlite";

/** Owner confirmation receipts; retries acknowledge history, never recreate execution authority. */
export function initializeFamilyExecutionAdmission(database: Database): void {
  database.exec(`CREATE TABLE IF NOT EXISTS family_execution_admissions (
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 1 AND 128),
    grant_id TEXT NOT NULL UNIQUE REFERENCES family_scheduled_grants(id),
    execution_id TEXT NOT NULL UNIQUE REFERENCES family_scheduled_executions(id),
    login_session_id TEXT NOT NULL CHECK(length(login_session_id) BETWEEN 1 AND 128),
    created_at INTEGER NOT NULL,
    PRIMARY KEY(owner_user_id,request_id)
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS family_execution_admission_valid BEFORE INSERT ON family_execution_admissions
    WHEN NOT EXISTS(SELECT 1 FROM family_scheduled_executions e
      JOIN family_scheduled_grants g ON g.id=e.grant_id AND g.owner_user_id=e.owner_user_id
      JOIN family_scheduled_occurrences o ON o.id=e.occurrence_id AND o.grant_id=g.id AND o.owner_user_id=e.owner_user_id
      JOIN family_scheduled_execution_events a ON a.execution_id=e.id AND a.kind='begin' AND a.created_at=e.created_at
      WHERE e.id=NEW.execution_id AND e.grant_id=NEW.grant_id AND e.owner_user_id=NEW.owner_user_id
        AND e.created_at=NEW.created_at AND o.state='consumed' AND o.worker_id='owner-request')
      OR NOT EXISTS(SELECT 1 FROM web_sessions s WHERE s.session_id=NEW.login_session_id AND s.user_id=NEW.owner_user_id)
    BEGIN SELECT RAISE(ABORT,'Execution admission conflicts with handoff'); END;
  CREATE TRIGGER IF NOT EXISTS family_execution_admission_immutable BEFORE UPDATE ON family_execution_admissions
    BEGIN SELECT RAISE(ABORT,'Execution admission is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS family_execution_admission_no_delete BEFORE DELETE ON family_execution_admissions
    BEGIN SELECT RAISE(ABORT,'Execution admission cannot be replayed'); END;`);
}
