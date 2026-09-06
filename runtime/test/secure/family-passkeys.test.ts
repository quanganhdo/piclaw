import { afterEach, beforeEach, expect, test } from "bun:test";
import "../helpers.js";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { closeDatabase, getDb, initDatabase } from "../../src/db/connection.js";
import { getUser, createUser, updateUser } from "../../src/db/users.js";
import { createWebSession, getWebSession } from "../../src/db/web-sessions.js";
import { listOwnFactors, removeOwnFactor, revokeOwnSession } from "../../src/db/account-administration.js";
import { FamilyPasskeys } from "../../src/secure/family-passkeys.js";
import { resolveRequestPrincipal } from "../../src/channels/web/auth/principal.js";
import type { AuthenticatedPrincipal } from "../../src/core/access-types.js";
import { RequestRouterService } from "../../src/channels/web/request-router-service.js";
import { WebAuthGateway } from "../../src/channels/web/auth/auth-gateway.js";
import { TotpFailureTracker } from "../../src/channels/web/auth/totp-failure-tracker.js";
import { WebauthnChallengeTracker } from "../../src/channels/web/auth/webauthn-challenges.js";
import { handleWebauthnLoginStart, handleWebauthnLoginFinish, type WebauthnAuthContext } from "../../src/channels/web/auth/webauthn-auth.js";

const origin = "https://family.local", rp = "family.local";
let principal: AuthenticatedPrincipal, service: FamilyPasskeys, clock: number;
function actor(token = "login-token", userId = "default") {
  const login = createWebSession(token, userId, 3600, "passkey");
  return resolveRequestPrincipal(new Request(origin, { headers: { cookie: "piclaw_session=fixture" } }), { mode: "family-shared", authEnabled: true }, {
    getSession: () => login, getUser: id => getUser(getDb(), id), getLocalDisplayName: () => "Unused",
  })!;
}
function key(name: string) {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = pair.publicKey.export({ format: "jwk" });
  const cose = Buffer.concat([Buffer.from([0xa5, 1, 2, 3, 0x26, 0x20, 1, 0x21, 0x58, 0x20]), Buffer.from(jwk.x!, "base64url"), Buffer.from([0x22, 0x58, 0x20]), Buffer.from(jwk.y!, "base64url")]);
  const id = Buffer.from(name);
  return { pair, cose, id };
}
function registration(k: ReturnType<typeof key>, challenge: string, clientOrigin = origin): any {
  const clientData = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge, origin: clientOrigin }));
  const length = Buffer.alloc(2); length.writeUInt16BE(k.id.length);
  const authData = Buffer.concat([createHash("sha256").update(rp).digest(), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), length, k.id, k.cose]);
  // CBOR { fmt: 'none', attStmt: {}, authData: bytes }, exercising the real verifier.
  const attestation = Buffer.concat([Buffer.from("a363666d74646e6f6e656761747453746d74a0686175746844617461", "hex"), Buffer.from([0x58, authData.length]), authData]);
  return { id: k.id.toString("base64url"), rawId: k.id.toString("base64url"), type: "public-key", clientExtensionResults: {}, response: { clientDataJSON: clientData.toString("base64url"), attestationObject: attestation.toString("base64url"), transports: ["internal"] } };
}
function assertion(k: ReturnType<typeof key>, challenge: string): any {
  const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin }));
  const count = Buffer.alloc(4); count.writeUInt32BE(1);
  const authData = Buffer.concat([createHash("sha256").update(rp).digest(), Buffer.from([5]), count]);
  const signature = sign("sha256", Buffer.concat([authData, createHash("sha256").update(clientData).digest()]), k.pair.privateKey);
  return { id: k.id.toString("base64url"), rawId: k.id.toString("base64url"), type: "public-key", clientExtensionResults: {}, response: { clientDataJSON: clientData.toString("base64url"), authenticatorData: authData.toString("base64url"), signature: signature.toString("base64url"), userHandle: Buffer.from("default").toString("base64url") } };
}
beforeEach(() => { closeDatabase(); initDatabase(); principal = actor(); clock = Date.now(); service = new FamilyPasskeys(getDb(), () => clock); });
afterEach(() => closeDatabase());

