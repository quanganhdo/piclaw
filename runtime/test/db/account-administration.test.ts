import { afterEach, beforeEach, expect, test } from "bun:test";
import "../helpers.js";
import { closeDatabase, getDb, initDatabase } from "../../src/db/connection.js";
import { getUser } from "../../src/db/users.js";
import { createWebSession } from "../../src/db/web-sessions.js";
import { listManagedAccounts, provisionFamilyAccount, updateManagedAccount, updateOwnAccount, listOwnSessions, revokeOwnSession, listOwnFactors, removeOwnFactor, readOwnAccountSettings, readAdministrationSettings } from "../../src/db/account-administration.js";
import { getRootOwnership } from "../../src/db/session-ownership.js";
import { resolveRequestPrincipal } from "../../src/channels/web/auth/principal.js";
import type { AuthenticatedPrincipal } from "../../src/core/access-types.js";
import { RequestRouterService } from "../../src/channels/web/request-router-service.js";
import { WebAuthGateway } from "../../src/channels/web/auth/auth-gateway.js";
import { TotpFailureTracker } from "../../src/channels/web/auth/totp-failure-tracker.js";
import { WebauthnChallengeTracker } from "../../src/channels/web/auth/webauthn-challenges.js";

let admin: AuthenticatedPrincipal;
const policy = { totp: true, passkey: true, rpId: "family.local" };
function actor(userId: string): AuthenticatedPrincipal {
  const user = getUser(getDb(), userId)!;
  const login = createWebSession(`token-${userId}`, userId, 3600, "passkey");
  return resolveRequestPrincipal(new Request("https://family.local", { headers: { cookie: "piclaw_session=fixture" } }), { mode: "family-shared", authEnabled: true }, {
    getSession: () => login, getUser: () => user, getLocalDisplayName: () => "Unused",
  })!;
}
function passkey(userId: string, id = `cred-${userId}`) {
  getDb().query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key,sign_count,created_at) VALUES (?,'family.local',?,'key',0,?)").run(userId, id, new Date().toISOString());
}
function member(name = "alice") {
  const user = provisionFamilyAccount(getDb(), admin, { username: name, displayName: name });
  passkey(user.id); updateManagedAccount(getDb(), admin, user.id, { enabled: true }, policy);
  return actor(user.id);
}
beforeEach(() => { closeDatabase(); initDatabase(); admin = actor("default"); });
afterEach(() => closeDatabase());

test("provisioning creates a disabled owned home atomically and rolls back duplicate account", () => {
  const db = getDb();
  const user = provisionFamilyAccount(db, admin, { username: "Alice", displayName: "Alice" });
  expect(user.enabled).toBe(false); expect(user.home_chat_jid).toBeTruthy();
  expect(getRootOwnership(db, user.home_chat_jid!)?.ownerUserId).toBe(user.id);
  expect((db.query("SELECT handle_owner_id,agent_name FROM chat_branches WHERE chat_jid=?").get(user.home_chat_jid!) as any)).toEqual({ handle_owner_id: user.id, agent_name: "home" });
  expect(() => provisionFamilyAccount(db, admin, { username: "alice", displayName: "Duplicate" })).toThrow();
  expect((db.query("SELECT count(*) n FROM chats").get() as any).n).toBe(1);
  expect(() => updateManagedAccount(db, admin, user.id, { enabled: true }, policy)).toThrow("authentication factor");
  passkey(user.id);
  expect(() => updateManagedAccount(db, admin, user.id, { enabled: true }, { ...policy, passkey: false })).toThrow();
  expect(updateManagedAccount(db, admin, user.id, { enabled: true }, policy).enabled).toBe(true);
});

