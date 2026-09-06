import type Database from 'bun:sqlite';
import type { AuthenticatedPrincipal } from '../core/access-types.js';
import { FAMILY_WEB_TOOLS, isFamilyWebToolAllowed } from '../core/family-workspace-policy.js';
import type { FamilyToolPolicy, AdminToolPolicy } from '../core/family-tool-restrictions.js';
import { getUser } from './users.js';
import { requireAccountActor } from './account-administration.js';
import { ChatAccessDenied } from './session-ownership.js';
import { createUuid } from '../utils/ids.js';

export function initializeFamilyToolRestrictions(database: Database): void {
  database.exec(`CREATE TABLE IF NOT EXISTS user_tool_restrictions (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    denied_tools TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 1)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS user_tool_restriction_events (
    id TEXT PRIMARY KEY, actor_user_id TEXT NOT NULL REFERENCES users(id), target_user_id TEXT NOT NULL REFERENCES users(id),
    previous_denied TEXT NOT NULL, next_denied TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL
  ) STRICT;`);
}

function deniedNames(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > FAMILY_WEB_TOOLS.length || value.some(name => typeof name !== 'string' || !isFamilyWebToolAllowed(name))
    || new Set(value).size !== value.length) throw new ChatAccessDenied();
  return FAMILY_WEB_TOOLS.filter(name => value.includes(name));
}

/** Internal snapshot reader; missing/invalid schema or stored data fails, never broadens policy. */
export function readFamilyToolPolicy(database: Database, userId: string): FamilyToolPolicy {
  if (!getUser(database, userId)) throw new ChatAccessDenied();
  const row = database.query('SELECT denied_tools,revision FROM user_tool_restrictions WHERE user_id=?').get(userId) as { denied_tools: string; revision: number } | null;
  if (row && (!Number.isSafeInteger(row.revision) || row.revision < 1)) throw new ChatAccessDenied();
  const denied = row ? deniedNames(JSON.parse(row.denied_tools)) : [];
  return Object.freeze({ revision: row?.revision ?? 0, denied: Object.freeze(denied), allowed: Object.freeze(FAMILY_WEB_TOOLS.filter(name => !denied.includes(name))) });
}

export function readAdminToolPolicy(database: Database, actor: AuthenticatedPrincipal, userId: string): AdminToolPolicy {
  return database.transaction(() => {
    requireAccountActor(database, actor, { admin: true, recent: true });
    const user = getUser(database, userId); if (!user) throw new ChatAccessDenied();
    return { user: { id: user.id, username: user.username }, ceiling: FAMILY_WEB_TOOLS, policy: readFamilyToolPolicy(database, userId) };
  })();
}

export function updateAdminToolPolicy(database: Database, actor: AuthenticatedPrincipal, userId: string,
  input: { confirm_username: string; expected_revision: number; denied_tools: string[] }): FamilyToolPolicy {
  return database.transaction(() => {
    requireAccountActor(database, actor, { admin: true, recent: true });
    const user = getUser(database, userId);
    if (!input || Object.keys(input).length !== 3 || Object.keys(input).some(key => !['confirm_username', 'expected_revision', 'denied_tools'].includes(key))
      || !user || input.confirm_username !== user.username || !Number.isSafeInteger(input.expected_revision) || input.expected_revision < 0) throw new ChatAccessDenied();
    const denied = deniedNames(input.denied_tools), current = readFamilyToolPolicy(database, userId);
    if (current.revision !== input.expected_revision) throw new Error('Tool restrictions changed. Refresh before saving.');
    if (JSON.stringify(denied) === JSON.stringify(current.denied)) return current;
    const revision = current.revision + 1;
    if (!Number.isSafeInteger(revision)) throw new ChatAccessDenied();
    database.query(`INSERT INTO user_tool_restrictions(user_id,denied_tools,revision) VALUES (?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET denied_tools=excluded.denied_tools,revision=excluded.revision`).run(userId, JSON.stringify(denied), revision);
    database.query('INSERT INTO user_tool_restriction_events(id,actor_user_id,target_user_id,previous_denied,next_denied,revision,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(createUuid('tool-policy'), actor.userId, userId, JSON.stringify(current.denied), JSON.stringify(denied), revision, new Date().toISOString());
    return readFamilyToolPolicy(database, userId);
  }).immediate();
}
