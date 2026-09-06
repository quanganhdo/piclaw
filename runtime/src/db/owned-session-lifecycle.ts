import type Database from "bun:sqlite";
import type { AuthenticatedPrincipal } from "../core/access-types.js";
import { createUuid } from "../utils/ids.js";
import { requireAccountActor } from "./account-administration.js";
import { assignRootOwner, ChatAccessDenied, getRootOwnership, provisionUserHome, resolveAuthorisedChat } from "./session-ownership.js";
import type { OwnedForkRecord } from "./owned-forks.js";
import type { SessionSettings } from "../core/session-settings.js";

function handle(value: string): string {
  const name = value.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_-]{1,64}$/.test(name)) throw new Error("Agent handle must be 1–64 letters, digits, underscores or hyphens.");
  return name;
}

/** Lifecycle metadata may include archives; execution still requires an active parent chain. */
export function resolveOwnedLifecycleSession(database: Database, actor: AuthenticatedPrincipal, chatJid: string): OwnedForkRecord {
  requireAccountActor(database, actor);
  if (!chatJid.trim()) throw new ChatAccessDenied();
  const root = getRootOwnership(database, chatJid, true);
  if (!root || root.ownerUserId !== actor.userId) throw new ChatAccessDenied();
  const row = database.query(`SELECT branch_id,chat_jid,root_chat_jid,parent_branch_id,agent_name,created_at,updated_at,archived_at
    FROM chat_branches WHERE chat_jid=? AND handle_owner_id=?`).get(chatJid, actor.userId) as OwnedForkRecord | null;
  if (!row) throw new ChatAccessDenied();
  return row;
}

/** Current family policy permits enabled users to create additional private owned roots. */
export function createOwnedRoot(database: Database, actor: AuthenticatedPrincipal, name: string): OwnedForkRecord {
  return database.transaction(() => {
    requireAccountActor(database, actor);
    const agentName = handle(name);
    const id = createUuid("branch");
    const chatJid = `web:root:${id}`;
    const now = new Date().toISOString();
    database.query("INSERT INTO chats(jid,name,last_message_time) VALUES (?,?,?)").run(chatJid, agentName, now);
    database.query(`INSERT INTO chat_branches(branch_id,chat_jid,root_chat_jid,parent_branch_id,agent_name,created_at,updated_at,archived_at,handle_owner_id)
      VALUES (?,?,?,NULL,?,?,?,NULL,?)`).run(id, chatJid, chatJid, agentName, now, now, actor.userId);
    assignRootOwner(database, chatJid, actor.userId);
    return resolveOwnedLifecycleSession(database, actor, chatJid);
  }).immediate();
}

/** Change only the default landing destination, never another device's explicit target. */
export function selectOwnedHome(database: Database, actor: AuthenticatedPrincipal, chatJid: string): string {
  return database.transaction(() => {
    requireAccountActor(database, actor, { recent: true });
    const target = resolveOwnedLifecycleSession(database, actor, chatJid);
    resolveAuthorisedChat(database, actor, chatJid, "session.read");
    if (target.parent_branch_id || target.chat_jid !== target.root_chat_jid) throw new ChatAccessDenied();
    provisionUserHome(database, actor.userId, chatJid);
    return chatJid;
  }).immediate();
}

export function listOwnedLifecycleSessions(database: Database, actor: AuthenticatedPrincipal, rootChatJid?: string, includeArchived = false): OwnedForkRecord[] {
  requireAccountActor(database, actor);
  if (rootChatJid !== undefined) {
    const root = resolveOwnedLifecycleSession(database, actor, rootChatJid);
    if (root.parent_branch_id || root.root_chat_jid !== root.chat_jid) throw new ChatAccessDenied();
  }
  const rows = database.query(`SELECT chat_jid FROM chat_branches WHERE handle_owner_id=?
    AND (? IS NULL OR root_chat_jid=?) AND (?=1 OR archived_at IS NULL)
    ORDER BY root_chat_jid,created_at,chat_jid`).all(actor.userId, rootChatJid ?? null, rootChatJid ?? null, includeArchived ? 1 : 0) as { chat_jid: string }[];
  return rows.flatMap(row => {
    try {
      const branch = resolveOwnedLifecycleSession(database, actor, row.chat_jid);
      if (!includeArchived) resolveAuthorisedChat(database, actor, row.chat_jid, "session.read");
      return [branch];
    } catch (error) { if (error instanceof ChatAccessDenied) return []; throw error; }
  });
}

