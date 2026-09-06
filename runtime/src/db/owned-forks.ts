import type Database from "bun:sqlite";
import type { AuthenticatedPrincipal } from "../core/access-types.js";
import { createUuid } from "../utils/ids.js";
import { ChatAccessDenied, resolveAuthorisedChat } from "./session-ownership.js";

export interface OwnedForkRecord {
  branch_id: string;
  chat_jid: string;
  root_chat_jid: string;
  parent_branch_id: string | null;
  agent_name: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

/** Persist registry, ownership chain and captured seed in one SQLite transaction. */
export function initializeOwnedForkSchema(database: Database): void {
  database.exec(`CREATE TABLE IF NOT EXISTS owned_fork_operations (
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    request_id TEXT NOT NULL,
    source_branch_id TEXT NOT NULL REFERENCES chat_branches(branch_id),
    target_branch_id TEXT NOT NULL UNIQUE REFERENCES chat_branches(branch_id),
    seed_json TEXT,
    created_at TEXT NOT NULL,
    materialised_at TEXT,
    PRIMARY KEY(owner_user_id, request_id)
  ) STRICT;`);
}

function requestKey(value: string): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new Error("A stable fork request_id (1–128 letters, digits, underscores or hyphens) is required.");
  return value;
}

function ownedBranch(database: Database, principal: AuthenticatedPrincipal, chatJid: string, action: "session.read" | "session.fork"): OwnedForkRecord {
  resolveAuthorisedChat(database, principal, chatJid, action);
  const row = database.query("SELECT branch_id,chat_jid,root_chat_jid,parent_branch_id,agent_name,created_at,updated_at,archived_at FROM chat_branches WHERE chat_jid=? AND handle_owner_id=?")
    .get(chatJid, principal.userId) as OwnedForkRecord | null;
  if (!row) throw new ChatAccessDenied();
  return row;
}

/** Retry is bound to both owner and source, and never selects an archived/foreign child. */
export function findOwnedFork(database: Database, principal: AuthenticatedPrincipal, sourceChatJid: string, requestId: string): OwnedForkRecord | null {
  const source = ownedBranch(database, principal, sourceChatJid, "session.fork");
  const existing = database.query(`SELECT o.source_branch_id,b.chat_jid FROM owned_fork_operations o
    JOIN chat_branches b ON b.branch_id=o.target_branch_id WHERE o.owner_user_id=? AND o.request_id=?`)
    .get(principal.userId, requestKey(requestId)) as { source_branch_id: string; chat_jid: string } | null;
  if (!existing) return null;
  if (existing.source_branch_id !== source.branch_id) throw new ChatAccessDenied();
  return ownedBranch(database, principal, existing.chat_jid, "session.read");
}

export function commitOwnedFork(database: Database, principal: AuthenticatedPrincipal, sourceChatJid: string, requestId: string, requestedName: string, seedJson: string): OwnedForkRecord {
  const base = requestedName.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_-]{1,64}$/.test(base)) throw new Error("Agent handle must be 1–64 letters, digits, underscores or hyphens.");
  // Serialise before opening the transaction; no await or filesystem writes inside it.
  JSON.parse(seedJson);
  return database.transaction(() => {
    const existing = findOwnedFork(database, principal, sourceChatJid, requestId);
    if (existing) return existing;
    const source = ownedBranch(database, principal, sourceChatJid, "session.fork");
    const branchId = createUuid("branch");
    const chatJid = `${source.root_chat_jid}:branch:${branchId}`;
    let name = base;
    let suffix = 2;
    while (database.query("SELECT 1 FROM chat_branches WHERE handle_owner_id=? AND lower(agent_name)=? AND archived_at IS NULL").get(principal.userId, name)) {
      const ending = `-${suffix++}`;
      name = `${base.slice(0, 64 - ending.length)}${ending}`;
    }
    const now = new Date().toISOString();
    database.query("INSERT INTO chats(jid,name,last_message_time) VALUES (?,?,?)").run(chatJid, name, now);
    database.query(`INSERT INTO chat_branches(branch_id,chat_jid,root_chat_jid,parent_branch_id,agent_name,created_at,updated_at,archived_at,handle_owner_id)
      VALUES (?,?,?,?,?,?,?,NULL,?)`).run(branchId, chatJid, source.root_chat_jid, source.branch_id, name, now, now, principal.userId);
    database.query("INSERT INTO owned_fork_operations(owner_user_id,request_id,source_branch_id,target_branch_id,seed_json,created_at) VALUES (?,?,?,?,?,?)")
      .run(principal.userId, requestKey(requestId), source.branch_id, branchId, seedJson, now);
    return ownedBranch(database, principal, chatJid, "session.read");
  }).immediate();
}

/** Caller has authorised hydration. Seed access independently checks live source and target. */
export function readOwnedForkSeed(database: Database, principal: AuthenticatedPrincipal, chatJid: string): string | null {
  const target = ownedBranch(database, principal, chatJid, "session.read");
  const row = database.query(`SELECT o.owner_user_id,o.seed_json,s.chat_jid AS source_chat_jid FROM owned_fork_operations o
    JOIN chat_branches s ON s.branch_id=o.source_branch_id WHERE o.target_branch_id=?`).get(target.branch_id) as { owner_user_id: string; seed_json: string | null; source_chat_jid: string } | null;
  if (!row) {
    // A family child without an atomic fork operation cannot fall back to a legacy file seed.
    if (target.parent_branch_id) throw new ChatAccessDenied();
    return null;
  }
  if (row.owner_user_id !== principal.userId) throw new ChatAccessDenied();
  if (row.seed_json !== null) {
    const source = ownedBranch(database, principal, row.source_chat_jid, "session.read");
    if (source.branch_id !== target.parent_branch_id || source.root_chat_jid !== target.root_chat_jid) throw new ChatAccessDenied();
  }
  return row.seed_json;
}

export function finishOwnedForkSeed(database: Database, principal: AuthenticatedPrincipal, chatJid: string): void {
  database.transaction(() => {
    readOwnedForkSeed(database, principal, chatJid);
    database.query(`UPDATE owned_fork_operations SET seed_json=NULL,materialised_at=?
      WHERE owner_user_id=? AND target_branch_id=(SELECT branch_id FROM chat_branches WHERE chat_jid=?) AND seed_json IS NOT NULL`)
      .run(new Date().toISOString(), principal.userId, chatJid);
  }).immediate();
}