test("members and stale admin snapshots cannot administer accounts or elevate themselves", () => {
  const alice = member();
  expect(() => listManagedAccounts(getDb(), alice)).toThrow("Session access denied");
  expect(() => provisionFamilyAccount(getDb(), alice, { username: "evil", displayName: "Evil" })).toThrow();
  expect(() => updateOwnAccount(getDb(), alice, { role: "admin" } as any)).toThrow();
  expect(updateOwnAccount(getDb(), alice, { displayName: "New name" }).display_name).toBe("New name");
  getDb().query("UPDATE web_sessions SET created_at=? WHERE session_id=?").run(new Date(Date.now() - 3600_000).toISOString(), admin.authentication.sessionId!);
  expect(() => provisionFamilyAccount(getDb(), admin, { username: "late", displayName: "Late" })).toThrow();
  getDb().query("DELETE FROM web_sessions WHERE session_id=?").run(admin.authentication.sessionId!);
  expect(() => listManagedAccounts(getDb(), admin)).toThrow();
});

test("disable and role transitions revoke devices and last enabled administrator is protected", () => {
  const alice = member();
  expect(listOwnSessions(getDb(), alice)).toHaveLength(1);
  updateManagedAccount(getDb(), admin, alice.userId, { enabled: false }, policy);
  expect((getDb().query("SELECT count(*) n FROM web_sessions WHERE user_id=?").get(alice.userId) as any).n).toBe(0);
  expect(() => listOwnSessions(getDb(), alice)).toThrow();
  expect(() => updateManagedAccount(getDb(), admin, "default", { enabled: false }, policy)).toThrow("last enabled admin");
  expect(() => updateManagedAccount(getDb(), admin, "default", { role: "member" }, policy)).toThrow("last enabled admin");
  updateManagedAccount(getDb(), admin, alice.userId, { enabled: true, role: "admin" }, policy);
  updateManagedAccount(getDb(), admin, "default", { role: "member" }, policy);
  expect(() => listManagedAccounts(getDb(), admin)).toThrow();
});

test("factor removal is owner-local, atomic, policy-aware and revokes all target devices", () => {
  const alice = member(), bob = member("bob");
  expect(() => removeOwnFactor(getDb(), alice, { kind: "passkey", credentialId: `cred-${bob.userId}` }, policy)).toThrow();
  expect(() => removeOwnFactor(getDb(), alice, { kind: "passkey", credentialId: `cred-${alice.userId}` }, policy)).toThrow("last configured");
  expect(listOwnFactors(getDb(), alice).passkeys).toHaveLength(1);
  passkey(alice.userId, "second-key");
  removeOwnFactor(getDb(), alice, { kind: "passkey", credentialId: "second-key" }, policy);
  expect(() => listOwnSessions(getDb(), alice)).toThrow();
  const fresh = actor(alice.userId);
  expect(listOwnFactors(getDb(), fresh).passkeys).toHaveLength(1);
  expect(listOwnSessions(getDb(), bob)).toHaveLength(1);
  const data = JSON.stringify(listOwnFactors(getDb(), fresh));
  expect(data).not.toContain("public_key"); expect(data).not.toContain("token");
});

test("device revocation never discloses or revokes another owner and omits token material", () => {
  const alice = member(), bob = member("bob");
  const devices = listOwnSessions(getDb(), alice);
  expect(JSON.stringify(devices)).not.toContain(`token-${alice.userId}`);
  expect(JSON.stringify(devices)).not.toContain('"token"');
  revokeOwnSession(getDb(), alice, bob.authentication.sessionId!);
  expect(listOwnSessions(getDb(), bob)).toHaveLength(1);
  revokeOwnSession(getDb(), alice, alice.authentication.sessionId!);
  expect(() => listOwnSessions(getDb(), alice)).toThrow();
});