/** Read-only eligibility hints. Mutation paths still recheck ownership, graph and runtime state. */
export function readOwnedSessionSettings(database: Database, actor: AuthenticatedPrincipal): SessionSettings {
  return database.transaction(() => {
    const user = requireAccountActor(database, actor);
    let recent = true;
    try { requireAccountActor(database, actor, { recent: true }); }
    catch (error) { if (!(error instanceof ChatAccessDenied)) throw error; recent = false; }
    const readable = (jid: string) => {
      try { resolveAuthorisedChat(database, actor, jid, "session.read"); return true; }
      catch (error) { if (!(error instanceof ChatAccessDenied)) throw error; return false; }
    };
    return { home_chat_jid: user.home_chat_jid, capabilities: { create_root: true },
      branches: listOwnedLifecycleSessions(database, actor, undefined, true).map(branch => {
        const active = readable(branch.chat_jid);
        const parent = branch.parent_branch_id ? database.query("SELECT chat_jid FROM chat_branches WHERE branch_id=?").get(branch.parent_branch_id) as { chat_jid: string } | null : null;
        return { branch_id: branch.branch_id, chat_jid: branch.chat_jid, root_chat_jid: branch.root_chat_jid,
          parent_branch_id: branch.parent_branch_id, agent_name: branch.agent_name, archived_at: branch.archived_at,
          capabilities: { open: active, fork: active, rename: active,
            download_transcript: Boolean(branch.archived_at),
            archive: active && user.home_chat_jid !== branch.chat_jid && !hasActiveDescendant(database, branch.branch_id),
            restore: Boolean(branch.archived_at) && (!branch.parent_branch_id || Boolean(parent && readable(parent.chat_jid))),
            set_home: recent && active && !branch.parent_branch_id && branch.chat_jid === branch.root_chat_jid && branch.chat_jid !== user.home_chat_jid,
          },
        };
      }),
    };
  })();
}

function hasActiveDescendant(database: Database, branchId: string): boolean {
  return Boolean(database.query(`WITH RECURSIVE descendants(branch_id) AS (
    SELECT branch_id FROM chat_branches WHERE parent_branch_id=?
    UNION SELECT b.branch_id FROM chat_branches b JOIN descendants d ON b.parent_branch_id=d.branch_id
  ) SELECT 1 FROM descendants d JOIN chat_branches b ON b.branch_id=d.branch_id WHERE b.archived_at IS NULL LIMIT 1`).get(branchId));
}

/** No cascading archive: every descendant must already be archived. Retain seeds and files. */
export function archiveOwnedSession(database: Database, actor: AuthenticatedPrincipal, chatJid: string): OwnedForkRecord {
  return database.transaction(() => {
    const user = requireAccountActor(database, actor);
    const target = resolveOwnedLifecycleSession(database, actor, chatJid);
    if (user.home_chat_jid === chatJid) throw new Error("Select another owned home before archiving this root.");
    if (target.archived_at) return target;
    resolveAuthorisedChat(database, actor, chatJid, "session.archive");
    if (hasActiveDescendant(database, target.branch_id)) throw new Error("Archive active descendants first.");
    const now = new Date().toISOString();
    database.query("UPDATE chat_branches SET archived_at=?,updated_at=? WHERE branch_id=?").run(now, now, target.branch_id);
    return resolveOwnedLifecycleSession(database, actor, chatJid);
  }).immediate();
}

/** Restore only under active parents. Collision failure leaves the archive and seed unchanged. */
export function restoreOwnedSession(database: Database, actor: AuthenticatedPrincipal, chatJid: string, name?: string): OwnedForkRecord {
  return database.transaction(() => {
    const target = resolveOwnedLifecycleSession(database, actor, chatJid);
    if (!target.archived_at) {
      resolveAuthorisedChat(database, actor, chatJid, "session.read");
      if (name !== undefined && handle(name) !== target.agent_name) throw new Error("Use friendly rename for an active session.");
      return target;
    }
    if (target.parent_branch_id) {
      const parent = database.query("SELECT chat_jid FROM chat_branches WHERE branch_id=?").get(target.parent_branch_id) as { chat_jid: string } | null;
      if (!parent) throw new ChatAccessDenied();
      resolveAuthorisedChat(database, actor, parent.chat_jid, "session.read");
    }
    database.query("UPDATE chat_branches SET agent_name=?,archived_at=NULL,updated_at=? WHERE branch_id=?")
      .run(name === undefined ? target.agent_name : handle(name), new Date().toISOString(), target.branch_id);
    resolveAuthorisedChat(database, actor, chatJid, "session.read");
    return resolveOwnedLifecycleSession(database, actor, chatJid);
  }).immediate();
}
