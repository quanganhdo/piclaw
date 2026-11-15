import type { Database } from "bun:sqlite";

import { readAccessConfig, type AccessMode } from "../core/config-access.js";
import { initializeUserSchema } from "./users.js";

export interface AccessState {
  activatedMode: AccessMode;
  schemaVersion: number;
}

/** Initialise the access marker for a fresh single-user store. */
export function initializeAccessSchema(database: Database, legacyDisplayName = "User"): void {
  database.transaction(() => {
    const hasState = database.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'access_state'").get();
    const hasUsers = database.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
    if (hasState) {
      readAccessState(database);
      if (!hasUsers) throw new Error("Access state exists without users; restore a compatible backup.");
      return; // Never recreate a default administrator in an already-initialised store.
    }
    if (hasUsers) throw new Error("Users exist without access activation state; refusing to recreate a single-user marker.");
    database.exec(`
      CREATE TABLE IF NOT EXISTS access_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        activated_mode TEXT NOT NULL CHECK (activated_mode IN ('single-user', 'isolated-containers')),
        schema_version INTEGER NOT NULL CHECK (schema_version >= 1)
      ) STRICT;
      INSERT OR IGNORE INTO access_state (id, activated_mode, schema_version) VALUES (1, 'single-user', 1);
    `);
    initializeUserSchema(database, legacyDisplayName);
  }).immediate();
}

export function readAccessState(database: Database): AccessState {
  if (database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='access_migration_preparation'").get()) {
    throw new Error('Prepared migration copy cannot start. Keep the untouched source and promote an eligible reviewed version-five copy into a separate database.');
  }
  const row = database.query("SELECT activated_mode, schema_version FROM access_state WHERE id = 1").get() as
    { activated_mode: AccessMode; schema_version: number } | null;
  if (!row || !["single-user", "isolated-containers"].includes(row.activated_mode) || row.schema_version !== 1) {
    throw new Error("Access activation state is missing or unsupported; restore a compatible backup before starting.");
  }
  return { activatedMode: row.activated_mode, schemaVersion: row.schema_version };
}

/** Called before listeners, workers, model sessions or add-on execution can start. */
export function validateAccessStartup(database: Database, configPath?: string): { configuredMode: AccessMode; effectiveMode: "single-user"; modeExplicit: boolean } {
  const config = readAccessConfig(configPath);
  const state = readAccessState(database);
  if (state.activatedMode !== config.mode) {
    throw new Error(`Access mode mismatch: store=${state.activatedMode}, config=${config.mode}. Mode transitions require explicit reviewed migration; no automatic downgrade is allowed.`);
  }
  if (config.mode === "isolated-containers") {
    throw new Error("Access mode isolated-containers is unavailable until its separate integrated release gate passes.");
  }
  const admin = database.query("SELECT 1 FROM users WHERE role = 'admin' AND enabled = 1 LIMIT 1").get();
  if (!admin) throw new Error("Access state has no enabled administrator; restore a compatible backup.");
  return { configuredMode: config.mode, effectiveMode: "single-user", modeExplicit: config.modeExplicit };
}
