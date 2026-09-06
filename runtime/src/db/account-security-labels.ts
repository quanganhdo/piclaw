import type Database from 'bun:sqlite';
import type { AuthenticatedPrincipal } from '../core/access-types.js';
import { requireAccountActor } from './account-administration.js';
import { ChatAccessDenied } from './session-ownership.js';

/** Names are display-only; exact immutable IDs continue to select a credential or login. */
export function labelOwnSecurityItem(database: Database, actor: AuthenticatedPrincipal, kind: 'passkey' | 'session', id: string, label: unknown): string {
  return database.transaction(() => {
    requireAccountActor(database, actor, { recent: true });
    if (typeof label !== 'string' || /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(label) || Array.from(label).length > 80) throw new Error('Label must be at most 80 characters without control characters.');
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new ChatAccessDenied();
    const name = label.trim();
    let changes: number;
    if (kind === 'passkey') changes = database.query('UPDATE webauthn_credentials SET label=? WHERE user_id=? AND credential_id=?').run(name, actor.userId, id).changes;
    else if (kind === 'session') changes = database.query('UPDATE web_sessions SET label=? WHERE user_id=? AND session_id=? AND julianday(expires_at)>julianday(?)').run(name, actor.userId, id, new Date().toISOString()).changes;
    else throw new ChatAccessDenied();
    if (changes !== 1) throw new ChatAccessDenied();
    return name;
  }).immediate();
}
