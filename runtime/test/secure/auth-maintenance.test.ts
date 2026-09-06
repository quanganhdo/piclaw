import { beforeEach, afterEach, expect, test } from "bun:test";
import "../helpers.js";
import { createHmac } from "node:crypto";
import { closeDatabase, initDatabase, getDb } from "../../src/db/connection.js";
import { createUser, updateUser } from "../../src/db/users.js";
import { createWebSession } from "../../src/db/web-sessions.js";
import { pruneExpiredAuthState } from "../../src/db/auth-maintenance.js";
import { startAuthMaintenance } from "../../src/runtime/auth-maintenance.js";
import { UserAuthFactors } from "../../src/secure/user-auth-factors.js";

let clock: number, alice: string, bob: string;
function code(secret: string, time = clock) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, buffer = 0; const bytes: number[] = [];
  for (const char of secret) { buffer = (buffer << 5) | alphabet.indexOf(char); bits += 5; if (bits >= 8) { bits -= 8; bytes.push((buffer >> bits) & 255); } }
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(time / 30_000)));
  const h = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  return (h.readUInt32BE(h[h.length-1]! & 15) % 0x80000000 % 1_000_000).toString().padStart(6, "0");
}
beforeEach(() => {
  closeDatabase(); initDatabase(); clock = Date.now();
  alice = createUser(getDb(), { username: "alice", displayName: "Alice" }).id;
  bob = createUser(getDb(), { username: "bob", displayName: "Bob" }).id;
});
afterEach(() => closeDatabase());

async function enrolled(userId: string, material = "old-key") {
  const factors = new UserAuthFactors(getDb(), () => material, () => clock);
  const enrol = await factors.beginEnrolment(userId);
  expect(await factors.confirmEnrolment(userId, enrol.token, code(enrol.secret))).toBe(true);
  updateUser(getDb(), userId, { enabled: true });
  getDb().query("UPDATE users SET home_chat_jid=? WHERE id=?").run(`web:${userId}`, userId);
  return enrol.secret;
}

test("pruning removes only expired/orphaned transient auth state, preserving factors and accounts", async () => {
  await enrolled(alice);
  createWebSession("valid", alice, 3600, "totp"); const dead = createWebSession("dead", bob, 3600, "totp");
  getDb().query("UPDATE web_sessions SET expires_at='bad' WHERE session_id=?").run(dead.session_id!);
  getDb().query("INSERT INTO user_auth_invitations(token_hash,user_id,issuer_user_id,expires_at,state,created_at) VALUES ('old',?,'default',?,'issued','now')").run(bob, clock-1);
  const pending = await new UserAuthFactors(getDb(), () => "old-key", () => clock).beginEnrolment(bob);
  expect(pending.token).toBeTruthy();
  getDb().query("UPDATE user_totp_enrolments SET expires_at=? WHERE user_id=?").run(clock-1, bob);
  getDb().query("INSERT INTO user_passkey_registrations(token_hash,user_id,session_id,rp_id,origin,challenge,expires_at) VALUES ('orphan',?,'missing','local','https://local','challenge',?)").run(alice, clock+10000);
  getDb().exec("INSERT INTO webauthn_enrollments(token,user_id,created_at,expires_at) VALUES ('bad','default','now','invalid')");
  getDb().query("INSERT INTO user_auth_attempts(bucket,count,reset_at) VALUES ('old',1,?),('live',1,?)").run(clock-1, clock+10000);
  expect(pruneExpiredAuthState(getDb(), clock)).toEqual({ sessions: 1, invitations: 1, totpEnrolments: 1, totpRegistrations: 0, passkeyRegistrations: 1, legacyEnrolments: 1, attempts: 1 });
  expect((getDb().query("SELECT count(*) n FROM user_totp_factors").get() as any).n).toBe(1);
  expect((getDb().query("SELECT count(*) n FROM users").get() as any).n).toBe(3);
  expect((getDb().query("SELECT count(*) n FROM web_sessions").get() as any).n).toBe(1);
  expect(Object.values(pruneExpiredAuthState(getDb(), clock))).toEqual([0,0,0,0,0,0,0]);
  expect(() => pruneExpiredAuthState(getDb(), NaN)).toThrow();
});

test("cleanup loop is idempotent, prunes immediately and stops without keeping process alive", () => {
  startAuthMaintenance()(); // A preceding runtime startup test may have installed the singleton.
  getDb().query("INSERT INTO user_auth_attempts VALUES ('expired',1,?)").run(clock-1);
  const stop = startAuthMaintenance();
  expect(startAuthMaintenance()).toBe(stop);
  expect((getDb().query("SELECT count(*) n FROM user_auth_attempts").get() as any).n).toBe(0);
  stop(); stop();
  const restarted = startAuthMaintenance(); expect(restarted).not.toBe(stop); restarted();
});

test("offline re-encryption preserves seeds and replay steps while revoking transient authority", async () => {
  const a = await enrolled(alice), b = await enrolled(bob);
  createWebSession("login", alice, 3600, "totp");
  const before = getDb().query("SELECT user_id,revision,last_used_step FROM user_totp_factors ORDER BY user_id").all() as any[];
  const old = new UserAuthFactors(getDb(), () => "old-key", () => clock);
  expect(await old.rotateFactorEncryption(() => "new-key")).toEqual({ rotated: 2 });
  const after = getDb().query("SELECT user_id,revision,last_used_step FROM user_totp_factors ORDER BY user_id").all() as any[];
  expect(after.map(row => row.last_used_step)).toEqual(before.map(row => row.last_used_step));
  expect(after.map(row => row.revision)).not.toEqual(before.map(row => row.revision));
  expect((getDb().query("SELECT count(*) n FROM web_sessions").get() as any).n).toBe(0);
  clock += 30_000;
  const current = new UserAuthFactors(getDb(), () => "new-key", () => clock);
  expect((await current.verifyLogin("alice", code(a)))?.userId).toBe(alice);
  expect((await current.verifyLogin("bob", code(b)))?.userId).toBe(bob);
  await expect(old.verifyLogin("alice", code(a))).rejects.toThrow();
  expect(await current.verifyLogin("alice", code(a))).toBeNull();
});

test("wrong old key and concurrent factor changes cannot partially rotate ciphertext", async () => {
  const secret = await enrolled(alice); await enrolled(bob);
  const snapshot = () => JSON.stringify(getDb().query("SELECT * FROM user_totp_factors ORDER BY user_id").all());
  const before = snapshot();
  await expect(new UserAuthFactors(getDb(), () => "wrong-key").rotateFactorEncryption(() => "new-key")).rejects.toThrow();
  expect(snapshot()).toBe(before);
  const old = new UserAuthFactors(getDb(), () => "old-key");
  // The constructor's old-key equality check executes before the snapshot; change during decrypt instead.
  let calls = 0;
  const racing = new UserAuthFactors(getDb(), () => { if (++calls === 2) getDb().query("UPDATE user_totp_factors SET last_used_step=last_used_step+1 WHERE user_id=?").run(alice); return "old-key"; });
  await expect(racing.rotateFactorEncryption(() => "new-key")).rejects.toThrow("changed during offline rotation");
  clock += 60_000;
  expect((await new UserAuthFactors(getDb(), () => "old-key", () => clock).verifyLogin("alice", code(secret)))?.userId).toBe(alice);
  await expect(old.rotateFactorEncryption(() => "old-key")).rejects.toThrow("distinct");
});