test("one account registers two distinct passkeys and logs in with either without replacement", async () => {
  const keys = [key("first-passkey"), key("second-passkey")];
  for (let index = 0; index < keys.length; index++) {
    const start = await service.start(principal, rp, origin);
    expect(start.options.excludeCredentials).toHaveLength(index);
    expect(start.options.user.id).toBe(Buffer.from("default").toString("base64url"));
    await service.finish(principal, start.token, origin, registration(keys[index]!, start.options.challenge));
  }
  expect(listOwnFactors(getDb(), principal).passkeys).toHaveLength(2);
  const stored = getDb().query("SELECT credential_id,public_key FROM webauthn_credentials ORDER BY id").all() as any[];
  expect(stored.map(row => row.public_key)).toEqual(keys.map(k => k.cose.toString("base64url")));
  for (const k of keys) {
    const ctx: WebauthnAuthContext = { accessMode: "family-shared", isPasskeyEnabled: () => true, json: (body, status=200) => Response.json(body, { status }), buildSessionCookie: token => `piclaw_session=${token}`, logAuthEvent: () => {}, getClientKey: () => "test", challenges: new WebauthnChallengeTracker() };
    const start = await (await handleWebauthnLoginStart(new Request(origin + "/auth/webauthn/login/start", { method: "POST", headers: { origin } }), ctx)).json();
    const response = await handleWebauthnLoginFinish(new Request(origin + "/auth/webauthn/login/finish", { method: "POST", headers: { origin }, body: JSON.stringify({ token: start.token, credential: assertion(k, start.options.challenge) }) }), ctx);
    expect(response.status).toBe(200);
    expect(getWebSession(response.headers.get("set-cookie")!.split("=")[1]!)?.user_id).toBe("default");
  }
  removeOwnFactor(getDb(), principal, { kind: "passkey", credentialId: keys[0]!.id.toString("base64url") }, { totp: false, passkey: true, rpId: rp });
  principal = actor();
  expect(listOwnFactors(getDb(), principal).passkeys).toHaveLength(1);
  expect(() => removeOwnFactor(getDb(), principal, { kind: "passkey", credentialId: keys[1]!.id.toString("base64url") }, { totp: false, passkey: true, rpId: rp })).toThrow("last configured");
});

test("registration binds initiating login and origin, is one-use and never overwrites a credential", async () => {
  const k = key("bound-key");
  const start = await service.start(principal, rp, origin);
  const secondLogin = actor("second-login");
  await expect(service.finish(secondLogin, start.token, origin, registration(k, start.options.challenge))).rejects.toThrow();
  await expect(service.finish(principal, start.token, "https://other.local", registration(k, start.options.challenge))).rejects.toThrow();
  await service.finish(principal, start.token, origin, registration(k, start.options.challenge));
  await expect(service.finish(principal, start.token, origin, registration(k, start.options.challenge))).rejects.toThrow();
  const duplicate = await service.start(principal, rp, origin);
  await expect(service.finish(principal, duplicate.token, origin, registration(k, duplicate.options.challenge))).rejects.toThrow("UNIQUE");
  expect(listOwnFactors(getDb(), principal).passkeys).toHaveLength(1);
});