test("account HTTP routes enforce cookies, Origin, role and strict payloads without transcript access", async () => {
  const json = (body: unknown, status = 200) => Response.json(body, { status });
  const gateway = new WebAuthGateway({ accessMode: "family-shared", passkeyMode: "", totpSecret: "", internalSecret: "secret", sessionTtlSeconds: 3600, hasTls: true }, {
    json, challenges: new WebauthnChallengeTracker(), failureTracker: new TotpFailureTracker(),
  });
  const router = new RequestRouterService({ json, authGateway: gateway } as any, "family-shared");
  const req = (path: string, method = "GET", body?: unknown, userId = "default", origin: string | null = "https://family.local") => router.handle(new Request(`https://family.local${path}`, {
    method, headers: { cookie: `piclaw_session=token-${userId}`, "x-piclaw-internal-secret": "secret", ...(origin ? { origin } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
  }));
  for (const origin of [null, "https://other.local"]) expect((await req("/admin/users", "POST", { username: "alice", displayName: "Alice" }, "default", origin)).status).toBe(403);
  const created = await req("/admin/users", "POST", { username: "alice", displayName: "Alice" });
  expect(created.status).toBe(201); expect(created.headers.get("cache-control")).toBe("private, no-store");
  const user = (await created.json()).user;
  expect(user.enabled).toBe(false);
  expect((await req(`/admin/users/${user.id}`, "PATCH", { enabled: true })).status).toBe(400);
  passkey(user.id); expect((await req(`/admin/users/${user.id}`, "PATCH", { enabled: true })).status).toBe(200);
  actor(user.id);
  expect((await req("/admin/users", "GET", undefined, user.id)).status).toBe(403);
  expect((await req("/account", "PATCH", { role: "admin" }, user.id)).status).toBe(403);
  expect((await req("/account", "PATCH", { home_chat_jid: "web:foreign" }, user.id)).status).toBe(403);
  const devices = await req("/account/sessions", "GET", undefined, user.id);
  expect(devices.status).toBe(200); expect(await devices.text()).not.toContain(`token-${user.id}`);
  expect((await req("/admin/users", "POST", { username: "evil", displayName: "Evil", enabled: true })).status).toBe(400);
  const denied = await req(`/timeline?chat_jid=${user.home_chat_jid}`);
  expect(denied.status).toBe(403);
});

test("last-factor checks honour TOTP-only policy and rollback both deletion and revocation", () => {
  const alice = member();
  getDb().query("INSERT INTO user_totp_factors(user_id,ciphertext,salt,nonce,revision,last_used_step,created_at) VALUES (?,?,?,?,?,-1,?)")
    .run(alice.userId, new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3]), "revision", new Date().toISOString());
  expect(() => removeOwnFactor(getDb(), alice, { kind: "totp" }, { ...policy, passkey: false })).toThrow("last configured");
  expect(listOwnFactors(getDb(), alice).totp).toBe(true);
  expect(listOwnSessions(getDb(), alice)).toHaveLength(1);
  removeOwnFactor(getDb(), alice, { kind: "totp" }, policy);
  expect(() => listOwnSessions(getDb(), alice)).toThrow();
  const fresh = actor(alice.userId);
  expect(listOwnFactors(getDb(), fresh).totp).toBe(false);
  expect(listOwnFactors(getDb(), fresh).passkeys).toHaveLength(1);
});

test("a passkey for another RP cannot satisfy enablement or last-factor policy", () => {
  const user = provisionFamilyAccount(getDb(), admin, { username: "alice", displayName: "Alice" });
  passkey(user.id);
  expect(() => updateManagedAccount(getDb(), admin, user.id, { enabled: true }, { ...policy, rpId: "other.local" })).toThrow("authentication factor");
  updateManagedAccount(getDb(), admin, user.id, { enabled: true }, policy);
  const alice = actor(user.id);
  passkey(user.id, "other-key");
  getDb().exec("UPDATE webauthn_credentials SET rp_id='other.local' WHERE credential_id='other-key'");
  expect(() => removeOwnFactor(getDb(), alice, { kind: "passkey", credentialId: `cred-${user.id}` }, policy)).toThrow("last configured");
  expect(listOwnFactors(getDb(), alice).passkeys).toHaveLength(2);
});

