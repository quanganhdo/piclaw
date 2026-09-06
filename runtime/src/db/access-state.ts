import type { Database } from "bun:sqlite";

import { readAccessConfig, type AccessMode } from "../core/config-access.js";
import { initializeUserSchema } from "./users.js";

export interface AccessState {
  activatedMode: AccessMode;
  schemaVersion: number;
}

/** Additive foundation only. No multi-user activation writer is exposed. */
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
        activated_mode TEXT NOT NULL CHECK (activated_mode IN ('single-user', 'family-shared', 'isolated-containers')),
        schema_version INTEGER NOT NULL CHECK (schema_version >= 1)
      ) STRICT;
      INSERT OR IGNORE INTO access_state (id, activated_mode, schema_version) VALUES (1, 'single-user', 1);
    `);
    initializeUserSchema(database, legacyDisplayName);
  }).immediate();
}

export function readAccessState(database: Database): AccessState {
  if (database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='access_migration_preparation'").get()) {
    throw new Error('Prepared migration copy cannot start. Ownership preparation is incomplete; restore the untouched source or use a future integrated migration release.');
  }
  const row = database.query("SELECT activated_mode, schema_version FROM access_state WHERE id = 1").get() as
    { activated_mode: AccessMode; schema_version: number } | null;
  if (!row || !["single-user", "family-shared", "isolated-containers"].includes(row.activated_mode) || row.schema_version !== 1) {
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
  if (config.mode !== "single-user") {
    throw new Error(`Access mode ${config.mode} is unavailable until its integrated multi-user release gate passes. Existing multi-user data must be opened with a compatible release.`);
  }
  const admin = database.query("SELECT 1 FROM users WHERE role = 'admin' AND enabled = 1 LIMIT 1").get();
  if (!admin) throw new Error("Access state has no enabled administrator; restore a compatible backup.");
  return { configuredMode: config.mode, effectiveMode: "single-user", modeExplicit: config.modeExplicit };
}

export interface AccessMigrationPreview {
  roots: Array<{ chatJid: string; proposedOwnerUserId: string | null; archived: boolean }>;
  branches: Array<{ chatJid: string; rootChatJid: string; parentBranchId: string | null; archived: boolean }>;
  unmappedChats: string[];
  quarantined: Array<{ chatJid: string; reason: string }>;
  resources: Record<string, number>;
}

/** Read-only inventory. Preview is not permission to activate or to assign ownership. */
export function previewAccessMigration(database: Database): AccessMigrationPreview {
  type Branch = { branch_id: string; chat_jid: string; root_chat_jid: string; parent_branch_id: string | null; archived_at: string | null };
  const branches = database.query("SELECT branch_id, chat_jid, root_chat_jid, parent_branch_id, archived_at FROM chat_branches ORDER BY chat_jid").all() as Branch[];
  const byId = new Map(branches.map(row => [row.branch_id, row]));
  const byChat = new Map(branches.map(row => [row.chat_jid, row]));
  const quarantined: AccessMigrationPreview["quarantined"] = [];
  for (const row of branches) {
    const seen = new Set<string>();
    let current: Branch | undefined = row;
    let reason = "";
    while (current) {
      if (seen.has(current.branch_id)) { reason = "parent cycle"; break; }
      seen.add(current.branch_id);
      if (current.root_chat_jid !== row.root_chat_jid) { reason = "cross-root parent"; break; }
      if (!current.parent_branch_id) {
        if (current.chat_jid !== row.root_chat_jid) reason = "missing root chain";
        break;
      }
      current = byId.get(current.parent_branch_id);
      if (!current) reason = "orphan parent";
    }
    if (reason) quarantined.push({ chatJid: row.chat_jid, reason });
  }
  const chats = database.query("SELECT jid FROM chats ORDER BY jid").all() as Array<{ jid: string }>;
  const unmappedChats = chats.filter(row => !byChat.has(row.jid)).map(row => row.jid);
  for (const chatJid of unmappedChats) quarantined.push({ chatJid, reason: "chat has no branch registry entry" });
  const chatIds = new Set(chats.map(chat => chat.jid));
  for (const row of branches) {
    if (!chatIds.has(row.chat_jid)) quarantined.push({ chatJid: row.chat_jid, reason: "branch has no chat record" });
  }
  const roots = branches.filter(row => row.chat_jid === row.root_chat_jid && !row.parent_branch_id).map(row => ({
    chatJid: row.chat_jid,
    proposedOwnerUserId: row.chat_jid.startsWith("web:") ? "default" : null,
    archived: Boolean(row.archived_at),
  }));
  for (const root of roots) {
    if (root.proposedOwnerUserId === null) quarantined.push({ chatJid: root.chatJid, reason: "non-web root requires explicit service/channel mapping" });
  }
  const resources: Record<string, number> = {};
  // Closed table allowlist: counts expose no contents and tolerate older fixtures.
  const tables = new Set((database.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(row => row.name));
  for (const table of ["messages", "media", "message_media", "scheduled_tasks", "task_run_logs", "chat_cursors", "tool_outputs", "web_sessions", "webauthn_credentials", "webauthn_enrollments", "extension_kv"]) {
    resources[table] = tables.has(table) ? Number((database.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n) : 0;
  }
  return {
    roots,
    branches: branches.map(row => ({ chatJid: row.chat_jid, rootChatJid: row.root_chat_jid, parentBranchId: row.parent_branch_id, archived: Boolean(row.archived_at) })),
    unmappedChats,
    quarantined,
    resources,
  };
}
