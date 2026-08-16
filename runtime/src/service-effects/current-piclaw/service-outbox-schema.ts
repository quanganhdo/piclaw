import type Database from "bun:sqlite";

const PREFIX = "service_effect_s05_";
const HASH = "length(%s)=64 AND %s=lower(%s) AND %s NOT GLOB '*[^0-9a-f]*'";
const INSTANT = "length(%s)=24 AND substr(%s,11,1)='T' AND substr(%s,24,1)='Z'";

function constraint(template: string, column: string): string {
  return template.replaceAll("%s", column);
}

/** Install the latent EF-S05 schema on an explicitly supplied isolated database. */
export function installServiceOutboxSchema(database: Database): void {
  database.exec("PRAGMA foreign_keys = ON");
  const foreignKeys = database.query("PRAGMA foreign_keys").get() as
    | { foreign_keys?: number }
    | undefined;
  if (foreignKeys?.foreign_keys !== 1) {
    throw new Error("EF-S05 requires SQLite foreign-key enforcement.");
  }

  const hash = (column: string) => constraint(HASH, column);
  const instant = (column: string) => constraint(INSTANT, column);
  const install = () => database.exec(`
    CREATE TABLE IF NOT EXISTS ${PREFIX}outbox (
      outbox_id TEXT PRIMARY KEY CHECK(length(outbox_id) BETWEEN 1 AND 512),
      kind TEXT NOT NULL CHECK(kind IN ('wake_chat','timeline_broadcast','channel_delivery','notification','scheduler_run_log','maintenance')),
      state TEXT NOT NULL CHECK(state IN ('pending','started','completed','failed','unknown','cancelled')),
      idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 512),
      request_hash TEXT NOT NULL CHECK(${hash("request_hash")}),
      operation_id TEXT CHECK(operation_id IS NULL OR length(operation_id) BETWEEN 1 AND 512),
      source_seq INTEGER CHECK(source_seq IS NULL OR source_seq BETWEEN 0 AND 9007199254740991),
      provenance_ref TEXT NOT NULL CHECK(length(provenance_ref) BETWEEN 1 AND 2048),
      redaction_class TEXT NOT NULL CHECK(redaction_class IN ('public','private','secret')),
      payload_ref TEXT NOT NULL CHECK(length(payload_ref) BETWEEN 1 AND 2048),
      destination_ref TEXT CHECK(destination_ref IS NULL OR length(destination_ref) BETWEEN 1 AND 2048),
      available_at TEXT NOT NULL CHECK(${instant("available_at")}),
      enqueued_at TEXT NOT NULL CHECK(${instant("enqueued_at")}),
      state_changed_at TEXT NOT NULL CHECK(${instant("state_changed_at")}),
      repeatability TEXT NOT NULL CHECK(repeatability IN ('repeatable','reconciliation_required')),
      attempt INTEGER NOT NULL DEFAULT 0 CHECK(attempt BETWEEN 0 AND 9007199254740991),
      worker_id TEXT CHECK(worker_id IS NULL OR length(worker_id) BETWEEN 1 AND 512),
      claimed_at TEXT CHECK(claimed_at IS NULL OR ${instant("claimed_at")}),
      lease_token TEXT CHECK(lease_token IS NULL OR length(lease_token) BETWEEN 1 AND 2048),
      lease_expires_at TEXT CHECK(lease_expires_at IS NULL OR ${instant("lease_expires_at")}),
      certainty TEXT CHECK(certainty IS NULL OR certainty IN ('not_applied','applied','unknown')),
      retry_at TEXT CHECK(retry_at IS NULL OR ${instant("retry_at")}),
      receipt_ref TEXT CHECK(receipt_ref IS NULL OR length(receipt_ref) BETWEEN 1 AND 2048),
      last_error_tag TEXT CHECK(last_error_tag IS NULL OR (length(last_error_tag) BETWEEN 1 AND 128 AND last_error_tag NOT GLOB '*[^A-Za-z0-9_.:-]*')),
      result_at TEXT CHECK(result_at IS NULL OR ${instant("result_at")}),
      reconciliation_ref TEXT CHECK(reconciliation_ref IS NULL OR length(reconciliation_ref) BETWEEN 1 AND 2048),
      reconciled_at TEXT CHECK(reconciled_at IS NULL OR ${instant("reconciled_at")}),
      cancellation_reason_tag TEXT CHECK(cancellation_reason_tag IS NULL OR (length(cancellation_reason_tag) BETWEEN 1 AND 128 AND cancellation_reason_tag NOT GLOB '*[^A-Za-z0-9_.:-]*')),
      UNIQUE(kind,idempotency_key),
      CHECK(available_at >= enqueued_at),
      CHECK(
        (state='pending' AND certainty='not_applied' AND attempt=0 AND worker_id IS NULL AND claimed_at IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL AND retry_at IS NULL AND receipt_ref IS NULL AND last_error_tag IS NULL AND result_at IS NULL AND reconciliation_ref IS NULL AND reconciled_at IS NULL AND cancellation_reason_tag IS NULL)
        OR (state='started' AND certainty IS NULL AND attempt>=1 AND worker_id IS NOT NULL AND claimed_at IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND claimed_at < lease_expires_at AND state_changed_at=claimed_at AND retry_at IS NULL AND receipt_ref IS NULL AND last_error_tag IS NULL AND result_at IS NULL AND reconciled_at IS NULL AND cancellation_reason_tag IS NULL)
        OR (state='completed' AND certainty='applied' AND attempt>=1 AND worker_id IS NULL AND claimed_at IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL AND retry_at IS NULL AND last_error_tag IS NULL AND result_at IS NOT NULL AND state_changed_at=result_at AND cancellation_reason_tag IS NULL)
        OR (state='failed' AND certainty='not_applied' AND attempt>=1 AND worker_id IS NULL AND claimed_at IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL AND receipt_ref IS NULL AND last_error_tag IS NOT NULL AND result_at IS NOT NULL AND state_changed_at=result_at AND (retry_at IS NULL OR retry_at > result_at) AND cancellation_reason_tag IS NULL)
        OR (state='unknown' AND certainty='unknown' AND attempt>=1 AND worker_id IS NULL AND claimed_at IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL AND retry_at IS NULL AND receipt_ref IS NULL AND last_error_tag IS NOT NULL AND result_at IS NOT NULL AND state_changed_at=result_at AND reconciliation_ref IS NULL AND reconciled_at IS NULL AND cancellation_reason_tag IS NULL)
        OR (state='cancelled' AND certainty='not_applied' AND attempt>=1 AND worker_id IS NULL AND claimed_at IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL AND retry_at IS NULL AND receipt_ref IS NULL AND last_error_tag IS NULL AND result_at IS NOT NULL AND state_changed_at=result_at AND reconciliation_ref IS NOT NULL AND reconciled_at=result_at AND cancellation_reason_tag IS NOT NULL)
      )
    ) STRICT;

    CREATE TABLE IF NOT EXISTS ${PREFIX}leases (
      token_hash TEXT PRIMARY KEY CHECK(${hash("token_hash")}),
      request_hash TEXT NOT NULL CHECK(${hash("request_hash")}),
      method TEXT NOT NULL CHECK(method IN ('claimNext','reclaim')),
      outbox_id TEXT NOT NULL CHECK(length(outbox_id) BETWEEN 1 AND 512),
      attempt INTEGER NOT NULL CHECK(attempt BETWEEN 1 AND 9007199254740991),
      worker_id TEXT NOT NULL CHECK(length(worker_id) BETWEEN 1 AND 512),
      claimed_at TEXT NOT NULL CHECK(${instant("claimed_at")}),
      lease_expires_at TEXT NOT NULL CHECK(${instant("lease_expires_at")} AND claimed_at < lease_expires_at),
      reconciliation_ref TEXT CHECK(reconciliation_ref IS NULL OR length(reconciliation_ref) BETWEEN 1 AND 2048)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS ${PREFIX}outcomes (
      outbox_id TEXT NOT NULL,
      attempt INTEGER NOT NULL CHECK(attempt BETWEEN 1 AND 9007199254740991),
      method TEXT NOT NULL CHECK(method IN ('complete','fail','markUnknown')),
      request_hash TEXT NOT NULL CHECK(${hash("request_hash")}),
      state TEXT NOT NULL CHECK(state IN ('completed','failed','unknown')),
      certainty TEXT NOT NULL CHECK(certainty IN ('applied','not_applied','unknown')),
      result_at TEXT NOT NULL CHECK(${instant("result_at")}),
      receipt_ref TEXT CHECK(receipt_ref IS NULL OR length(receipt_ref) BETWEEN 1 AND 2048),
      error_tag TEXT CHECK(error_tag IS NULL OR (length(error_tag) BETWEEN 1 AND 128 AND error_tag NOT GLOB '*[^A-Za-z0-9_.:-]*')),
      retry_at TEXT CHECK(retry_at IS NULL OR (${instant("retry_at")} AND retry_at > result_at)),
      reconciliation_ref TEXT CHECK(reconciliation_ref IS NULL OR length(reconciliation_ref) BETWEEN 1 AND 2048),
      PRIMARY KEY(outbox_id,attempt),
      CHECK((state='completed' AND certainty='applied' AND error_tag IS NULL AND retry_at IS NULL) OR (state='failed' AND certainty='not_applied' AND receipt_ref IS NULL AND error_tag IS NOT NULL) OR (state='unknown' AND certainty='unknown' AND receipt_ref IS NULL AND error_tag IS NOT NULL AND retry_at IS NULL))
    ) STRICT;

    CREATE TABLE IF NOT EXISTS ${PREFIX}resolutions (
      outbox_id TEXT NOT NULL,
      attempt INTEGER NOT NULL CHECK(attempt BETWEEN 1 AND 9007199254740991),
      request_hash TEXT NOT NULL CHECK(${hash("request_hash")}),
      state TEXT NOT NULL CHECK(state IN ('completed','failed','cancelled')),
      certainty TEXT NOT NULL CHECK(certainty IN ('applied','not_applied')),
      reconciled_at TEXT NOT NULL CHECK(${instant("reconciled_at")}),
      reconciliation_ref TEXT NOT NULL CHECK(length(reconciliation_ref) BETWEEN 1 AND 2048),
      receipt_ref TEXT CHECK(receipt_ref IS NULL OR length(receipt_ref) BETWEEN 1 AND 2048),
      error_tag TEXT CHECK(error_tag IS NULL OR (length(error_tag) BETWEEN 1 AND 128 AND error_tag NOT GLOB '*[^A-Za-z0-9_.:-]*')),
      retry_at TEXT CHECK(retry_at IS NULL OR (${instant("retry_at")} AND retry_at > reconciled_at)),
      cancellation_reason_tag TEXT CHECK(cancellation_reason_tag IS NULL OR (length(cancellation_reason_tag) BETWEEN 1 AND 128 AND cancellation_reason_tag NOT GLOB '*[^A-Za-z0-9_.:-]*')),
      PRIMARY KEY(outbox_id,attempt),
      CHECK((state='completed' AND certainty='applied' AND error_tag IS NULL AND retry_at IS NULL AND cancellation_reason_tag IS NULL) OR (state='failed' AND certainty='not_applied' AND receipt_ref IS NULL AND error_tag IS NOT NULL AND cancellation_reason_tag IS NULL) OR (state='cancelled' AND certainty='not_applied' AND receipt_ref IS NULL AND error_tag IS NULL AND retry_at IS NULL AND cancellation_reason_tag IS NOT NULL))
    ) STRICT;

    CREATE TABLE IF NOT EXISTS ${PREFIX}decisions (
      decision_key TEXT PRIMARY KEY CHECK(length(decision_key) BETWEEN 1 AND 1200),
      method TEXT NOT NULL CHECK(method IN ('enqueue','claimNext','reclaim','complete','fail','markUnknown','resolveUnknown','cleanupTerminal')),
      request_hash TEXT NOT NULL CHECK(${hash("request_hash")}),
      outcome TEXT NOT NULL CHECK(outcome IN ('applied','stale','empty')),
      outbox_id TEXT CHECK(outbox_id IS NULL OR length(outbox_id) BETWEEN 1 AND 512),
      attempt INTEGER CHECK(attempt IS NULL OR attempt BETWEEN 0 AND 9007199254740991),
      lease_token_hash TEXT CHECK(lease_token_hash IS NULL OR ${hash("lease_token_hash")}),
      result_json TEXT CHECK(result_json IS NULL OR (length(result_json) BETWEEN 2 AND 65536 AND json_valid(result_json))),
      CHECK((method='cleanupTerminal' AND outbox_id IS NULL AND result_json IS NOT NULL) OR (method<>'cleanupTerminal' AND result_json IS NULL)),
      CHECK((method='cleanupTerminal' AND outbox_id IS NULL) OR (method='claimNext' AND (outcome='empty' OR outbox_id IS NOT NULL)) OR (method NOT IN ('cleanupTerminal','claimNext') AND outbox_id IS NOT NULL)),
      CHECK((outcome='empty' AND method='claimNext' AND outbox_id IS NULL) OR outcome<>'empty')
    ) STRICT;

    CREATE INDEX IF NOT EXISTS ${PREFIX}pending_claim ON ${PREFIX}outbox(available_at,outbox_id) WHERE state='pending';
    CREATE INDEX IF NOT EXISTS ${PREFIX}failed_claim ON ${PREFIX}outbox(retry_at,outbox_id) WHERE state='failed' AND retry_at IS NOT NULL;
    CREATE INDEX IF NOT EXISTS ${PREFIX}expired_started ON ${PREFIX}outbox(lease_expires_at,outbox_id) WHERE state='started';
    CREATE INDEX IF NOT EXISTS ${PREFIX}unknown_list ON ${PREFIX}outbox(state_changed_at,outbox_id) WHERE state='unknown';
    CREATE INDEX IF NOT EXISTS ${PREFIX}terminal_cleanup ON ${PREFIX}outbox(state_changed_at,outbox_id) WHERE state='cancelled' OR (state='failed' AND retry_at IS NULL);
    CREATE INDEX IF NOT EXISTS ${PREFIX}operation_lookup ON ${PREFIX}outbox(operation_id,outbox_id);
    CREATE INDEX IF NOT EXISTS ${PREFIX}decision_outbox ON ${PREFIX}decisions(outbox_id);
    CREATE INDEX IF NOT EXISTS ${PREFIX}lease_outbox ON ${PREFIX}leases(outbox_id,attempt);
  `);
  if (database.inTransaction) install();
  else database.transaction(install).immediate();
}
