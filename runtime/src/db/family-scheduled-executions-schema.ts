import type Database from "bun:sqlite";

/** Durable handoff/result records, separate from active model execution and delivery. */
export function initializeFamilyScheduledExecutions(database: Database): void {
  database.exec(`CREATE TABLE IF NOT EXISTS family_scheduled_executions (
    id TEXT PRIMARY KEY,
    occurrence_id TEXT NOT NULL UNIQUE REFERENCES family_scheduled_occurrences(id),
    grant_id TEXT NOT NULL REFERENCES family_scheduled_grants(id),
    task_id TEXT NOT NULL,
    attempt INTEGER NOT NULL CHECK(attempt>=1),
    occurrence_version INTEGER NOT NULL CHECK(occurrence_version>=2),
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    initiated_by_user_id TEXT NOT NULL REFERENCES users(id),
    execution_service TEXT NOT NULL CHECK(execution_service='scheduler'),
    chat_jid TEXT NOT NULL,
    root_chat_jid TEXT NOT NULL,
    target_branch_id TEXT NOT NULL,
    root_branch_id TEXT NOT NULL,
    owner_username TEXT NOT NULL,
    owner_display_name TEXT NOT NULL,
    prompt_hash TEXT NOT NULL CHECK(length(prompt_hash)=64),
    allowed_tools TEXT NOT NULL,
    settlement_token_hash TEXT NOT NULL CHECK(length(settlement_token_hash)=64),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL CHECK(expires_at=created_at+900000),
    CHECK(owner_user_id=initiated_by_user_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS family_scheduled_executions_owner_recent ON family_scheduled_executions(owner_user_id,created_at DESC,id DESC);
  CREATE TABLE IF NOT EXISTS family_scheduled_results (
    execution_id TEXT PRIMARY KEY REFERENCES family_scheduled_executions(id),
    status TEXT NOT NULL CHECK(status IN ('success','error')),
    text TEXT NOT NULL CHECK(length(CAST(text AS BLOB))<=102400),
    payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
    created_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS family_scheduled_execution_events (
    execution_id TEXT NOT NULL REFERENCES family_scheduled_executions(id),
    kind TEXT NOT NULL CHECK(kind IN ('begin','settle')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY(execution_id,kind)
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_execution_immutable BEFORE UPDATE ON family_scheduled_executions
    BEGIN SELECT RAISE(ABORT,'Scheduled execution is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_execution_no_delete BEFORE DELETE ON family_scheduled_executions
    BEGIN SELECT RAISE(ABORT,'Scheduled execution history cannot be deleted'); END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_result_immutable BEFORE UPDATE ON family_scheduled_results
    BEGIN SELECT RAISE(ABORT,'Scheduled result is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_result_no_delete BEFORE DELETE ON family_scheduled_results
    BEGIN SELECT RAISE(ABORT,'Scheduled result history cannot be deleted'); END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_execution_event_immutable BEFORE UPDATE ON family_scheduled_execution_events
    BEGIN SELECT RAISE(ABORT,'Scheduled execution event is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_execution_event_no_delete BEFORE DELETE ON family_scheduled_execution_events
    BEGIN SELECT RAISE(ABORT,'Scheduled execution event cannot be deleted'); END;`);
}