test("account snapshot is owner-only, policy-aware, metadata-only and distinguishes current login", () => {
  const alice = member(), bob = member("bob"), db = getDb();
  const other = createWebSession("alice-other", alice.userId, 3600, "passkey");
  let snapshot = readOwnAccountSettings(db, alice, policy);
  expect(snapshot.user.id).toBe(alice.userId);
  expect(snapshot.capabilities).toEqual({ update_profile: true, register_passkey: true, enrol_totp: true, revoke_session: true, label_security_item: true });
  expect(snapshot.sessions.filter(s => s.current).map(s => s.session_id)).toEqual([alice.authentication.sessionId!]);
  expect(snapshot.sessions.find(s => s.session_id === other.session_id)?.current).toBe(false);
  expect(snapshot.factors.passkeys[0]?.removable).toBe(false);
  const json = JSON.stringify(snapshot);
  for (const secret of [bob.userId, "alice-other", "public_key", "token", "ciphertext", "home_chat_jid"]) expect(json).not.toContain(secret);
  passkey(alice.userId, "second"); passkey(alice.userId, "other-rp");
  db.exec("UPDATE webauthn_credentials SET rp_id='other.local' WHERE credential_id='other-rp'");
  snapshot = readOwnAccountSettings(db, alice, policy);
  expect(snapshot.factors.passkeys.every(k => k.removable)).toBe(true);
  expect(snapshot.factors.passkeys.find(k => k.credential_id === "other-rp")?.usable).toBe(false);
  const disabled = readOwnAccountSettings(db, alice, { ...policy, passkey: false });
  expect(disabled.capabilities.register_passkey).toBe(false);
  expect(disabled.factors.passkeys.every(k => !k.removable && !k.usable)).toBe(true);
  db.query("UPDATE web_sessions SET created_at=? WHERE session_id=?").run(new Date(Date.now()-600_000).toISOString(), alice.authentication.sessionId!);
  snapshot = readOwnAccountSettings(db, alice, policy);
  expect(snapshot.recent_auth).toBe(false);
  expect(Object.values(snapshot.capabilities).every(v => !v)).toBe(true);
  expect(snapshot.factors.passkeys.every(k => !k.removable)).toBe(true);
  expect(() => updateOwnAccount(db, alice, { displayName: "stale write" })).toThrow();
  db.query("DELETE FROM web_sessions WHERE session_id=?").run(alice.authentication.sessionId!);
  expect(() => readOwnAccountSettings(db, alice, policy)).toThrow();
});

test("account snapshot matches TOTP last-factor policy and serves pinned no-store HTTP without selectors", async () => {
  const alice = member(), db = getDb();
  db.query("INSERT INTO user_totp_factors(user_id,ciphertext,salt,nonce,revision,last_used_step,created_at) VALUES (?,?,?,?,?,-1,?)")
    .run(alice.userId, new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3]), "revision", new Date().toISOString());
  expect(readOwnAccountSettings(db, alice, policy).factors.totp.removable).toBe(true);
  expect(readOwnAccountSettings(db, alice, { ...policy, passkey: false }).factors.totp.removable).toBe(false);
  const json = (value: unknown, status = 200) => Response.json(value, { status });
  const gateway = new WebAuthGateway({ accessMode: "family-shared", passkeyMode: "", totpSecret: "", internalSecret: "", sessionTtlSeconds: 3600, hasTls: true }, {
    json, challenges: new WebauthnChallengeTracker(), failureTracker: new TotpFailureTracker(),
  });
  const router = new RequestRouterService({ json, authGateway: gateway } as any, "family-shared");
  const request = (query = "", pin = alice.userId) => router.handle(new Request("https://family.local/account"+query, { headers: {
    cookie: `piclaw_session=token-${alice.userId}`, "x-piclaw-account-id": pin, "x-piclaw-login-id": alice.authentication.sessionId!,
  } }));
  const response = await request(); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toContain("Cookie"); expect((await response.json()).user.id).toBe(alice.userId);
  expect((await request("?user_id=default")).status).toBe(403);
  expect((await request("", "default")).status).toBe(409);
});

