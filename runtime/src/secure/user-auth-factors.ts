import type Database from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";

import { readKeychainBootstrapKeyMaterial } from "../core/config-secrets.js";
import { matchTotpStep } from "../channels/web/auth/auth.js";
import { createUuid } from "../utils/ids.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ITERATIONS = 150_000;
interface Ciphertext { ciphertext: Uint8Array; salt: Uint8Array; nonce: Uint8Array }
interface Factor extends Ciphertext { user_id: string; revision: string; last_used_step: number }
interface Enrolment extends Ciphertext { user_id: string; expires_at: number }
export interface VerifiedTotp { userId: string; factorRevision: string; step: number }
/** Internal migration value; contains ciphertext only, never the plaintext seed/proof. */
export interface PreparedLegacyTotp extends Ciphertext { step: number; expiresAt: number }

/** Reserve attempts before asynchronous crypto, bounding even parallel guesses. Success does not erase a reservation. */
export function reserveUserAuthAttempt(database: Database, username: string, clientKey: string, now = Date.now()): boolean {
  return database.transaction(() => {
    database.query("DELETE FROM user_auth_attempts WHERE reset_at <= ?").run(now);
    const buckets = [[`user:${hashToken(username)}`, 5], [`ip:${hashToken(clientKey)}`, 20]] as const;
    for (const [bucket, limit] of buckets) {
      const row = database.query("SELECT count FROM user_auth_attempts WHERE bucket=?").get(bucket) as {count:number} | null;
      if (row && row.count >= limit) return false;
    }
    for (const [bucket] of buckets) database.query(`INSERT INTO user_auth_attempts(bucket,count,reset_at) VALUES (?,1,?)
      ON CONFLICT(bucket) DO UPDATE SET count=count+1`).run(bucket,now+5*60_000);
    return true;
  }).immediate();
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const asBuffer = (bytes: Uint8Array): ArrayBuffer => Uint8Array.from(bytes).buffer;

/** Restricted authentication service; no API returns a persisted/decrypted seed. */
export class UserAuthFactors {
  constructor(
    private readonly database: Database,
    private readonly readKeyMaterial: () => string = readKeychainBootstrapKeyMaterial,
    private readonly now: () => number = Date.now,
  ) {}

  private async key(salt: Uint8Array): Promise<CryptoKey> {
    const material = this.readKeyMaterial();
    if (!material) throw new Error("Authentication factor encryption requires configured bootstrap key material.");
    const base = await crypto.subtle.importKey("raw", encoder.encode(material), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name:"PBKDF2", salt:asBuffer(salt), iterations:ITERATIONS, hash:"SHA-256" }, base, {name:"AES-GCM",length:256}, false, ["encrypt","decrypt"]);
  }

  private async encrypt(userId: string, secret: string): Promise<Ciphertext> {
    const salt = randomBytes(16), nonce = randomBytes(12);
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv:asBuffer(nonce),additionalData:encoder.encode(`piclaw:user-totp:v1:${userId}`)},await this.key(salt),encoder.encode(secret)));
    return {salt,nonce,ciphertext};
  }

  private async decrypt(row: Ciphertext & {user_id: string}): Promise<string> {
    return decoder.decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:asBuffer(row.nonce),additionalData:encoder.encode(`piclaw:user-totp:v1:${row.user_id}`)},await this.key(row.salt),asBuffer(row.ciphertext)));
  }

  /** Offline copy migration only. Do not infer the seed from global configuration or assign it to another account. */
  async prepareLegacyDefaultMigration(secret: string, code: string): Promise<PreparedLegacyTotp> {
    if (!/^[A-Z2-7]{16,128}$/.test(secret) || !/^\d{6}$/.test(code)) throw new Error('Invalid legacy factor proof.');
    if (!this.database.query("SELECT 1 FROM users WHERE id='default'").get()
      || this.database.query("SELECT 1 FROM user_totp_factors WHERE user_id='default'").get()) throw new Error('Legacy default factor already exists or account is missing.');
    const step = matchTotpStep(secret, code, this.now());
    if (step === null) throw new Error('Invalid legacy factor proof.');
    const encrypted = await this.encrypt('default', secret);
    if (matchTotpStep(secret, code, this.now()) !== step) throw new Error('Legacy factor proof expired during encryption.');
    return { ...encrypted, step, expiresAt: this.now()+5*60_000 };
  }

  /** Caller owns copy-only transaction and revalidated plan. No account activation, replacement or login. */
  commitLegacyDefaultMigration(value: PreparedLegacyTotp): void {
    if (!Number.isSafeInteger(value.step) || value.step<0 || !Number.isFinite(value.expiresAt) || value.expiresAt<=this.now()
      || value.expiresAt>this.now()+5*60_000 || value.salt.byteLength!==16 || value.nonce.byteLength!==12 || value.ciphertext.byteLength<32
      || !this.database.query("SELECT 1 FROM users WHERE id='default'").get()) throw new Error('Invalid or expired prepared legacy factor.');
    this.database.query('INSERT INTO user_totp_factors(user_id,ciphertext,salt,nonce,revision,last_used_step,created_at) VALUES (?,?,?,?,?,?,?)')
      .run('default',value.ciphertext,value.salt,value.nonce,createUuid('factor'),value.step,new Date(this.now()).toISOString());
  }

  /** Caller must authorise a restricted enrolment ceremony. Returns a new seed once for QR rendering. */
  async beginEnrolment(userId: string, authoriseWrite?: (pending: { token: string; expiresAt: number }) => void): Promise<{ token: string; secret: string; expiresAt: number }> {
    if (!this.database.query("SELECT 1 FROM users WHERE id=?").get(userId)) throw new Error("Unknown enrolment account.");
    if (this.database.query("SELECT 1 FROM user_totp_factors WHERE user_id=?").get(userId)) throw new Error("Existing factor requires explicit authenticated reset.");
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const secret = Array.from(randomBytes(32), byte => alphabet[byte & 31]).join("");
    const token = randomBytes(32).toString("base64url");
    const encrypted = await this.encrypt(userId, secret);
    const expiresAt = this.now() + 5 * 60_000;
    this.database.transaction(() => {
      authoriseWrite?.({ token, expiresAt });
      if (!this.database.query("SELECT 1 FROM users WHERE id=?").get(userId)) throw new Error("Unknown enrolment account.");
      if (this.database.query("SELECT 1 FROM user_totp_factors WHERE user_id=?").get(userId)) throw new Error("Existing factor requires explicit authenticated reset.");
      this.database.query(`INSERT INTO user_totp_enrolments(token_hash,user_id,ciphertext,salt,nonce,expires_at)
        VALUES (?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,ciphertext=excluded.ciphertext,salt=excluded.salt,nonce=excluded.nonce,expires_at=excluded.expires_at,attempts=0`)
        .run(hashToken(token),userId,encrypted.ciphertext,encrypted.salt,encrypted.nonce,expiresAt);
    }).immediate();
    return {token,secret,expiresAt};
  }

  /** Confirm possession and consume the token atomically; this does not enable the account. */
  async confirmEnrolment(userId: string, token: string, code: string, finalise?: () => void): Promise<boolean> {
    const tokenHash = hashToken(token);
    this.database.query("DELETE FROM user_totp_enrolments WHERE expires_at<=?").run(this.now());
    const row = this.database.query(`UPDATE user_totp_enrolments SET attempts=attempts+1
      WHERE token_hash=? AND user_id=? AND expires_at>? AND attempts<5
      RETURNING user_id,ciphertext,salt,nonce,expires_at`).get(tokenHash,userId,this.now()) as Enrolment | null;
    if (!row) return false;
    const secret = await this.decrypt(row);
    const step = matchTotpStep(secret, code, this.now());
    if (step === null) return false;
    return this.database.transaction(() => {
      if (!this.database.query("SELECT 1 FROM users WHERE id=?").get(userId)
        || this.database.query("SELECT 1 FROM user_totp_factors WHERE user_id=?").get(userId)) return false;
      const consumed=this.database.query("DELETE FROM user_totp_enrolments WHERE token_hash=? AND user_id=? AND expires_at>?").run(tokenHash,userId,this.now());
      if (consumed.changes !== 1) return false;
      this.database.query("INSERT INTO user_totp_factors(user_id,ciphertext,salt,nonce,revision,last_used_step,created_at) VALUES (?,?,?,?,?,?,?)")
        .run(userId,row.ciphertext,row.salt,row.nonce,createUuid("factor"),step,new Date(this.now()).toISOString());
      // Optional server-owned completion runs inside the same transaction; failure restores the factor/token.
      finalise?.();
      return true;
    }).immediate();
  }

  /**
   * Offline confirmed-factor re-encryption. Stop all writers and back up the store/key first.
   * This does not rotate the generic keychain or change the configured bootstrap key.
   */
  async rotateFactorEncryption(readNewKeyMaterial: () => string): Promise<{ rotated: number }> {
    const material = readNewKeyMaterial();
    if (!material || material === this.readKeyMaterial()) throw new Error("A distinct non-empty replacement key is required.");
    const target = new UserAuthFactors(this.database, () => material, this.now);
    const snapshot = this.database.query("SELECT * FROM user_totp_factors ORDER BY user_id").all() as Factor[];
    const fingerprint = JSON.stringify(snapshot);
    const updates: Array<{ userId: string; encrypted: Ciphertext }> = [];
    // Decrypt/verify every row before writing any ciphertext. A wrong old key cannot partially rotate.
    for (const row of snapshot) updates.push({ userId: row.user_id, encrypted: await target.encrypt(row.user_id, await this.decrypt(row)) });
    return this.database.transaction(() => {
      if (JSON.stringify(this.database.query("SELECT * FROM user_totp_factors ORDER BY user_id").all()) !== fingerprint) {
        throw new Error("Authentication factors changed during offline rotation.");
      }
      for (const update of updates) {
        this.database.query("UPDATE user_totp_factors SET ciphertext=?,salt=?,nonce=?,revision=? WHERE user_id=?")
          .run(update.encrypted.ciphertext, update.encrypted.salt, update.encrypted.nonce, createUuid("factor"), update.userId);
      }
      // Interrupted ceremonies must not finish under the old key. Re-enrol through a new grant.
      this.database.exec("DELETE FROM user_totp_registrations; DELETE FROM user_totp_enrolments; DELETE FROM user_auth_invitations; DELETE FROM user_passkey_registrations; DELETE FROM webauthn_enrollments; DELETE FROM web_sessions;");
      return { rotated: updates.length };
    }).immediate();
  }

  /** Verify one selected account; never enumerate seeds to identify a user from a six-digit code. */
  async verifyLogin(username: string, code: string): Promise<VerifiedTotp | null> {
    const user = this.database.query("SELECT id FROM users WHERE username=? COLLATE NOCASE AND enabled=1 AND home_chat_jid IS NOT NULL")
      .get(username.trim().toLowerCase()) as {id:string} | null;
    const row = user ? this.database.query("SELECT user_id,ciphertext,salt,nonce,revision,last_used_step FROM user_totp_factors WHERE user_id=?").get(user.id) as Factor | null : null;
    // Equal KDF work for unknown/disabled accounts; caller also rate limits by IP/account.
    if (!row) { await this.key(new Uint8Array(16)); return null; }
    const step = matchTotpStep(await this.decrypt(row), code, this.now());
    if (step === null || step <= row.last_used_step) return null;
    const used = this.database.query(`UPDATE user_totp_factors SET last_used_step=?
      WHERE user_id=? AND revision=? AND last_used_step<?
      AND EXISTS (SELECT 1 FROM users WHERE id=? AND enabled=1 AND home_chat_jid IS NOT NULL)`)
      .run(step,row.user_id,row.revision,step,row.user_id);
    return used.changes === 1 ? { userId: row.user_id, factorRevision: row.revision, step } : null;
  }
}
