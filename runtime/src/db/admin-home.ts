import type Database from 'bun:sqlite';
import type { AuthenticatedPrincipal } from '../core/access-types.js';
import type { AdminHome } from '../core/admin-home.js';
import { requireAccountActor } from './account-administration.js';
import { ChatAccessDenied, getRootOwnership, provisionUserHome } from './session-ownership.js';
import { getUser } from './users.js';
import { createUuid } from '../utils/ids.js';

function target(database: Database, actor: AuthenticatedPrincipal, userId: string) {
  requireAccountActor(database, actor, { admin: true, recent: true });
  const user = getUser(database, userId);
  if (!user || user.id === actor.userId) throw new ChatAccessDenied();
  return user;
}
function ownedRoot(database: Database, userId: string, branchId: string) {
  const row = database.query(`SELECT branch_id,chat_jid,agent_name FROM chat_branches
    WHERE branch_id=? AND handle_owner_id=? AND parent_branch_id IS NULL
      AND root_chat_jid=chat_jid AND archived_at IS NULL`).get(branchId, userId) as { branch_id: string; chat_jid: string; agent_name: string } | null;
  if (!row) throw new ChatAccessDenied();
  const ownership = getRootOwnership(database, row.chat_jid);
  if (ownership?.ownerUserId !== userId || ownership.rootBranchId !== row.branch_id || ownership.rootChatJid !== row.chat_jid) throw new ChatAccessDenied();
  return row;
}

export function readAdminHome(database: Database, actor: AuthenticatedPrincipal, userId: string): AdminHome {
  return database.transaction(() => {
    const user = target(database, actor, userId);
    const rows = database.query(`SELECT b.branch_id FROM session_roots r JOIN chat_branches b ON b.branch_id=r.root_branch_id
      WHERE r.owner_user_id=? ORDER BY b.agent_name,b.branch_id`).all(userId) as { branch_id: string }[];
    return { user: { id: user.id, username: user.username, enabled: user.enabled }, roots: rows.flatMap(row => {
      try { const root = ownedRoot(database, userId, row.branch_id); return [{ branch_id: root.branch_id, agent_name: root.agent_name, current: root.chat_jid === user.home_chat_jid }]; }
      catch (error) { if (!(error instanceof ChatAccessDenied)) throw error; return []; }
    }) };
  })();
}

/** Change a default, not ownership or execution identity; never hydrate a target model. */
export function assignAdminHome(database: Database, actor: AuthenticatedPrincipal, userId: string, input: { branch_id: string; confirm_username: string }): { changed: boolean } {
  return database.transaction(() => {
    const user = target(database, actor, userId);
    if (!input || Object.keys(input).length !== 2 || typeof input.branch_id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(input.branch_id)
      || input.confirm_username !== user.username) throw new ChatAccessDenied();
    const root = ownedRoot(database, userId, input.branch_id);
    if (root.chat_jid === user.home_chat_jid) return { changed: false };
    provisionUserHome(database, userId, root.chat_jid);
    database.query(`INSERT INTO account_home_events(id,actor_user_id,target_user_id,previous_home_chat_jid,target_branch_id,created_at)
      VALUES (?,?,?,?,?,?)`).run(createUuid('home-change'), actor.userId, userId, user.home_chat_jid, root.branch_id, new Date().toISOString());
    return { changed: true };
  }).immediate();
}