test("failed proof consumes ceremony and expired or revoked logins cannot finish", async () => {
  const k = key("invalid-key");
  const invalid = await service.start(principal, rp, origin);
  await expect(service.finish(principal, invalid.token, origin, registration(k, invalid.options.challenge, "https://wrong.local"))).rejects.toThrow();
  await expect(service.finish(principal, invalid.token, origin, registration(k, invalid.options.challenge))).rejects.toThrow();
  const expired = await service.start(principal, rp, origin); clock += 5 * 60_000;
  await expect(service.finish(principal, expired.token, origin, registration(k, expired.options.challenge))).rejects.toThrow();
  clock = Date.now(); const revoked = await service.start(principal, rp, origin);
  revokeOwnSession(getDb(), principal, principal.authentication.sessionId!);
  expect((getDb().query("SELECT count(*) n FROM user_passkey_registrations").get() as any).n).toBe(0);
  await expect(service.finish(principal, revoked.token, origin, registration(k, revoked.options.challenge))).rejects.toThrow();
  expect((getDb().query("SELECT count(*) n FROM webauthn_credentials").get() as any).n).toBe(0);
});

test("pending ceremonies are bounded but do not limit registered passkey count to one", async () => {
  for (let i=0; i<5; i++) await service.start(principal, rp, origin);
  await expect(service.start(principal, rp, origin)).rejects.toThrow("Too many pending");
  clock += 5 * 60_000;
  await expect(service.start(principal, rp, origin)).resolves.toBeTruthy();
  expect((getDb().query("SELECT count(*) n FROM user_passkey_registrations").get() as any).n).toBe(1);
});

test("HTTP passkey endpoints are cookie-bound, CSRF-protected and append credentials", async () => {
  const json = (body: unknown, status=200) => Response.json(body, { status });
  const gateway = new WebAuthGateway({ accessMode: "family-shared", passkeyMode: "", totpSecret: "", internalSecret: "secret", sessionTtlSeconds: 3600, hasTls: true }, { json, challenges: new WebauthnChallengeTracker(), failureTracker: new TotpFailureTracker() });
  const router = new RequestRouterService({ json, authGateway: gateway } as any, "family-shared");
  const post = (path: string, body: unknown, from: string | null = origin) => router.handle(new Request(origin + path, { method: "POST", body: JSON.stringify(body), headers: { cookie: "piclaw_session=login-token", ...(from ? { origin: from } : {}) } }));
  for (const from of [null, "https://foreign.local"]) expect((await post("/account/passkeys/register/start", {}, from)).status).toBe(403);
  expect((await post("/account/passkeys/register/start", { user_id: "other" })).status).toBe(403);
  for (const name of ["browser-key-1", "browser-key-2"]) {
    const response = await post("/account/passkeys/register/start", {});
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    const start = await response.json();
    const finished = await post("/account/passkeys/register/finish", { token: start.token, credential: registration(key(name), start.options.challenge) });
    expect(finished.status).toBe(200); expect(await finished.json()).toEqual({ registered: true });
    expect(finished.headers.get("set-cookie")).toBeNull();
  }
  expect(listOwnFactors(getDb(), principal).passkeys).toHaveLength(2);
});

test("foreign accounts cannot use a grant and concurrent completion inserts exactly one key", async () => {
  const bob = createUser(getDb(), { username: "bob", displayName: "Bob" });
  updateUser(getDb(), bob.id, { enabled: true });
  const other = actor("bob-token", bob.id);
  const start = await service.start(principal, rp, origin), k = key("one-winner");
  await expect(service.finish(other, start.token, origin, registration(k, start.options.challenge))).rejects.toThrow();
  const results = await Promise.allSettled([
    service.finish(principal, start.token, origin, registration(k, start.options.challenge)),
    service.finish(principal, start.token, origin, registration(k, start.options.challenge)),
  ]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(listOwnFactors(getDb(), principal).passkeys).toHaveLength(1);
  expect(listOwnFactors(getDb(), other).passkeys).toHaveLength(0);
});

test("expiry after proof verification still prevents credential insertion", async () => {
  let checks = 0;
  const expiring = new FamilyPasskeys(getDb(), () => ++checks === 1 ? clock : clock + 6 * 60_000);
  const start = await service.start(principal, rp, origin), k = key("slow-proof");
  await expect(expiring.finish(principal, start.token, origin, registration(k, start.options.challenge))).rejects.toThrow();
  expect(listOwnFactors(getDb(), principal).passkeys).toHaveLength(0);
});
