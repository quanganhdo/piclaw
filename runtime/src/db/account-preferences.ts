import type Database from 'bun:sqlite';
import type { AuthenticatedPrincipal } from '../core/access-types.js';
import { ACCOUNT_PREFERENCE_DEFAULTS, validateAccountPreferenceValues, type AccountPreferences, type OwnAccountPreferences } from '../core/account-preferences.js';
import { requireAccountActor } from './account-administration.js';
import { getUser } from './users.js';
import { ChatAccessDenied } from './session-ownership.js';

export function initializeAccountPreferences(database: Database): void {
  database.exec(`CREATE TABLE IF NOT EXISTS user_preferences (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    revision INTEGER NOT NULL CHECK (revision >= 1),
    theme TEXT NOT NULL CHECK (theme IN ('system','light','dark')),
    response_guidance TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;`);
}

/** Internal run snapshot read. Callers must establish owner authority first. */
export function readAccountPreferences(database: Database, userId: string): AccountPreferences {
  if (!getUser(database, userId)) throw new ChatAccessDenied();
  const row = database.query('SELECT revision,theme,response_guidance FROM user_preferences WHERE user_id=?').get(userId) as AccountPreferences | null;
  if (!row) return Object.freeze({ revision: 0, ...ACCOUNT_PREFERENCE_DEFAULTS });
  if (!Number.isSafeInteger(row.revision) || row.revision < 1) throw new Error('Invalid account preference revision.');
  return Object.freeze({ revision: row.revision, ...validateAccountPreferenceValues(row.theme, row.response_guidance) });
}

export function readOwnAccountPreferences(database: Database, actor: AuthenticatedPrincipal): OwnAccountPreferences {
  return database.transaction(() => {
    requireAccountActor(database, actor);
    return { user_id: actor.userId, preferences: readAccountPreferences(database, actor.userId), defaults: { ...ACCOUNT_PREFERENCE_DEFAULTS }, can_edit: true };
  })();
}

/** Appearance and guidance are non-sensitive self-service preferences; live login required. */
export function updateOwnAccountPreferences(database: Database, actor: AuthenticatedPrincipal,
  input: { expected_revision: number; theme: unknown; response_guidance: unknown }): OwnAccountPreferences {
  return database.transaction(() => {
    requireAccountActor(database, actor);
    if (!input || Object.keys(input).length !== 3 || Object.keys(input).some(key => !['expected_revision', 'theme', 'response_guidance'].includes(key))
      || !Number.isSafeInteger(input.expected_revision) || input.expected_revision < 0) throw new ChatAccessDenied();
    const value = validateAccountPreferenceValues(input.theme, input.response_guidance), current = readAccountPreferences(database, actor.userId);
    if (current.revision !== input.expected_revision) throw new Error('Preferences changed. Refresh before saving.');
    if (value.theme === current.theme && value.response_guidance === current.response_guidance) return readOwnAccountPreferences(database, actor);
    const revision = current.revision+1;
    if (!Number.isSafeInteger(revision)) throw new ChatAccessDenied();
    database.query(`INSERT INTO user_preferences(user_id,revision,theme,response_guidance,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET revision=excluded.revision,theme=excluded.theme,response_guidance=excluded.response_guidance,updated_at=excluded.updated_at`)
      .run(actor.userId, revision, value.theme, value.response_guidance, new Date().toISOString());
    return readOwnAccountPreferences(database, actor);
  }).immediate();
}
