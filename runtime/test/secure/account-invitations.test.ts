import { afterEach, beforeEach, expect, test } from "bun:test";
import { closeDatabase, getDb, initDatabase } from "../../src/db/connection.js";
import { getUser } from "../../src/db/users.js";
import { createWebSession } from "../../src/db/web-sessions.js";
import { provisionFamilyAccount, updateManagedAccount } from "../../src/db/account-administration.js";
import { AccountInvitations } from "../../src/secure/account-invitations.js";
import { UserAuthFactors } from "../../src/secure/user-auth-factors.js";
import { resolveRequestPrincipal } from "../../src/channels/web/auth/principal.js";
import { createHmac } from "node:crypto";
function generateTotp(secret: string, time = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, buffer = 0; const bytes: number[] = [];
  for (const c of secret) { buffer = (buffer << 5) | alphabet.indexOf(c); bits += 5; if (bits >= 8) { bits -= 8; bytes.push((buffer >> bits) & 255); } }
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(time / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest(); const offset = digest[digest.length - 1]! & 15;
  return (digest.readUInt32BE(offset) % 0x80000000 % 1_000_000).toString().padStart(6, "0");
}
import { createTempWorkspace, setEnv } from "../helpers.js";
import type { AuthenticatedPrincipal } from "../../src/core/access-types.js";
import { RequestRouterService } from "../../src/channels/web/request-router-service.js";
import { WebAuthGateway } from "../../src/channels/web/auth/auth-gateway.js";
import { TotpFailureTracker } from "../../src/channels/web/auth/totp-failure-tracker.js";
import { WebauthnChallengeTracker } from "../../src/channels/web/auth/webauthn-challenges.js";

let admin: AuthenticatedPrincipal, userId: string, service: AccountInvitations, clock: number;
let ws: ReturnType<typeof createTempWorkspace>, restore: () => void;
const origin = "https://family.local";
beforeEach(() => {
  ws = createTempWorkspace("piclaw-invitation-");
  restore = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data, PICLAW_KEYCHAIN_KEY: "test-invitation-key" });
  closeDatabase(); initDatabase();
  const login = createWebSession("admin-token", "default", 3600, "passkey");
  admin = resolveRequestPrincipal(new Request(origin, { headers: { cookie: "piclaw_session=fixture" } }), { mode: "family-shared", authEnabled: true }, {
    getSession: () => login, getUser: () => getUser(getDb(), "default"), getLocalDisplayName: () => "Unused",
  })!;
  userId = provisionFamilyAccount(getDb(), admin, { username: "alice", displayName: "Alice" }).id;
  clock = Date.now();
  service = new AccountInvitations(getDb(), new UserAuthFactors(getDb(), () => "test-key", () => clock), () => clock);
});
afterEach(() => { closeDatabase(); restore(); ws.cleanup(); });

test("invitation secrets are hashed, claim is one-use and confirm enables only the invited user without login", async () => {
  const issued = service.issue(admin, userId);
  const stored = getDb().query("SELECT * FROM user_auth_invitations").get() as any;
  expect(stored.token_hash).toHaveLength(64); expect(JSON.stringify(stored)).not.toContain(issued.token);
  const claim = await service.claim(issued.token, origin);
  expect(claim.username).toBe("alice");
  const row = getDb().query("SELECT * FROM user_auth_invitations").get() as any;
  expect(row.state).toBe("claimed"); expect(JSON.stringify(row)).not.toContain(claim.browserToken); expect(JSON.stringify(row)).not.toContain(claim.enrolmentToken);
  expect(getUser(getDb(), userId)?.enabled).toBe(false);
  await expect(service.claim(issued.token, origin)).rejects.toThrow();
  expect(await service.confirm(issued.token, claim.browserToken, origin, claim.enrolmentToken, generateTotp(claim.secret, clock))).toBe(true);
  expect(getUser(getDb(), userId)?.enabled).toBe(true);
  expect((getDb().query("SELECT count(*) n FROM web_sessions WHERE user_id=?").get(userId) as any).n).toBe(0);
  expect((getDb().query("SELECT count(*) n FROM user_auth_invitations").get() as any).n).toBe(0);
  await expect(service.confirm(issued.token, claim.browserToken, origin, claim.enrolmentToken, generateTotp(claim.secret, clock))).rejects.toThrow();
});

