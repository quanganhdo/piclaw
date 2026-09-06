import type Database from "bun:sqlite";
import type { AuthenticatedPrincipal } from "../core/access-types.js";
import { ChatAccessDenied, getRootOwnership, resolveAuthorisedChat } from "./session-ownership.js";

export interface OwnedSessionHandle {
  branch_id: string;
  chat_jid: string;
  root_chat_jid: string;
  parent_branch_id: string | null;
  agent_name: string;
  archived_at: string | null;
}

/** Add the namespace before creating indexes, including when reopening migrated stores. */
export function initializeSessionHandleSchema(database: Database): void {
  database.transaction(() => {
    const columns = database.query("PRAGMA table_info(chat_branches)").all() as { name: string }[];
    if (!columns.some(column => column.name === "handle_owner_id")) {
      database.exec("ALTER TABLE chat_branches ADD COLUMN handle_owner_id TEXT NOT NULL DEFAULT ''");
      database.exec("DROP INDEX IF EXISTS idx_chat_branches_agent_name_active_unique");
    }
    database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_branches_agent_name_active_unique
        ON chat_branches(agent_name) WHERE archived_at IS NULL AND handle_owner_id = '';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_branches_owned_handle_active_unique
        ON chat_branches(handle_owner_id, lower(agent_name)) WHERE archived_at IS NULL AND handle_owner_id != '';
    `);
  }).immediate();
}

/** Explicit offline migration; no automatic mode activation or partial namespace adoption. */
export function migrateOwnedSessionHandles(database: Database): void {
  database.transaction(() => {
    const rows = database.query("SELECT chat_jid,handle_owner_id FROM chat_branches").all() as { chat_jid: string; handle_owner_id: string }[];
    for (const row of rows) {
      const owner = getRootOwnership(database, row.chat_jid, true)?.ownerUserId;
      if (!owner || (row.handle_owner_id && row.handle_owner_id !== owner)) throw new ChatAccessDenied();
      database.query("UPDATE chat_branches SET handle_owner_id=? WHERE chat_jid=?").run(owner, row.chat_jid);
    }
  }).immediate();
}

function requireOwnedHandle(database: Database, principal: AuthenticatedPrincipal, chatJid: string | undefined, action: "session.read" | "session.rename"): OwnedSessionHandle {
  const target = resolveAuthorisedChat(database, principal, chatJid, action);
  const row = database.query(`SELECT branch_id,chat_jid,root_chat_jid,parent_branch_id,agent_name,archived_at
    FROM chat_branches WHERE chat_jid=? AND handle_owner_id=?`).get(target.chatJid, principal.userId) as OwnedSessionHandle | null;
  if (!row) throw new ChatAccessDenied();
  return row;
}

/** An owner-local miss never falls back to legacy handles or another user's namespace. */
export function resolveOwnedSessionHandle(database: Database, principal: AuthenticatedPrincipal, handle: string): OwnedSessionHandle | null {
  const name = handle.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_-]{1,64}$/.test(name)) return null;
  const row = database.query("SELECT chat_jid FROM chat_branches WHERE handle_owner_id=? AND lower(agent_name)=? AND archived_at IS NULL")
    .get(principal.userId, name) as { chat_jid: string } | null;
  if (!row) return null;
  return requireOwnedHandle(database, principal, row.chat_jid, "session.read");
}

export function listOwnedSessionHandles(database: Database, principal: AuthenticatedPrincipal): OwnedSessionHandle[] {
  // Validate the caller and current home even when the namespace has no matches.
  resolveAuthorisedChat(database, principal, undefined, "session.read");
  const rows = database.query("SELECT chat_jid FROM chat_branches WHERE handle_owner_id=? AND archived_at IS NULL ORDER BY root_chat_jid,created_at,chat_jid")
    .all(principal.userId) as { chat_jid: string }[];
  return rows.flatMap(row => {
    try { return [requireOwnedHandle(database, principal, row.chat_jid, "session.read")]; }
    catch (error) { if (error instanceof ChatAccessDenied) return []; throw error; }
  });
}

/** Only friendly metadata changes. The SQL unique index serialises competing claims. */
export function renameOwnedSessionHandle(database: Database, principal: AuthenticatedPrincipal, chatJid: string | undefined, handle: string): OwnedSessionHandle {
  const name = handle.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_-]{1,64}$/.test(name)) throw new Error("Agent handle must be 1–64 letters, digits, underscores or hyphens.");
  return database.transaction(() => {
    const target = requireOwnedHandle(database, principal, chatJid, "session.rename");
    database.query("UPDATE chat_branches SET agent_name=?,updated_at=? WHERE branch_id=?")
      .run(name, new Date().toISOString(), target.branch_id);
    return requireOwnedHandle(database, principal, target.chat_jid, "session.read");
  }).immediate();
}
