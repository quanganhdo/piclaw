import { afterEach, beforeEach, expect, test } from "bun:test";
import "../helpers.js";
import { closeDatabase, getDb, initDatabase } from "../../src/db/connection.js";
import { getUser } from "../../src/db/users.js";
import { createWebSession } from "../../src/db/web-sessions.js";
import { provisionFamilyAccount, updateManagedAccount } from "../../src/db/account-administration.js";
import { resetFamilyAccount } from "../../src/secure/account-recovery.js";
import { resolveRequestPrincipal } from "../../src/channels/web/auth/principal.js";
import type { AuthenticatedPrincipal } from "../../src/core/access-types.js";
import { RequestRouterService } from "../../src/channels/web/request-router-service.js";
import { WebAuthGateway } from "../../src/channels/web/auth/auth-gateway.js";
import { TotpFailureTracker } from "../../src/channels/web/auth/totp-failure-tracker.js";
import { WebauthnChallengeTracker } from "../../src/channels/web/auth/webauthn-challenges.js";

let admin: AuthenticatedPrincipal, member: AuthenticatedPrincipal;
function actor(id: string): AuthenticatedPrincipal {
  const login = createWebSession(`token-${id}`, id, 3600, "passkey");
  return resolveRequestPrincipal(new Request("https://family.local", { headers: { cookie: "piclaw_session=fixture" } }), { mode: "family-shared", authEnabled: true }, {
    getSession: () => login, getUser: () => getUser(getDb(), id), getLocalDisplayName: () => "unused",
  })!;
}
beforeEach(() => {
  closeDatabase(); initDatabase(); admin = actor("default");
  const user = provisionFamilyAccount(getDb(), admin, { username: "alice", displayName: "Alice" });
  getDb().query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key,sign_count) VALUES (?,'family.local','first','key',0),(?,'family.local','second','key2',0)").run(user.id, user.id);
  getDb().query("INSERT INTO user_totp_factors(user_id,ciphertext,salt,nonce,revision,created_at,last_used_step) VALUES (?,?,?,?,?,?,-1)").run(user.id, new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3]), "revision", new Date().toISOString());
  updateManagedAccount(getDb(), admin, user.id, { enabled: true }, { totp: true, passkey: true, rpId: "family.local" });
  member = actor(user.id);
});
afterEach(() => closeDatabase());

test("admin reset preserves owner/session IDs, removes every factor/login and issues a restricted grant", () => {
  const db = getDb(); const before = getUser(db, member.userId)!;
  const branches = db.query("SELECT * FROM chat_branches").all(); const roots = db.query("SELECT * FROM session_roots").all();
  const grant = resetFamilyAccount(db, admin, member.userId, "alice");
  expect(grant.token).toHaveLength(43);
  expect(getUser(db, member.userId)).toMatchObject({ id: before.id, username: "alice", home_chat_jid: before.home_chat_jid, enabled: false, role: before.role });
  expect(db.query("SELECT * FROM chat_branches").all()).toEqual(branches); expect(db.query("SELECT * FROM session_roots").all()).toEqual(roots);
  for (const table of ["web_sessions", "user_totp_factors", "webauthn_credentials", "user_totp_enrolments", "webauthn_enrollments", "user_passkey_registrations"]) {
    expect((db.query(`SELECT count(*) n FROM ${table} WHERE user_id=?`).get(member.userId) as any).n).toBe(0);
  }
  const record = db.query("SELECT * FROM user_auth_invitations WHERE user_id=?").get(member.userId);
  expect(JSON.stringify(record)).not.toContain(grant.token);
  const audit = db.query("SELECT * FROM account_recovery_events").all();
  expect(audit).toHaveLength(1); expect(JSON.stringify(audit)).not.toContain(grant.token); expect(audit[0]).toMatchObject({ actor_user_id: admin.userId, target_user_id: member.userId, event: "admin_reset" });
});

test("member, self-reset, wrong confirmation and stale administrator requests cannot delete factors", () => {
  for (const run of [() => resetFamilyAccount(getDb(), member, "default", "default"), () => resetFamilyAccount(getDb(), admin, "default", "default"), () => resetFamilyAccount(getDb(), admin, member.userId, "wrong")]) expect(run).toThrow("Session access denied");
  getDb().query("UPDATE web_sessions SET created_at=? WHERE session_id=?").run(new Date(Date.now() - 3600_000).toISOString(), admin.authentication.sessionId!);
  expect(() => resetFamilyAccount(getDb(), admin, member.userId, "alice")).toThrow();
  expect((getDb().query("SELECT count(*) n FROM webauthn_credentials WHERE user_id=?").get(member.userId) as any).n).toBe(2);
  expect(getUser(getDb(), member.userId)?.enabled).toBe(true);
});

test("grant or audit write failure rolls back disabling, factor deletion and session revocation", () => {
  const db = getDb();
  db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON account_recovery_events BEGIN SELECT RAISE(ABORT,'audit failure'); END;");
  expect(() => resetFamilyAccount(db, admin, member.userId, "alice")).toThrow("audit failure");
  expect(getUser(db, member.userId)?.enabled).toBe(true);
  expect((db.query("SELECT count(*) n FROM webauthn_credentials WHERE user_id=?").get(member.userId) as any).n).toBe(2);
  expect((db.query("SELECT count(*) n FROM web_sessions WHERE user_id=?").get(member.userId) as any).n).toBe(1);
  expect((db.query("SELECT count(*) n FROM user_auth_invitations").get() as any).n).toBe(0);
});

test("HTTP reset requires explicit username confirmation, matching Origin and TOTP-capable recovery policy", async () => {
  const json = (body: unknown, status=200) => Response.json(body, { status });
  const config = { accessMode: "family-shared" as const, passkeyMode: "", totpSecret: "", internalSecret: "secret", sessionTtlSeconds: 3600, hasTls: true };
  const gateway = new WebAuthGateway(config, { json, challenges: new WebauthnChallengeTracker(), failureTracker: new TotpFailureTracker() });
  const router = new RequestRouterService({ json, authGateway: gateway } as any, "family-shared");
  const post = (body: unknown, origin: string | null = "https://family.local") => router.handle(new Request(`https://family.local/admin/users/${member.userId}/reset`, {
    method: "POST", headers: { cookie: "piclaw_session=token-default", "x-piclaw-internal-secret": "secret", ...(origin ? { origin } : {}) }, body: JSON.stringify(body),
  }));
  for (const origin of [null, "https://foreign.local"]) expect((await post({ confirm_username: "alice" }, origin)).status).toBe(403);
  expect((await post({ confirm_username: "alice", enabled: true })).status).toBe(403);
  expect((await post({ confirm_username: "bob" })).status).toBe(403);
  config.passkeyMode = "passkey-only";
  expect((await post({ confirm_username: "alice" })).status).toBe(403);
  expect(getUser(getDb(), member.userId)?.enabled).toBe(true);
  config.passkeyMode = "";
  const response = await post({ confirm_username: "alice" });
  expect(response.status).toBe(201); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("set-cookie")).toBeNull(); expect((await response.json()).token).toHaveLength(43);
});