test("browser, origin and enrolment token are bound to the same claim", async () => {
  const issued = service.issue(admin, userId); const claim = await service.claim(issued.token, origin);
  const code = generateTotp(claim.secret, clock);
  for (const args of [["wrong-browser", origin, claim.enrolmentToken], [claim.browserToken, "https://other.local", claim.enrolmentToken], [claim.browserToken, origin, "wrong-enrolment"]]) {
    await expect(service.confirm(issued.token, args[0]!, args[1]!, args[2]!, code)).rejects.toThrow();
  }
  expect(getUser(getDb(), userId)?.enabled).toBe(false);
  expect(await service.confirm(issued.token, claim.browserToken, origin, claim.enrolmentToken, code)).toBe(true);
});

test("concurrent claims have one winner and concurrent confirmations cannot duplicate enrolment", async () => {
  const issued = service.issue(admin, userId);
  const claims = await Promise.allSettled([service.claim(issued.token, origin), service.claim(issued.token, origin)]);
  expect(claims.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const claim = (claims.find(result => result.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof service.claim>>>).value;
  const code = generateTotp(claim.secret, clock);
  const results = await Promise.allSettled([service.confirm(issued.token, claim.browserToken, origin, claim.enrolmentToken, code), service.confirm(issued.token, claim.browserToken, origin, claim.enrolmentToken, code)]);
  expect(results.filter(result => result.status === "fulfilled" && result.value === true)).toHaveLength(1);
  expect((getDb().query("SELECT count(*) n FROM user_totp_factors WHERE user_id=?").get(userId) as any).n).toBe(1);
});

test("expiry, cancellation and repeat disable revoke invitations and pending factor state", async () => {
  let issued = service.issue(admin, userId);
  clock += 16 * 60_000;
  await expect(service.claim(issued.token, origin)).rejects.toThrow(); service.prune();
  expect((getDb().query("SELECT count(*) n FROM user_auth_invitations").get() as any).n).toBe(0);
  clock = Date.now(); issued = service.issue(admin, userId);
  const claim = await service.claim(issued.token, origin);
  service.revoke(admin, userId);
  await expect(service.confirm(issued.token, claim.browserToken, origin, claim.enrolmentToken, generateTotp(claim.secret, clock))).rejects.toThrow();
  expect((getDb().query("SELECT count(*) n FROM user_totp_enrolments").get() as any).n).toBe(0);
  issued = service.issue(admin, userId);
  updateManagedAccount(getDb(), admin, userId, { enabled: false }, { totp: true, passkey: true, rpId: "family.local" });
  await expect(service.claim(issued.token, origin)).rejects.toThrow();
});

test("admin reissue invalidates the old grant and stale admin auth cannot issue new ones", async () => {
  const first = service.issue(admin, userId); const second = service.issue(admin, userId);
  await expect(service.claim(first.token, origin)).rejects.toThrow();
  expect((await service.claim(second.token, origin)).secret).toBeTruthy();
  getDb().query("UPDATE web_sessions SET created_at=? WHERE session_id=?").run(new Date(Date.now() - 3600_000).toISOString(), admin.authentication.sessionId!);
  expect(() => service.issue(admin, userId)).toThrow();
});

test("revocation during async confirmation rolls factor insertion and account enablement back", async () => {
  const issued = service.issue(admin, userId); const claim = await service.claim(issued.token, origin);
  let once = true;
  const racing = new AccountInvitations(getDb(), new UserAuthFactors(getDb(), () => {
    if (once) { once = false; service.revoke(admin, userId); }
    return "test-key";
  }, () => clock), () => clock);
  expect(await racing.confirm(issued.token, claim.browserToken, origin, claim.enrolmentToken, generateTotp(claim.secret, clock))).toBe(false);
  expect(getUser(getDb(), userId)?.enabled).toBe(false);
  expect((getDb().query("SELECT count(*) n FROM user_totp_factors WHERE user_id=?").get(userId) as any).n).toBe(0);
});

test("restricted HTTP grants use HttpOnly browser cookies and never mint normal login sessions", async () => {
  const json = (body: unknown, status = 200) => Response.json(body, { status });
  const gateway = new WebAuthGateway({ accessMode: "family-shared", passkeyMode: "", totpSecret: "", internalSecret: "secret", sessionTtlSeconds: 3600, hasTls: true }, {
    json, challenges: new WebauthnChallengeTracker(), failureTracker: new TotpFailureTracker(),
  });
  const router = new RequestRouterService({ json, authGateway: gateway } as any, "family-shared");
  const post = (path: string, body: unknown, cookie = "", from: string | null = origin) => router.handle(new Request(origin + path, {
    method: "POST", body: JSON.stringify(body), headers: { ...(from ? { origin: from } : {}), cookie },
  }));
  const issued = await post(`/admin/users/${userId}/invitation`, {}, "piclaw_session=admin-token");
  expect(issued.status).toBe(201); const grant = await issued.json();
  for (const from of [null, "https://other.local"]) expect((await post("/auth/invitation/claim", { token: grant.token }, "", from)).status).toBe(403);
  const response = await post("/auth/invitation/claim", { token: grant.token });
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  const cookie = response.headers.get("set-cookie")!;
  expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("SameSite=Strict"); expect(cookie).toContain("Secure"); expect(cookie).not.toContain("piclaw_session=");
  const body = await response.json();
  expect(body.qr_data_url).toStartWith("data:image/svg+xml;base64,");
  const svg = Buffer.from(body.qr_data_url.split(",")[1], "base64").toString();
  expect(svg).toContain("<svg"); expect(svg).not.toContain("<script");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  const confirm = await post("/auth/invitation/confirm", { token: grant.token, enrolment_token: body.enrolment_token, code: generateTotp(body.secret) }, cookie.split(";")[0]!);
  expect(confirm.status).toBe(200); expect(await confirm.json()).toEqual({ enrolled: true, login_required: true });
  expect(confirm.headers.get("set-cookie")).not.toContain("piclaw_session=");
  const timeline = await router.handle(new Request(origin + "/timeline", { headers: { cookie: cookie.split(";")[0]! } }));
  expect(timeline.status).toBe(401);
});

test("grant revocation after verification begins rolls back an otherwise valid factor", async () => {
  const issued = service.issue(admin, userId); const claim = await service.claim(issued.token, origin);
  let once = true;
  const racing = new AccountInvitations(getDb(), new UserAuthFactors(getDb(), () => {
    if (once) { once = false; getDb().exec("DELETE FROM user_auth_invitations"); }
    return "test-key";
  }, () => clock), () => clock);
  await expect(racing.confirm(issued.token, claim.browserToken, origin, claim.enrolmentToken, generateTotp(claim.secret, clock))).rejects.toThrow("Session access denied");
  expect(getUser(getDb(), userId)?.enabled).toBe(false);
  expect((getDb().query("SELECT count(*) n FROM user_totp_factors WHERE user_id=?").get(userId) as any).n).toBe(0);
  expect((getDb().query("SELECT count(*) n FROM user_totp_enrolments WHERE user_id=?").get(userId) as any).n).toBe(1);
});

test("an old claim cannot overwrite pending enrolment after an administrator reissues", async () => {
  const old = service.issue(admin, userId);
  let replacement: ReturnType<typeof service.issue> | undefined;
  const racing = new AccountInvitations(getDb(), new UserAuthFactors(getDb(), () => {
    replacement = service.issue(admin, userId);
    return "test-key";
  }, () => clock), () => clock);
  await expect(racing.claim(old.token, origin)).rejects.toThrow("Session access denied");
  expect((getDb().query("SELECT count(*) n FROM user_totp_enrolments").get() as any).n).toBe(0);
  const claim = await service.claim(replacement!.token, origin);
  expect(await service.confirm(replacement!.token, claim.browserToken, origin, claim.enrolmentToken, generateTotp(claim.secret, clock))).toBe(true);
});