test('administration snapshot protects last admin, invitation eligibility and current-site factors without content', () => {
  const db = getDb(), alice = member();
  const pending = provisionFamilyAccount(db, admin, { username: 'pending', displayName: 'Pending' });
  let snapshot = readAdministrationSettings(db, admin, policy);
  const caps = (id: string) => snapshot.users.find(u => u.id === id)!.capabilities;
  expect(snapshot.capabilities.create_user).toBe(true);
  expect(caps('default').disable).toBe(false); expect(caps('default').change_role).toBe(false); expect(caps('default').reset).toBe(false);
  expect(caps(alice.userId).disable).toBe(true); expect(caps(alice.userId).reset).toBe(true); expect(caps(alice.userId).invite).toBe(false);
  expect(caps(pending.id).enable).toBe(false); expect(caps(pending.id).invite).toBe(true);
  for (const field of ['home_chat_jid', 'credential_id', 'session_id', 'public_key', 'token', 'ciphertext']) expect(JSON.stringify(snapshot)).not.toContain(field);
  db.query("INSERT INTO user_auth_invitations(token_hash,user_id,issuer_user_id,expires_at,state,created_at) VALUES ('private-hash',?,?,?,'issued',?)").run(pending.id, admin.userId, Date.now()+60_000, new Date().toISOString());
  snapshot = readAdministrationSettings(db, admin, policy);
  expect(snapshot.users.find(u => u.id === pending.id)?.invitation).toBe('issued'); expect(caps(pending.id).revoke_invitation).toBe(true);
  expect(JSON.stringify(snapshot)).not.toContain('private-hash');
  passkey(pending.id); snapshot = readAdministrationSettings(db, admin, policy);
  expect(caps(pending.id).invite).toBe(false); expect(caps(pending.id).enable).toBe(true);
  snapshot = readAdministrationSettings(db, admin, { ...policy, rpId: 'other.local', totp: false });
  expect(caps(pending.id).enable).toBe(false); expect(caps(pending.id).invite).toBe(false); expect(caps(alice.userId).reset).toBe(false);
  expect(() => readAdministrationSettings(db, alice, policy)).toThrow();
  db.query('UPDATE web_sessions SET created_at=? WHERE session_id=?').run(new Date(Date.now()-600_000).toISOString(), admin.authentication.sessionId!);
  snapshot = readAdministrationSettings(db, admin, policy); expect(snapshot.recent_auth).toBe(false); expect(snapshot.capabilities.create_user).toBe(false);
  expect(snapshot.users.every(u => Object.values(u.capabilities).every(value => !value))).toBe(true);
  db.query('DELETE FROM web_sessions WHERE session_id=?').run(admin.authentication.sessionId!);
  expect(() => readAdministrationSettings(db, admin, policy)).toThrow();
});

test('administration snapshot route is pinned, no-store, selector-free and admin-only', async () => {
  const alice = member(), db = getDb();
  const json = (value: unknown, status=200) => Response.json(value, { status });
  const authGateway = new WebAuthGateway({ accessMode: 'family-shared', passkeyMode: '', totpSecret: '', internalSecret: '', hasTls: true, sessionTtlSeconds: 3600 }, { json, challenges: new WebauthnChallengeTracker(), failureTracker: new TotpFailureTracker() });
  const router = new RequestRouterService({ json, authGateway } as any, 'family-shared');
  const req = (who = admin, query = '', pin = who.userId) => router.handle(new Request('https://family.local/admin/users/settings'+query, { headers: { cookie: `piclaw_session=token-${who.userId}`, 'x-piclaw-account-id': pin, 'x-piclaw-login-id': who.authentication.sessionId! } }));
  const response = await req(); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(response.headers.get('vary')).toContain('Cookie');
  expect((await response.json()).users.map((u: any) => u.id)).toContain(alice.userId);
  expect((await req(alice)).status).toBe(403); expect((await req(admin, '?user_id='+alice.userId)).status).toBe(403); expect((await req(admin, '', alice.userId)).status).toBe(409);
  // Metadata visibility does not grant conversation authority.
  const timeline = await router.handle(new Request('https://family.local/timeline?chat_jid='+alice.homeChatJid, { headers: { cookie: 'piclaw_session=token-default' } }));
  expect(timeline.status).toBe(403);
  db.query("UPDATE users SET role='member' WHERE id='default'").run(); expect((await req()).status).toBe(403);
});
