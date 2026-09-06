import type Database from "bun:sqlite";

/** Additive foundation only: existing task rows acquire no implicit owner or grant. */
export function initializeFamilyScheduledGrants(database: Database): void {
  database.exec(`CREATE TABLE IF NOT EXISTS family_scheduled_grants (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL UNIQUE,
    task_revision INTEGER NOT NULL CHECK(task_revision=1),
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    initiated_by_user_id TEXT NOT NULL REFERENCES users(id),
    execution_service TEXT NOT NULL CHECK(execution_service='scheduler'),
    execution_kind TEXT NOT NULL CHECK(execution_kind='scheduled'),
    target_branch_id TEXT NOT NULL,
    root_branch_id TEXT NOT NULL,
    chat_jid TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    authority_hash TEXT NOT NULL,
    allowed_tools TEXT NOT NULL,
    login_session_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK(owner_user_id=initiated_by_user_id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS family_scheduled_grant_revocations (
    grant_id TEXT PRIMARY KEY REFERENCES family_scheduled_grants(id),
    actor_user_id TEXT,
    reason TEXT NOT NULL CHECK(reason IN ('owner_revoked','account_changed','task_changed','task_deleted')),
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_grant_immutable BEFORE UPDATE ON family_scheduled_grants
    BEGIN SELECT RAISE(ABORT,'Scheduled grant is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_grant_no_delete BEFORE DELETE ON family_scheduled_grants
    BEGIN SELECT RAISE(ABORT,'Scheduled grant history cannot be deleted'); END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_revocation_immutable BEFORE UPDATE ON family_scheduled_grant_revocations
    BEGIN SELECT RAISE(ABORT,'Scheduled grant revocation is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_revocation_no_delete BEFORE DELETE ON family_scheduled_grant_revocations
    BEGIN SELECT RAISE(ABORT,'Scheduled grant revocation cannot be deleted'); END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_account_revoked AFTER UPDATE OF enabled,role ON users
    WHEN NEW.enabled=0 OR NEW.role<>OLD.role
    BEGIN INSERT OR IGNORE INTO family_scheduled_grant_revocations(grant_id,actor_user_id,reason,created_at)
      SELECT id,NULL,'account_changed',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM family_scheduled_grants WHERE owner_user_id=OLD.id; END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_task_changed AFTER UPDATE ON scheduled_tasks
    WHEN NEW.revision<>OLD.revision OR NEW.id<>OLD.id OR NEW.chat_jid<>OLD.chat_jid OR NEW.prompt<>OLD.prompt
      OR NEW.model IS NOT OLD.model OR NEW.task_kind IS NOT OLD.task_kind OR NEW.command IS NOT OLD.command
      OR NEW.cwd IS NOT OLD.cwd OR NEW.timeout_sec IS NOT OLD.timeout_sec OR NEW.notify_on_complete IS NOT OLD.notify_on_complete
      OR NEW.schedule_type<>OLD.schedule_type OR NEW.schedule_value<>OLD.schedule_value OR NEW.created_at<>OLD.created_at
      OR NEW.status IS NOT OLD.status OR NEW.next_run IS NOT OLD.next_run OR NEW.last_run IS NOT OLD.last_run OR NEW.last_result IS NOT OLD.last_result
    BEGIN INSERT OR IGNORE INTO family_scheduled_grant_revocations(grant_id,actor_user_id,reason,created_at)
      SELECT id,NULL,'task_changed',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM family_scheduled_grants WHERE task_id=OLD.id; END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_task_deleted AFTER DELETE ON scheduled_tasks
    BEGIN INSERT OR IGNORE INTO family_scheduled_grant_revocations(grant_id,actor_user_id,reason,created_at)
      SELECT id,NULL,'task_deleted',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM family_scheduled_grants WHERE task_id=OLD.id; END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_task_no_activate BEFORE UPDATE OF status ON scheduled_tasks
    WHEN NEW.status='active' AND EXISTS(SELECT 1 FROM family_scheduled_grants WHERE task_id=OLD.id)
    BEGIN SELECT RAISE(ABORT,'Family scheduled dispatch is unavailable'); END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_head_no_activate BEFORE UPDATE OF status ON service_effect_s07_tasks
    WHEN NEW.status='active' AND EXISTS(SELECT 1 FROM family_scheduled_grants WHERE task_id=OLD.task_id)
    BEGIN SELECT RAISE(ABORT,'Family scheduled dispatch is unavailable'); END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_head_changed AFTER UPDATE ON service_effect_s07_tasks
    WHEN NEW.task_id<>OLD.task_id OR NEW.current_revision<>OLD.current_revision OR NEW.status<>OLD.status
      OR NEW.next_run_at IS NOT OLD.next_run_at
    BEGIN INSERT OR IGNORE INTO family_scheduled_grant_revocations(grant_id,actor_user_id,reason,created_at)
      SELECT id,NULL,CASE WHEN NEW.status='deleted' THEN 'task_deleted' ELSE 'task_changed' END,strftime('%Y-%m-%dT%H:%M:%fZ','now')
      FROM family_scheduled_grants WHERE task_id=OLD.task_id; END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_revision_inserted AFTER INSERT ON service_effect_s07_task_revisions
    BEGIN INSERT OR IGNORE INTO family_scheduled_grant_revocations(grant_id,actor_user_id,reason,created_at)
      SELECT id,NULL,'task_changed',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM family_scheduled_grants WHERE task_id=NEW.task_id; END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_revision_changed AFTER UPDATE ON service_effect_s07_task_revisions
    BEGIN INSERT OR IGNORE INTO family_scheduled_grant_revocations(grant_id,actor_user_id,reason,created_at)
      SELECT id,NULL,'task_changed',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM family_scheduled_grants WHERE task_id=OLD.task_id; END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_revision_deleted AFTER DELETE ON service_effect_s07_task_revisions
    BEGIN INSERT OR IGNORE INTO family_scheduled_grant_revocations(grant_id,actor_user_id,reason,created_at)
      SELECT id,NULL,'task_deleted',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM family_scheduled_grants WHERE task_id=OLD.task_id; END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_head_deleted AFTER DELETE ON service_effect_s07_tasks
    BEGIN INSERT OR IGNORE INTO family_scheduled_grant_revocations(grant_id,actor_user_id,reason,created_at)
      SELECT id,NULL,'task_deleted',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM family_scheduled_grants WHERE task_id=OLD.task_id; END;`);
}
