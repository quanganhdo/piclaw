import type Database from "bun:sqlite";

export function initializeFamilyTaskAdmission(database: Database): void {
  database.exec(`CREATE TABLE IF NOT EXISTS family_task_admissions (
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    request_id TEXT NOT NULL,
    grant_id TEXT NOT NULL UNIQUE REFERENCES family_scheduled_grants(id),
    input_hash TEXT NOT NULL CHECK(length(input_hash)=64),
    login_session_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(owner_user_id,request_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS family_scheduled_grants_owner_recent ON family_scheduled_grants(owner_user_id,created_at DESC,id DESC);
  CREATE TRIGGER IF NOT EXISTS family_task_admission_immutable BEFORE UPDATE ON family_task_admissions
    BEGIN SELECT RAISE(ABORT,'Task admission is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS family_task_admission_no_delete BEFORE DELETE ON family_task_admissions
    BEGIN SELECT RAISE(ABORT,'Task admission cannot be replayed'); END;`);
}
