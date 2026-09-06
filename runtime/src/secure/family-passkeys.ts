import type Database from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import type { AuthenticatedPrincipal } from "../core/access-types.js";
import { requireAccountActor } from "../db/account-administration.js";
import { ChatAccessDenied } from "../db/session-ownership.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
interface Registration {
  token_hash: string; user_id: string; session_id: string; rp_id: string; origin: string; challenge: string; expires_at: number;
}

/** Durable, one-use family registrations bound to an account's current browser login. */
export class FamilyPasskeys {
  constructor(private readonly database: Database, private readonly now = () => Date.now()) {}

  async start(principal: AuthenticatedPrincipal, rpId: string, origin: string) {
    const user = requireAccountActor(this.database, principal, { recent: true });
    const existing = this.database.query("SELECT credential_id FROM webauthn_credentials WHERE user_id=? AND rp_id=?")
      .all(user.id, rpId) as { credential_id: string }[];
    const { generateRegistrationOptions } = await import("@simplewebauthn/server");
    const options = await generateRegistrationOptions({
      rpName: "PiClaw", rpID: rpId, userID: new TextEncoder().encode(user.id), userName: user.username, userDisplayName: user.display_name,
      attestationType: "none", authenticatorSelection: { residentKey: "required", userVerification: "required" },
      excludeCredentials: existing.map(row => ({ id: row.credential_id })),
    });
    const token = randomBytes(32).toString("base64url");
    const expiresAt = this.now() + 5 * 60_000;
    this.database.transaction(() => {
      requireAccountActor(this.database, principal, { recent: true });
      this.database.query("DELETE FROM user_passkey_registrations WHERE expires_at<=?").run(this.now());
      const count = (this.database.query("SELECT count(*) n FROM user_passkey_registrations WHERE user_id=?").get(user.id) as { n: number }).n;
      if (count >= 5) throw new Error("Too many pending passkey registrations.");
      this.database.query("INSERT INTO user_passkey_registrations(token_hash,user_id,session_id,rp_id,origin,challenge,expires_at) VALUES (?,?,?,?,?,?,?)")
        .run(hash(token), user.id, principal.authentication.sessionId!, rpId, origin, options.challenge, expiresAt);
    }).immediate();
    return { token, options, expires_at: expiresAt };
  }

  async finish(principal: AuthenticatedPrincipal, token: string, origin: string, response: RegistrationResponseJSON): Promise<void> {
    const registration = this.database.transaction(() => {
      requireAccountActor(this.database, principal, { recent: true });
      // A different account/login/origin cannot even consume another browser's ceremony.
      return this.database.query(`DELETE FROM user_passkey_registrations
        WHERE token_hash=? AND user_id=? AND session_id=? AND origin=? AND expires_at>?
        RETURNING *`).get(hash(token), principal.userId, principal.authentication.sessionId!, origin, this.now()) as Registration | null;
    }).immediate();
    if (!registration) throw new ChatAccessDenied();
    // Consume before cryptography, so failed/concurrent submissions must start a new ceremony.
    const { verifyRegistrationResponse } = await import("@simplewebauthn/server");
    const result = await verifyRegistrationResponse({ response, expectedChallenge: registration.challenge,
      expectedOrigin: registration.origin, expectedRPID: registration.rp_id, requireUserVerification: true });
    if (!result.verified || !result.registrationInfo) throw new ChatAccessDenied();
    const credential = result.registrationInfo.credential;
    this.database.transaction(() => {
      requireAccountActor(this.database, principal, { recent: true });
      if (registration.expires_at <= this.now()) throw new ChatAccessDenied();
      // Plain INSERT: adding a second key never replaces any existing credential, including another owner's.
      this.database.query(`INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key,sign_count,transports,created_at)
        VALUES (?,?,?,?,?,?,?)`).run(principal.userId, registration.rp_id, credential.id,
        Buffer.from(credential.publicKey).toString("base64url"), credential.counter,
        Array.isArray(response.response.transports) ? JSON.stringify(response.response.transports) : null, new Date(this.now()).toISOString());
    }).immediate();
  }
}
