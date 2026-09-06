import type Database from 'bun:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import type { AuthenticatedPrincipal } from '../core/access-types.js';
import { requireAccountActor } from '../db/account-administration.js';
import { ChatAccessDenied } from '../db/session-ownership.js';
import { UserAuthFactors } from './user-auth-factors.js';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
type Registration = { registration_id: string; token_hash: string | null; expires_at: number };

/** Existing authenticated accounts add a TOTP factor; never replace one or enable an account. */
export class FamilyTotp {
  constructor(private database: Database, private factors = new UserAuthFactors(database), private now = () => Date.now()) {}

  private registration(actor: AuthenticatedPrincipal, origin: string): Registration {
    requireAccountActor(this.database, actor, { recent: true });
    const row = this.database.query(`SELECT registration_id,token_hash,expires_at FROM user_totp_registrations
      WHERE user_id=? AND session_id=? AND origin=? AND expires_at>?`).get(actor.userId, actor.authentication.sessionId!, origin, this.now()) as Registration | null;
    if (!row) throw new ChatAccessDenied();
    return row;
  }
  async start(actor: AuthenticatedPrincipal, origin: string) {
    const id = randomUUID();
    const user = this.database.transaction(() => {
      const user = requireAccountActor(this.database, actor, { recent: true });
      if (this.database.query('SELECT 1 FROM user_totp_factors WHERE user_id=?').get(user.id)
        || this.database.query('SELECT 1 FROM user_auth_invitations WHERE user_id=?').get(user.id)) throw new ChatAccessDenied();
      this.database.query('DELETE FROM user_totp_registrations WHERE user_id=?').run(user.id);
      this.database.query('INSERT INTO user_totp_registrations(user_id,registration_id,session_id,origin,expires_at) VALUES (?,?,?,?,?)')
        .run(user.id, id, actor.authentication.sessionId!, origin, this.now()+5*60_000);
      return user;
    }).immediate();
    try {
      const pending = await this.factors.beginEnrolment(user.id, value => {
        if (this.registration(actor, origin).registration_id !== id) throw new ChatAccessDenied();
        this.database.query('UPDATE user_totp_registrations SET token_hash=? WHERE user_id=? AND registration_id=?').run(hash(value.token), user.id, id);
      });
      const current = this.registration(actor, origin);
      if (current.registration_id !== id) throw new ChatAccessDenied();
      return { ...pending, expiresAt: Math.min(pending.expiresAt, current.expires_at), username: user.username };
    } catch (error) {
      this.database.query('DELETE FROM user_totp_registrations WHERE user_id=? AND registration_id=?').run(user.id, id);
      throw error;
    }
  }
  async confirm(actor: AuthenticatedPrincipal, origin: string, token: string, code: string): Promise<boolean> {
    const registration = this.registration(actor, origin);
    if (registration.token_hash !== hash(token)) throw new ChatAccessDenied();
    return this.factors.confirmEnrolment(actor.userId, token, code, () => {
      const current = this.registration(actor, origin);
      if (current.registration_id !== registration.registration_id || current.token_hash !== hash(token)) throw new ChatAccessDenied();
      this.database.query('DELETE FROM user_totp_registrations WHERE user_id=? AND registration_id=?').run(actor.userId, registration.registration_id);
    });
  }
  cancel(actor: AuthenticatedPrincipal, origin: string, token: string): void {
    const current = this.registration(actor, origin);
    if (current.token_hash !== hash(token)) throw new ChatAccessDenied();
    this.database.query('DELETE FROM user_totp_registrations WHERE user_id=? AND registration_id=?').run(actor.userId, current.registration_id);
  }
}
