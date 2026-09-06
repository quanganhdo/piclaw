import type Database from 'bun:sqlite';
import type { AuthenticatedPrincipal } from '../core/access-types.js';
import { validateAccountModelDefaults, type AccountModelDefaults } from '../core/account-model-defaults.js';
import { requireAccountActor } from './account-administration.js';
import { getUser } from './users.js';
import { ChatAccessDenied } from './session-ownership.js';

export function initializeAccountModelDefaults(database: Database): void {
  database.exec(`CREATE TABLE IF NOT EXISTS user_model_defaults (
    user_id TEXT PRIMARY KEY REFERENCES users(id), revision INTEGER NOT NULL CHECK(revision >= 1),
    model TEXT, thinking_level TEXT, updated_at TEXT NOT NULL,
    CHECK(model IS NOT NULL OR thinking_level IS NULL)
  ) STRICT;`);
}

/** Internal snapshot only; the caller establishes owner authority first. */
export function readAccountModelDefaults(database: Database, userId: string): AccountModelDefaults {
  if (!getUser(database, userId)) throw new ChatAccessDenied();
  const row = database.query('SELECT revision,model,thinking_level FROM user_model_defaults WHERE user_id=?').get(userId) as AccountModelDefaults | null;
  if (!row) return Object.freeze({ revision: 0, model: null, thinking_level: null });
  if (!Number.isSafeInteger(row.revision) || row.revision < 1) throw new ChatAccessDenied();
  return Object.freeze({ revision: row.revision, ...validateAccountModelDefaults(row.model, row.thinking_level) });
}

/** Catalogue validator runs inside the same transaction as live actor + revision checks. */
export function updateOwnAccountModelDefaults(database: Database, actor: AuthenticatedPrincipal, input: unknown,
  validate: (value: Omit<AccountModelDefaults, 'revision'>) => void): AccountModelDefaults {
  return database.transaction(() => {
    requireAccountActor(database, actor);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 3 || Object.keys(input).some(key => !['expected_revision', 'model', 'thinking_level'].includes(key))) throw new ChatAccessDenied();
    const body = input as Record<string, unknown>;
    if (!Number.isSafeInteger(body.expected_revision) || (body.expected_revision as number) < 0) throw new ChatAccessDenied();
    const current = readAccountModelDefaults(database, actor.userId);
    if (body.expected_revision !== current.revision) throw new Error('Model defaults changed. Refresh before saving.');
    const value = validateAccountModelDefaults(body.model, body.thinking_level);
    validate(value);
    if (value.model === current.model && value.thinking_level === current.thinking_level) return current;
    const revision = current.revision+1;
    if (!Number.isSafeInteger(revision)) throw new ChatAccessDenied();
    database.query(`INSERT INTO user_model_defaults(user_id,revision,model,thinking_level,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET revision=excluded.revision,model=excluded.model,thinking_level=excluded.thinking_level,updated_at=excluded.updated_at`)
      .run(actor.userId, revision, value.model, value.thinking_level, new Date().toISOString());
    return readAccountModelDefaults(database, actor.userId);
  }).immediate();
}
