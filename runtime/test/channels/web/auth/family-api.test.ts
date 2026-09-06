import { afterEach, expect, test } from "bun:test";
import { FamilyApi, parseFamilyIdentity } from "../../../../web/src/family-api.js";
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const value = { principal: { kind: "user", mode: "family-shared", role: "member", userId: "alice", username: "alice", displayName: "Alice", homeChatJid: "web:alice", authentication: { sessionId: "login-a" } } };

test("identity validates family user, login, role and home without accepting a local fallback", () => {
  expect(Object.isFrozen(parseFamilyIdentity(value))).toBe(true);
  for (const change of [{ kind: "local" }, { mode: "single-user" }, { role: "unknown" }, { homeChatJid: null }, { authentication: {} }]) {
    expect(() => parseFamilyIdentity({ principal: { ...value.principal, ...change } })).toThrow();
  }
  expect(parseFamilyIdentity({ ...value, capabilities: { manage_users: true } }).manageUsers).toBe(false);
  const admin = { ...value, principal: { ...value.principal, role: 'admin' } };
  expect(parseFamilyIdentity(admin).manageUsers).toBe(false);
  expect(parseFamilyIdentity({ ...admin, capabilities: { manage_users: true } }).manageUsers).toBe(true);
});

test("mode changes or revocation after response parsing invalidate instead of releasing old data", async () => {
  for (const response of [() => Response.json({ principal: { ...value.principal, mode: "single-user" } }), () => Response.json({}, { status: 401 })]) {
    let invalidated = 0; const api = new FamilyApi(parseFamilyIdentity(value), () => { invalidated++; });
    globalThis.fetch = (async (url: string) => url === "/auth/me" ? response() : Response.json({ secret: "old" })) as any;
    await expect(api.request("/timeline")).rejects.toThrow(); expect(invalidated).toBe(1);
    await expect(api.request("/timeline")).rejects.toThrow("no longer active");
  }
});

test("pin conflict invalidates without retry; owned-target denial leaves home recovery available", async () => {
  for (const status of [403, 409]) {
    let calls = 0, invalidated = 0;
    globalThis.fetch = (async () => { calls++; return Response.json({}, { status }); }) as any;
    const api = new FamilyApi(parseFamilyIdentity(value), () => { invalidated++; });
    await expect(api.request("/timeline")).rejects.toThrow(); expect(calls).toBe(1); expect(invalidated).toBe(status === 409 ? 1 : 0);
  }
});

test("same-login profile refresh updates labels but never changes account/login pins", async () => {
  const headers: HeadersInit[] = [];
  const api = new FamilyApi(parseFamilyIdentity(value), () => { throw new Error("unexpected invalidation"); });
  globalThis.fetch = (async (url: string, options: RequestInit) => {
    headers.push(options.headers!);
    return Response.json(url === "/auth/me" ? { principal: { ...value.principal, username: "renamed", displayName: "New name", homeChatJid: "web:new-home" } } : {});
  }) as any;
  await api.request("/account", "PATCH", { displayName: "New name" });
  expect(api.identity.displayName).toBe("New name"); expect(api.identity.homeChatJid).toBe("web:new-home");
  for (const header of headers) expect(new Headers(header).get("x-piclaw-login-id")).toBe("login-a");
});
