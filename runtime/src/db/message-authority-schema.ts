import type Database from "bun:sqlite";

/** Server-owned admission record; never populated by generic message or browser metadata. */
export function initializeMessageAuthoritySchema(database: Database): void {
  database.exec(`CREATE TABLE IF NOT EXISTS migration_input_holds (
    message_rowid INTEGER PRIMARY KEY, message_id TEXT NOT NULL, chat_jid TEXT NOT NULL,
    owner_user_id TEXT NOT NULL REFERENCES users(id), message_timestamp TEXT NOT NULL,
    content_hash TEXT NOT NULL, source_snapshot TEXT NOT NULL, created_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS migration_input_dismissals (
    id INTEGER PRIMARY KEY, message_rowid INTEGER NOT NULL UNIQUE REFERENCES migration_input_holds(message_rowid),
    owner_user_id TEXT NOT NULL REFERENCES users(id), login_session_id TEXT NOT NULL, request_id TEXT NOT NULL,
    created_at TEXT NOT NULL, UNIQUE(owner_user_id,request_id)
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS migration_input_hold_immutable BEFORE UPDATE ON migration_input_holds
    BEGIN SELECT RAISE(ABORT,'Migration input hold is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS migration_input_dismissal_immutable BEFORE UPDATE ON migration_input_dismissals
    BEGIN SELECT RAISE(ABORT,'Migration input dismissal is immutable'); END;
  CREATE TABLE IF NOT EXISTS message_execution_authorities (
    message_rowid INTEGER PRIMARY KEY,
    message_id TEXT NOT NULL,
    chat_jid TEXT NOT NULL,
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    actor_user_id TEXT NOT NULL REFERENCES users(id),
    login_session_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    thread_id INTEGER,
    created_at TEXT NOT NULL,
    UNIQUE(owner_user_id, request_id)
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS message_execution_authority_immutable
    BEFORE UPDATE ON message_execution_authorities
    BEGIN SELECT RAISE(ABORT, 'Message execution authority is immutable'); END;
  CREATE TABLE IF NOT EXISTS family_turn_queue (
    message_rowid INTEGER PRIMARY KEY REFERENCES message_execution_authorities(message_rowid),
    message_id TEXT NOT NULL,
    chat_jid TEXT NOT NULL,
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    admission_mode TEXT NOT NULL CHECK(admission_mode IN ('send','queue','queue_all','steer','auto')),
    queue_position INTEGER NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('held','ready','dispatching','completed','removed','skipped','steered')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0
  ) STRICT;
  CREATE INDEX IF NOT EXISTS idx_family_turn_queue_chat_state_position
    ON family_turn_queue(chat_jid,state,queue_position,message_rowid);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_family_turn_queue_one_ready
    ON family_turn_queue(chat_jid) WHERE state='ready';
  CREATE TRIGGER IF NOT EXISTS family_turn_queue_identity_immutable
    BEFORE UPDATE OF message_rowid,message_id,chat_jid,owner_user_id,admission_mode,created_at ON family_turn_queue
    WHEN NEW.message_rowid != OLD.message_rowid OR NEW.message_id != OLD.message_id
      OR NEW.chat_jid != OLD.chat_jid OR NEW.owner_user_id != OLD.owner_user_id
      OR NEW.admission_mode != OLD.admission_mode OR NEW.created_at != OLD.created_at
    BEGIN SELECT RAISE(ABORT, 'Family turn queue identity is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS family_turn_queue_terminal_immutable
    BEFORE UPDATE ON family_turn_queue
    WHEN OLD.state IN ('completed','removed','skipped','steered')
    BEGIN SELECT RAISE(ABORT, 'Family turn queue terminal state is immutable'); END;
  CREATE TABLE IF NOT EXISTS message_recovery_authorities (
    id INTEGER PRIMARY KEY,
    message_rowid INTEGER NOT NULL REFERENCES message_execution_authorities(message_rowid),
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    login_session_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('retry','skip')),
    failure_created_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(owner_user_id,request_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS idx_message_recovery_latest ON message_recovery_authorities(message_rowid,id);
  CREATE TRIGGER IF NOT EXISTS message_recovery_authority_immutable
    BEFORE UPDATE ON message_recovery_authorities
    BEGIN SELECT RAISE(ABORT, 'Message recovery authority is immutable'); END;`);
}
