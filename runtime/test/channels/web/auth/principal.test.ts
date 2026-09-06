import { expect, test } from "bun:test";
import { resolveRequestPrincipal, canPrincipalAct, principalResponse, type PrincipalResolverDeps } from "../../../../src/channels/web/auth/principal.js";
import { WebAuthGateway } from "../../../../src/channels/web/auth/auth-gateway.js";

function deps(): PrincipalResolverDeps {
  return {
    getLocalDisplayName: () => "Legacy owner",
    getSession: (token) => token === "secret-cookie" ? { token, session_id: "login-123", user_id: "u-alice", auth_method: "passkey", created_at: new Date().toISOString(), expires_at: new Date(Date.now()+60_000).toISOString() } : null,
    getUser: (id) => ({ id, username: "alice", display_name: "Alice", role: "member", enabled: true, home_chat_jid: "web:alice", created_at: "", updated_at: "" }),
  };
}
const request = () => new Request("https://family.local/auth/me?userId=admin", { headers: { cookie: "piclaw_session=secret-cookie", "x-piclaw-user-id": "default" } });

test("principal identity comes from verified cookie/user records, never requested headers/targets", async () => {
  const principal = resolveRequestPrincipal(request(), { mode: "family-shared", authEnabled: true }, deps())!;
  expect(principal.userId).toBe("u-alice");
  expect(principal.username).toBe("alice");
  expect(principal.authentication.sessionId).toBe("login-123");
  expect(Object.isFrozen(principal)).toBe(true);
  expect(Object.isFrozen(principal.authentication)).toBe(true);
  const response = principalResponse(request(), principal);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.text()).not.toContain("secret-cookie");
});

test("local compatibility only applies to auth-disabled single-user mode", () => {
  const local = resolveRequestPrincipal(new Request("http://local"), { mode: "single-user", authEnabled: false }, deps())!;
  expect(local.kind).toBe("local");
  expect(local.displayName).toBe("Legacy owner");
  expect(local.authentication.method).toBe("local");
  expect(local.authentication.sessionId).toBeNull();
  expect(resolveRequestPrincipal(request(), { mode: "family-shared", authEnabled: false }, deps())).toBeNull();
  expect(resolveRequestPrincipal(request(), { mode: "single-user", authEnabled: true }, deps())).toBeNull();
});

test("disabled, unknown, expired and malformed credentials fail closed", () => {
  const base = deps();
  for (const overrides of [
    { getUser: () => null },
    { getUser: (id: string) => ({ ...base.getUser(id)!, enabled: false }) },
    { getSession: () => null },
    { getSession: (token: string) => ({ ...base.getSession(token)!, expires_at: "bad" }) },
    { getSession: (token: string) => ({ ...base.getSession(token)!, expires_at: new Date(0).toISOString() }) },
  ]) expect(resolveRequestPrincipal(request(), { mode: "family-shared", authEnabled: true }, { ...base, ...overrides })).toBeNull();
  expect(resolveRequestPrincipal(new Request("https://family.local", { headers: {cookie: "piclaw_session=%ZZ"} }), { mode:"family-shared", authEnabled:true }, base)).toBeNull();
});

test("administrator grant does not imply another owner's content access", () => {
  const principal = resolveRequestPrincipal(request(), { mode:"family-shared",authEnabled:true }, deps())!;
  expect(canPrincipalAct(principal, "session.read", "u-alice")).toBe(true);
  expect(canPrincipalAct(principal, "session.fork", "u-bob")).toBe(false);
  expect(canPrincipalAct(principal, "unknown", "u-alice")).toBe(false);
  expect(canPrincipalAct(principal, "account.manage-users")).toBe(false);
  const admin = {...principal, role:"admin" as const};
  expect(canPrincipalAct(admin, "account.manage-users")).toBe(true);
  expect(canPrincipalAct(admin, "session.read", "u-bob")).toBe(false);
});

test("gateway uses one snapshot per request and rechecks account state on the next request", () => {
  let enabled = true;
  let reads = 0;
  const base = deps();
  const gateway = new WebAuthGateway({ accessMode:"family-shared", passkeyMode:"passkey-only", totpSecret:"", internalSecret:"", sessionTtlSeconds:60, hasTls:true }, {
    json: body => Response.json(body), challenges: {} as any, failureTracker: {} as any,
    principalResolver: { ...base, getUser: id => { reads++; return {...base.getUser(id)!, enabled}; } },
  });
  const req = request();
  expect(gateway.isAuthenticated(req)).toBe(true);
  expect(gateway.getPrincipal(req)?.userId).toBe("u-alice");
  expect(reads).toBe(1);
  enabled=false;
  expect(gateway.isAuthenticated(request())).toBe(false);
});

test("identity endpoint returns 401 without redirect and has method/redaction protections", async () => {
  expect(principalResponse(request(), null).status).toBe(401);
  expect(principalResponse(new Request("https://family.local/auth/me", {method:"POST"}), null).status).toBe(405);
  const head=principalResponse(new Request("https://family.local/auth/me",{method:"HEAD"}),null);
  expect(head.status).toBe(401);
  expect(await head.text()).toBe("");
});
