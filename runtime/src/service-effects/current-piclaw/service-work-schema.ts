import type Database from "bun:sqlite";

const SCHEMA_PREFIX = "service_effect_s01_";

/**
 * Install the latent EF-S01 schema on an explicitly supplied isolated database.
 * The caller owns the connection. Production startup composes this schema with
 * EF-S07 in Piclaw's message store; isolated contract tests may use a fixture DB.
 * This setup-only installer may throw bounded or raw infrastructure exceptions;
 * callers must complete it before exposing a store at the effector boundary.
 */
export function installServiceWorkSchema(database: Database): void {
  database.exec("PRAGMA foreign_keys = ON");
  const foreignKeys = database.query("PRAGMA foreign_keys").get() as
    { foreign_keys?: number } | undefined;
  if (foreignKeys?.foreign_keys !== 1) {
    throw new Error("EF-S01 requires SQLite foreign-key enforcement.");
  }

  const install = () => database.exec(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA_PREFIX}chats (
      chat_jid TEXT PRIMARY KEY,
      next_source_seq INTEGER NOT NULL DEFAULT 1 CHECK(next_source_seq >= 1),
      consumed_through_source_seq INTEGER NOT NULL DEFAULT 0 CHECK(consumed_through_source_seq >= 0),
      active_operation_id TEXT,
      UNIQUE(chat_jid, active_operation_id),
      FOREIGN KEY(chat_jid, active_operation_id)
        REFERENCES ${SCHEMA_PREFIX}operations(chat_jid, operation_id)
        DEFERRABLE INITIALLY DEFERRED
    ) STRICT;

    CREATE TABLE IF NOT EXISTS ${SCHEMA_PREFIX}sources (
      chat_jid TEXT NOT NULL,
      source_seq INTEGER NOT NULL CHECK(source_seq >= 1),
      source_id TEXT NOT NULL,
      source_hash TEXT NOT NULL CHECK(length(source_hash) = 64 AND source_hash = lower(source_hash)),
      kind TEXT NOT NULL CHECK(kind IN ('message','steer','follow_up','continuation','control','cancellation','scheduled_agent','internal')),
      state TEXT NOT NULL CHECK(state IN ('pending','claimed','queued','consumed','disposed')),
      payload_ref TEXT NOT NULL,
      target_operation_id TEXT,
      parent_source_seq INTEGER,
      accepted_at TEXT NOT NULL,
      disposition_reason TEXT,
      provenance_ref TEXT NOT NULL,
      create_wake_intent INTEGER NOT NULL CHECK(create_wake_intent IN (0,1)),
      PRIMARY KEY(chat_jid, source_seq),
      UNIQUE(chat_jid, source_id),
      FOREIGN KEY(chat_jid) REFERENCES ${SCHEMA_PREFIX}chats(chat_jid),
      FOREIGN KEY(chat_jid, parent_source_seq)
        REFERENCES ${SCHEMA_PREFIX}sources(chat_jid, source_seq),
      FOREIGN KEY(chat_jid, target_operation_id)
        REFERENCES ${SCHEMA_PREFIX}operations(chat_jid, operation_id)
        DEFERRABLE INITIALLY DEFERRED
    ) STRICT;

    CREATE TABLE IF NOT EXISTS ${SCHEMA_PREFIX}operations (
      operation_id TEXT PRIMARY KEY,
      chat_jid TEXT NOT NULL,
      version INTEGER NOT NULL CHECK(version >= 1),
      phase TEXT NOT NULL CHECK(phase IN ('accepted','claimed','starting_harness','executing','suspended','cancelling','settling','terminal')),
      primary_source_seq INTEGER NOT NULL,
      cancellation_source_id TEXT,
      cancellation_source_seq INTEGER,
      cancellation_cause TEXT,
      cancellation_requested_at TEXT,
      harness_session_id TEXT,
      harness_lane TEXT,
      harness_operation_id TEXT,
      harness_state TEXT CHECK(harness_state IS NULL OR harness_state IN ('not_started','running','suspended','aborting','finished')),
      harness_watch_generation INTEGER CHECK(harness_watch_generation IS NULL OR harness_watch_generation >= 0),
      terminal_disposition TEXT CHECK(terminal_disposition IS NULL OR terminal_disposition IN ('completed','cancelled','failed','skipped','superseded')),
      terminal_message_row_id INTEGER,
      terminal_error_code TEXT,
      terminal_committed_at TEXT,
      UNIQUE(chat_jid, operation_id),
      FOREIGN KEY(chat_jid, primary_source_seq)
        REFERENCES ${SCHEMA_PREFIX}sources(chat_jid, source_seq)
    ) STRICT;

    CREATE UNIQUE INDEX IF NOT EXISTS ${SCHEMA_PREFIX}one_active_operation
      ON ${SCHEMA_PREFIX}operations(chat_jid) WHERE phase <> 'terminal';

    CREATE TABLE IF NOT EXISTS ${SCHEMA_PREFIX}operation_sources (
      chat_jid TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      source_seq INTEGER NOT NULL,
      PRIMARY KEY(operation_id, source_seq),
      UNIQUE(chat_jid, source_seq),
      FOREIGN KEY(chat_jid, operation_id)
        REFERENCES ${SCHEMA_PREFIX}operations(chat_jid, operation_id),
      FOREIGN KEY(chat_jid, source_seq)
        REFERENCES ${SCHEMA_PREFIX}sources(chat_jid, source_seq)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS ${SCHEMA_PREFIX}intents (
      operation_id TEXT NOT NULL,
      intent_id TEXT NOT NULL,
      intent_hash TEXT NOT NULL CHECK(length(intent_hash) = 64 AND intent_hash = lower(intent_hash)),
      kind TEXT NOT NULL CHECK(kind IN ('open_harness','prompt','queue_input','abort','resume','settle','maintenance')),
      payload_ref TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(operation_id, intent_id),
      FOREIGN KEY(operation_id) REFERENCES ${SCHEMA_PREFIX}operations(operation_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS ${SCHEMA_PREFIX}queued_inputs (
      chat_jid TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      source_seq INTEGER NOT NULL,
      queue_kind TEXT NOT NULL CHECK(queue_kind IN ('steer','follow_up','next_run')),
      harness_entry_id TEXT,
      state TEXT NOT NULL CHECK(state IN ('accepted','queued','consumed','disposed')),
      PRIMARY KEY(operation_id, source_seq),
      FOREIGN KEY(chat_jid, operation_id)
        REFERENCES ${SCHEMA_PREFIX}operations(chat_jid, operation_id),
      FOREIGN KEY(chat_jid, source_seq)
        REFERENCES ${SCHEMA_PREFIX}operation_sources(chat_jid, source_seq)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS ${SCHEMA_PREFIX}wake_intents (
      chat_jid TEXT NOT NULL,
      source_seq INTEGER NOT NULL,
      PRIMARY KEY(chat_jid, source_seq),
      FOREIGN KEY(chat_jid, source_seq)
        REFERENCES ${SCHEMA_PREFIX}sources(chat_jid, source_seq)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS ${SCHEMA_PREFIX}decisions (
      idempotency_key TEXT PRIMARY KEY,
      method TEXT NOT NULL,
      request_hash TEXT NOT NULL CHECK(length(request_hash) = 64 AND request_hash = lower(request_hash)),
      result_json TEXT NOT NULL CHECK(json_valid(result_json))
    ) STRICT;

    CREATE INDEX IF NOT EXISTS ${SCHEMA_PREFIX}pending_sources
      ON ${SCHEMA_PREFIX}sources(chat_jid, state, source_seq);
    CREATE INDEX IF NOT EXISTS ${SCHEMA_PREFIX}open_operations
      ON ${SCHEMA_PREFIX}operations(chat_jid, phase, operation_id);
  `);
  if (database.inTransaction) install();
  else database.transaction(install).immediate();
}
