import type Database from "bun:sqlite";

import { installServiceOutboxSchema } from "./service-outbox-schema.js";
import { installServiceWorkSchema } from "./service-work-schema.js";

const PREFIX = "service_effect_s07_";
const HASH = "length(%s)=64 AND %s=lower(%s) AND %s NOT GLOB '*[^0-9a-f]*'";
const INSTANT = "length(%s)=24 AND substr(%s,11,1)='T' AND substr(%s,24,1)='Z'";

function constraint(template: string, column: string): string {
  return template.replaceAll("%s", column);
}

export type ScheduledRunInstallBoundary =
  | "service_work"
  | "service_outbox"
  | "s07_tasks"
  | "s07_revisions"
  | "s07_occurrences"
  | "s07_history"
  | "s07_decisions"
  | "s07_indexes";

export interface ScheduledRunInstallObserver {
  afterBoundary(boundary: ScheduledRunInstallBoundary): void;
}

/** Install EF-S07 tables on an explicitly supplied database connection. */
export function installScheduledRunSchema(database: Database): void {
  database.exec("PRAGMA foreign_keys = ON");
  const foreignKeys = database.query("PRAGMA foreign_keys").get() as
    | { foreign_keys?: number }
    | undefined;
  if (foreignKeys?.foreign_keys !== 1) {
    throw new Error("EF-S07 requires SQLite foreign-key enforcement.");
  }

  const hash = (column: string) => constraint(HASH, column);
  const instant = (column: string) => constraint(INSTANT, column);
  const install = () => database.exec(`
    CREATE TABLE IF NOT EXISTS ${PREFIX}tasks (
      task_id TEXT PRIMARY KEY CHECK(length(task_id) BETWEEN 1 AND 512),
      current_revision INTEGER NOT NULL CHECK(current_revision BETWEEN 1 AND 9007199254740991),
      status TEXT NOT NULL CHECK(status IN ('active','paused','completed','deleted')),
      next_run_at TEXT CHECK(next_run_at IS NULL OR ${instant("next_run_at")}),
      created_at TEXT NOT NULL CHECK(${instant("created_at")}),
      updated_at TEXT NOT NULL CHECK(${instant("updated_at")})
    ) STRICT;

    CREATE TABLE IF NOT EXISTS ${PREFIX}task_revisions (
      task_id TEXT NOT NULL CHECK(length(task_id) BETWEEN 1 AND 512),
      revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
      config_hash TEXT NOT NULL CHECK(${hash("config_hash")}),
      snapshot_json TEXT NOT NULL CHECK(length(snapshot_json) BETWEEN 2 AND 65536 AND json_valid(snapshot_json)),
      authored_at TEXT NOT NULL CHECK(${instant("authored_at")}),
      PRIMARY KEY(task_id,revision),
      UNIQUE(task_id,config_hash),
      FOREIGN KEY(task_id) REFERENCES ${PREFIX}tasks(task_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS ${PREFIX}occurrences (
      run_id TEXT PRIMARY KEY CHECK(length(run_id)=78 AND run_id GLOB 'scheduled_run:[0-9a-f]*' AND substr(run_id,15) NOT GLOB '*[^0-9a-f]*'),
      task_id TEXT NOT NULL CHECK(length(task_id) BETWEEN 1 AND 512),
      task_revision INTEGER NOT NULL CHECK(task_revision BETWEEN 1 AND 9007199254740991),
      scheduled_for TEXT NOT NULL CHECK(${instant("scheduled_for")}),
      state TEXT NOT NULL CHECK(state IN ('claimed','source_bound','completed','abandoned')),
      attempt INTEGER NOT NULL CHECK(attempt BETWEEN 1 AND 9007199254740991),
      worker_id TEXT CHECK(worker_id IS NULL OR length(worker_id) BETWEEN 1 AND 512),
      lease_token_hash TEXT CHECK(lease_token_hash IS NULL OR ${hash("lease_token_hash")}),
      claimed_at TEXT NOT NULL CHECK(${instant("claimed_at")}),
      lease_expires_at TEXT CHECK(lease_expires_at IS NULL OR ${instant("lease_expires_at")}),
      accepted_source_seq INTEGER CHECK(accepted_source_seq IS NULL OR accepted_source_seq BETWEEN 1 AND 9007199254740991),
      operation_id TEXT CHECK(operation_id IS NULL OR length(operation_id) BETWEEN 1 AND 512),
      result_status TEXT CHECK(result_status IS NULL OR result_status IN ('success','error')),
      duration_ms INTEGER CHECK(duration_ms IS NULL OR duration_ms BETWEEN 0 AND 9007199254740991),
      result_ref TEXT CHECK(result_ref IS NULL OR length(result_ref) BETWEEN 1 AND 2048),
      error_code TEXT CHECK(error_code IS NULL OR (length(error_code) BETWEEN 1 AND 128 AND error_code NOT GLOB '*[^A-Za-z0-9_.:-]*')),
      next_run_at TEXT CHECK(next_run_at IS NULL OR ${instant("next_run_at")}),
      head_disposition TEXT NOT NULL CHECK(head_disposition IN ('pending','advanced','paused','deleted','superseded')),
      settled_at TEXT CHECK(settled_at IS NULL OR ${instant("settled_at")}),
      abandonment_reason_tag TEXT CHECK(abandonment_reason_tag IS NULL OR (length(abandonment_reason_tag) BETWEEN 1 AND 128 AND abandonment_reason_tag NOT GLOB '*[^A-Za-z0-9_.:-]*')),
      retained INTEGER NOT NULL DEFAULT 0 CHECK(retained=0),
      UNIQUE(task_id,task_revision,scheduled_for),
      FOREIGN KEY(task_id,task_revision) REFERENCES ${PREFIX}task_revisions(task_id,revision),
      CHECK(
        (state IN ('claimed','source_bound') AND worker_id IS NOT NULL AND lease_token_hash IS NOT NULL AND lease_expires_at IS NOT NULL AND claimed_at < lease_expires_at AND result_status IS NULL AND duration_ms IS NULL AND result_ref IS NULL AND error_code IS NULL AND next_run_at IS NULL AND head_disposition='pending' AND settled_at IS NULL AND abandonment_reason_tag IS NULL)
        OR
        (state='completed' AND worker_id IS NULL AND lease_token_hash IS NULL AND lease_expires_at IS NULL AND result_status IS NOT NULL AND duration_ms IS NOT NULL AND settled_at IS NOT NULL AND abandonment_reason_tag IS NULL AND head_disposition<>'pending' AND ((result_status='success' AND result_ref IS NOT NULL AND error_code IS NULL) OR (result_status='error' AND result_ref IS NULL AND error_code IS NOT NULL)))
        OR
        (state='abandoned' AND worker_id IS NULL AND lease_token_hash IS NULL AND lease_expires_at IS NULL AND result_status IS NULL AND duration_ms IS NULL AND result_ref IS NULL AND error_code IS NULL AND settled_at IS NOT NULL AND abandonment_reason_tag IS NOT NULL AND head_disposition<>'pending')
      ),
      CHECK((accepted_source_seq IS NULL AND operation_id IS NULL) OR (accepted_source_seq IS NOT NULL AND operation_id IS NOT NULL)),
      CHECK(state<>'source_bound' OR accepted_source_seq IS NOT NULL)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS ${PREFIX}leases (
      run_id TEXT NOT NULL,
      attempt INTEGER NOT NULL CHECK(attempt BETWEEN 1 AND 9007199254740991),
      token_hash TEXT NOT NULL UNIQUE CHECK(${hash("token_hash")}),
      worker_id TEXT NOT NULL CHECK(length(worker_id) BETWEEN 1 AND 512),
      claimed_at TEXT NOT NULL CHECK(${instant("claimed_at")}),
      lease_expires_at TEXT NOT NULL CHECK(${instant("lease_expires_at")} AND claimed_at < lease_expires_at),
      authority_kind TEXT NOT NULL CHECK(authority_kind IN ('new','agent_reconciled_absent','repeatable','reconciled_absent')),
      reconciliation_ref TEXT CHECK(reconciliation_ref IS NULL OR length(reconciliation_ref) BETWEEN 1 AND 2048),
      PRIMARY KEY(run_id,attempt),
      FOREIGN KEY(run_id) REFERENCES ${PREFIX}occurrences(run_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS ${PREFIX}lease_renewals (
      run_id TEXT NOT NULL,
      attempt INTEGER NOT NULL CHECK(attempt BETWEEN 1 AND 9007199254740991),
      ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 1 AND 9007199254740991),
      request_hash TEXT NOT NULL CHECK(${hash("request_hash")}),
      previous_expires_at TEXT NOT NULL CHECK(${instant("previous_expires_at")}),
      lease_expires_at TEXT NOT NULL CHECK(${instant("lease_expires_at")} AND lease_expires_at > previous_expires_at),
      renewed_at TEXT NOT NULL CHECK(${instant("renewed_at")} AND renewed_at < lease_expires_at),
      PRIMARY KEY(run_id,attempt,ordinal),
      FOREIGN KEY(run_id,attempt) REFERENCES ${PREFIX}leases(run_id,attempt)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS ${PREFIX}source_bindings (
      run_id TEXT PRIMARY KEY,
      request_hash TEXT NOT NULL CHECK(${hash("request_hash")}),
      idempotency_key TEXT NOT NULL UNIQUE CHECK(length(idempotency_key) BETWEEN 1 AND 512),
      chat_jid TEXT NOT NULL CHECK(length(chat_jid) BETWEEN 1 AND 512),
      source_seq INTEGER NOT NULL CHECK(source_seq BETWEEN 1 AND 9007199254740991),
      operation_id TEXT NOT NULL CHECK(length(operation_id) BETWEEN 1 AND 512),
      bound_at TEXT NOT NULL CHECK(${instant("bound_at")}),
      FOREIGN KEY(run_id) REFERENCES ${PREFIX}occurrences(run_id),
      FOREIGN KEY(chat_jid,source_seq) REFERENCES service_effect_s01_sources(chat_jid,source_seq),
      FOREIGN KEY(chat_jid,operation_id) REFERENCES service_effect_s01_operations(chat_jid,operation_id),
      FOREIGN KEY(operation_id,source_seq) REFERENCES service_effect_s01_operation_sources(operation_id,source_seq)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS ${PREFIX}run_logs (
      run_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      task_revision INTEGER NOT NULL CHECK(task_revision BETWEEN 1 AND 9007199254740991),
      scheduled_for TEXT NOT NULL CHECK(${instant("scheduled_for")}),
      task_kind TEXT NOT NULL CHECK(task_kind IN ('agent','shell','internal')),
      completed_at TEXT NOT NULL CHECK(${instant("completed_at")}),
      duration_ms INTEGER NOT NULL CHECK(duration_ms BETWEEN 0 AND 9007199254740991),
      status TEXT NOT NULL CHECK(status IN ('success','error')),
      result_ref TEXT CHECK(result_ref IS NULL OR length(result_ref) BETWEEN 1 AND 2048),
      error_code TEXT CHECK(error_code IS NULL OR (length(error_code) BETWEEN 1 AND 128 AND error_code NOT GLOB '*[^A-Za-z0-9_.:-]*')),
      FOREIGN KEY(run_id) REFERENCES ${PREFIX}occurrences(run_id),
      FOREIGN KEY(task_id,task_revision) REFERENCES ${PREFIX}task_revisions(task_id,revision)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS ${PREFIX}next_decisions (
      run_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      task_revision INTEGER NOT NULL CHECK(task_revision BETWEEN 1 AND 9007199254740991),
      scheduled_for TEXT NOT NULL CHECK(${instant("scheduled_for")}),
      computed_next_run_at TEXT CHECK(computed_next_run_at IS NULL OR ${instant("computed_next_run_at")}),
      effective_next_run_at TEXT CHECK(effective_next_run_at IS NULL OR ${instant("effective_next_run_at")}),
      head_disposition TEXT NOT NULL CHECK(head_disposition IN ('advanced','paused','deleted','superseded')),
      decided_at TEXT NOT NULL CHECK(${instant("decided_at")}),
      decision_hash TEXT NOT NULL CHECK(${hash("decision_hash")}),
      FOREIGN KEY(run_id) REFERENCES ${PREFIX}occurrences(run_id),
      FOREIGN KEY(task_id,task_revision) REFERENCES ${PREFIX}task_revisions(task_id,revision)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS ${PREFIX}abandonments (
      run_id TEXT PRIMARY KEY,
      request_hash TEXT NOT NULL CHECK(${hash("request_hash")}),
      reason_tag TEXT NOT NULL CHECK(length(reason_tag) BETWEEN 1 AND 128 AND reason_tag NOT GLOB '*[^A-Za-z0-9_.:-]*'),
      abandoned_at TEXT NOT NULL CHECK(${instant("abandoned_at")}),
      retry_at TEXT CHECK(retry_at IS NULL OR (${instant("retry_at")} AND retry_at > abandoned_at)),
      FOREIGN KEY(run_id) REFERENCES ${PREFIX}occurrences(run_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS ${PREFIX}outbox_links (
      run_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 99),
      outbox_id TEXT NOT NULL UNIQUE CHECK(length(outbox_id) BETWEEN 1 AND 512),
      PRIMARY KEY(run_id,ordinal),
      FOREIGN KEY(run_id) REFERENCES ${PREFIX}occurrences(run_id),
      FOREIGN KEY(outbox_id) REFERENCES service_effect_s05_outbox(outbox_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS ${PREFIX}decisions (
      decision_key TEXT PRIMARY KEY CHECK(length(decision_key) BETWEEN 1 AND 1200),
      method TEXT NOT NULL CHECK(method IN ('claimDue','renew','bindAcceptedSource','complete','abandon','cleanupTerminal')),
      request_hash TEXT NOT NULL CHECK(${hash("request_hash")}),
      run_id TEXT,
      result_json TEXT NOT NULL CHECK(length(result_json) BETWEEN 2 AND 65536 AND json_valid(result_json)),
      decided_at TEXT NOT NULL CHECK(${instant("decided_at")})
    ) STRICT;

    CREATE TABLE IF NOT EXISTS ${PREFIX}tombstones (
      run_id TEXT PRIMARY KEY CHECK(length(run_id)=78 AND run_id GLOB 'scheduled_run:[0-9a-f]*' AND substr(run_id,15) NOT GLOB '*[^0-9a-f]*'),
      task_id TEXT NOT NULL CHECK(length(task_id) BETWEEN 1 AND 512),
      task_revision INTEGER NOT NULL CHECK(task_revision BETWEEN 1 AND 9007199254740991),
      scheduled_for TEXT NOT NULL CHECK(${instant("scheduled_for")}),
      state TEXT NOT NULL CHECK(state IN ('completed','abandoned')),
      attempt INTEGER NOT NULL CHECK(attempt BETWEEN 1 AND 9007199254740991),
      status TEXT CHECK(status IS NULL OR status IN ('success','error')),
      next_run_at TEXT CHECK(next_run_at IS NULL OR ${instant("next_run_at")}),
      head_disposition TEXT NOT NULL CHECK(head_disposition IN ('advanced','paused','deleted','superseded')),
      settled_at TEXT NOT NULL CHECK(${instant("settled_at")}),
      decision_method TEXT NOT NULL CHECK(decision_method IN ('complete','abandon')),
      decision_hash TEXT NOT NULL CHECK(${hash("decision_hash")}),
      UNIQUE(task_id,task_revision,scheduled_for),
      CHECK((state='completed' AND decision_method='complete') OR (state='abandoned' AND decision_method='abandon'))
    ) STRICT;

    CREATE INDEX IF NOT EXISTS ${PREFIX}due_tasks
      ON ${PREFIX}tasks(next_run_at,task_id) WHERE status='active' AND next_run_at IS NOT NULL;
    CREATE INDEX IF NOT EXISTS ${PREFIX}expired_occurrences
      ON ${PREFIX}occurrences(lease_expires_at,scheduled_for,task_id) WHERE state IN ('claimed','source_bound');
    CREATE INDEX IF NOT EXISTS ${PREFIX}task_history
      ON ${PREFIX}occurrences(task_id,scheduled_for,run_id);
    CREATE INDEX IF NOT EXISTS ${PREFIX}terminal_retention
      ON ${PREFIX}occurrences(settled_at,run_id) WHERE state IN ('completed','abandoned');
    CREATE INDEX IF NOT EXISTS ${PREFIX}decision_run
      ON ${PREFIX}decisions(run_id,decision_key);
  `);

  if (database.inTransaction) install();
  else database.transaction(install).immediate();
}

/**
 * Install the complete S01 + S05 + S07 composition atomically on a
 * caller-owned database. Production startup uses this before task migration.
 */
export function installScheduledRunCompositionSchema(
  database: Database,
  observer?: ScheduledRunInstallObserver,
): void {
  database.exec("PRAGMA foreign_keys = ON");
  const foreignKeys = database.query("PRAGMA foreign_keys").get() as
    | { foreign_keys?: number }
    | undefined;
  if (foreignKeys?.foreign_keys !== 1) {
    throw new Error("EF-S07 composition requires SQLite foreign keys.");
  }
  const boundary = (value: ScheduledRunInstallBoundary) => observer?.afterBoundary(value);
  const install = () => {
    installServiceWorkSchema(database);
    boundary("service_work");
    installServiceOutboxSchema(database);
    boundary("service_outbox");
    installScheduledRunSchema(database);
    boundary("s07_tasks");
    boundary("s07_revisions");
    boundary("s07_occurrences");
    boundary("s07_history");
    boundary("s07_decisions");
    boundary("s07_indexes");
  };
  if (database.inTransaction) install();
  else database.transaction(install).immediate();
}
