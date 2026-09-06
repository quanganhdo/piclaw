import { afterEach, beforeEach, expect, test } from "bun:test";
import "../../../helpers.js";
import { initDatabase, getDb, closeDatabase } from "../../../../src/db/connection.js";
import { createUser, updateUser } from "../../../../src/db/users.js";
import { ensureChatBranch } from "../../../../src/db/chat-branches.js";
import { storeChatMetadata } from "../../../../src/db/messages.js";
import { provisionUserHome } from "../../../../src/db/session-ownership.js";
import { createWebSession, getWebSession } from "../../../../src/db/web-sessions.js";
import { WebAuthGateway } from "../../../../src/channels/web/auth/auth-gateway.js";
import { TotpFailureTracker } from "../../../../src/channels/web/auth/totp-failure-tracker.js";
import { WebauthnChallengeTracker } from "../../../../src/channels/web/auth/webauthn-challenges.js";
import { RequestRouterService } from "../../../../src/channels/web/request-router-service.js";
import { serveStatic } from "../../../../src/channels/web/http/static.js";

let router: RequestRouterService, alice: string, bob: string, login: string;
const json = (value: unknown, status = 200) => Response.json(value, { status });
function request(path: string, options: { token?: string; method?: string; headers?: Record<string, string> } = {}) {
  return new Request(`https://family.local${path}`, { method: options.method ?? "GET", headers: {
    cookie: `piclaw_session=${options.token ?? "alice-token"}`, origin: "https://family.local", ...options.headers,
  } });
}
function binding() { return { "x-piclaw-account-id": alice, "x-piclaw-login-id": login }; }
beforeEach(() => {
  closeDatabase(); initDatabase(); const db = getDb();
  alice = createUser(db, { username: "alice", displayName: "Alice", role: "admin" }).id;
  bob = createUser(db, { username: "bob", displayName: "Bob" }).id;
  for (const [id, chat] of [[alice, "web:alice"], [bob, "web:bob"]]) {
    storeChatMetadata(chat!, new Date().toISOString(), chat); ensureChatBranch({ chat_jid: chat!, root_chat_jid: chat! });
    provisionUserHome(db, id!, chat!); updateUser(db, id!, { enabled: true });
  }
  login = createWebSession("alice-token", alice, 3600, "totp").session_id;
  createWebSession("bob-token", bob, 3600, "passkey");
  const authGateway = new WebAuthGateway({ accessMode: "family-shared", passkeyMode: "", totpSecret: "", internalSecret: "", sessionTtlSeconds: 3600, hasTls: true }, {
    json, challenges: new WebauthnChallengeTracker(), failureTracker: new TotpFailureTracker(),
  });
  router = new RequestRouterService({ json, authGateway, serveStatic: (path: string, req?: Request) => serveStatic(path, () => json({ error: "Not found" }, 404), req) } as any, "family-shared");
});
afterEach(() => { closeDatabase(); });

test("family gets a separate no-store shell, versioned private bundles, no legacy app or source maps", async () => {
  for (const path of ["/", "/index.html"]) {
    const response = await router.handle(request(path)); expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("vary")).toContain("Cookie");
    const html = await response.text(); expect(html).toContain("family.bundle.js?v="); expect(html).not.toContain("__FAMILY_ASSET_VERSION__");
    expect(html).not.toContain("app.bundle"); expect(html).not.toContain("localStorage");
    expect(await (await router.handle(request(path, { method: "HEAD" }))).text()).toBe("");
    expect((await router.handle(request(path, { method: "POST" }))).status).toBe(403);
  }
  for (const path of ["/static/common/dist/family.bundle.js", "/static/common/dist/family.bundle.css"]) {
    expect((await router.handle(request(path))).status).toBe(200);
    expect(await (await router.handle(request(path, { method: "HEAD" }))).text()).toBe("");
    expect((await router.handle(request(path, { token: "invalid" }))).status).toBe(401);
  }
  for (const path of ["/static/classic/index.html", "/static/classic/dist/app.bundle.js", "/static/common/dist/family.bundle.js.map", "/static/common/js/marked.min.js", "/static/sw.js", "/sw.js"]) {
    expect((await router.handle(request(path))).status).toBe(403);
  }
});

test("pin mismatch denies before reads, message admission, account mutations and logout", async () => {
  for (const [path, method] of [["/auth/me", "GET"], ["/agent/branches", "GET"], ["/agent/default/message", "POST"], ["/account", "PATCH"], ["/auth/logout", "POST"]]) {
    for (const headers of [binding(), { "x-piclaw-account-id": bob }, { "x-piclaw-login-id": login }]) {
      const response = await router.handle(request(path!, { token: "bob-token", method, headers }));
      expect(response.status).toBe(409); expect((await response.json()).code).toBe("account_changed");
    }
  }
  expect((await router.handle(request("/auth/me", { headers: binding() }))).status).toBe(200);
  createWebSession("alice-new", alice, 3600, "totp");
  expect((await router.handle(request("/auth/me", { token: "alice-new", headers: binding() }))).status).toBe(409);
  expect(getWebSession("bob-token")).not.toBeNull();
});

test("logout requires origin and both pins, revokes only its login, and cannot clear a newer cookie", async () => {
  expect((await router.handle(request("/auth/logout", { method: "POST" }))).status).toBe(403);
  expect((await router.handle(request("/auth/logout", { method: "POST", headers: { ...binding(), origin: "https://foreign.local" } }))).status).toBe(403);
  expect((await router.handle(request("/auth/logout", { headers: binding() }))).status).toBe(403);
  // Sign out does not require a fresh authentication ceremony.
  getDb().query("UPDATE web_sessions SET created_at = ? WHERE session_id = ?").run(new Date(Date.now()-600_000).toISOString(), login);
  const response = await router.handle(request("/auth/logout", { method: "POST", headers: binding() }));
  expect(response.status).toBe(200); expect(response.headers.get("set-cookie")).toBeNull();
  expect(getWebSession("alice-token")).toBeNull(); expect(getWebSession("bob-token")).not.toBeNull();
  expect((await router.handle(request("/auth/me"))).status).toBe(401);
});
