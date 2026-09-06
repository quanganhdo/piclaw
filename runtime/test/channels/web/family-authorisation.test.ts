import { afterEach, beforeEach, expect, test } from "bun:test";
import "../../helpers.js";
import { initDatabase, getDb, closeDatabase } from "../../../src/db/connection.js";
import { createUser, getUser, updateUser } from "../../../src/db/users.js";
import { ensureChatBranch } from "../../../src/db/chat-branches.js";
import { storeChatMetadata, storeMessage } from "../../../src/db/messages.js";
import { assignRootOwner, provisionUserHome } from "../../../src/db/session-ownership.js";
import { createWebSession, revokeUserWebSessions } from "../../../src/db/web-sessions.js";
import { WebAuthGateway } from "../../../src/channels/web/auth/auth-gateway.js";
import { TotpFailureTracker } from "../../../src/channels/web/auth/totp-failure-tracker.js";
import { WebauthnChallengeTracker } from "../../../src/channels/web/auth/webauthn-challenges.js";
import { RequestRouterService } from "../../../src/channels/web/request-router-service.js";
import { installWebChannelPrototype } from "../../../src/channels/web/core/web-channel-prototype.js";
import { WebSessionBroadcastService } from "../../../src/channels/web/sse/session-broadcast-service.js";
import { SseHub } from "../../../src/channels/web/sse/sse-hub.js";
import { revalidateSseClient } from "../../../src/channels/web/sse/sse.js";
import { getSearchResponse } from "../../../src/channels/web/timeline-service.js";

const json = (value: unknown, status = 200) => Response.json(value, { status });
let alice: string, bob: string, gateway: WebAuthGateway, router: RequestRouterService, hub: SseHub;
let channel: any;
function request(path: string, token: string | null = "alice-token", method = "GET") {
  return new Request(`https://family.local${path}`, { method, headers: {
    ...(token ? { cookie: `piclaw_session=${token}` } : {}),
    origin: "https://family.local", "x-user-id": bob, "x-piclaw-internal-secret": "internal-test",
  } });
}
function registerChat(jid: string, root = jid, parent?: string) {
  storeChatMetadata(jid, new Date().toISOString(), jid);
  return ensureChatBranch({ chat_jid: jid, root_chat_jid: root, parent_branch_id: parent });
}
function seedMessage(jid: string, content: string) {
  storeMessage({ id: `msg-${jid}`, chat_jid: jid, sender: "user", sender_name: jid, content,
    timestamp: new Date().toISOString(), is_from_me: false, is_bot_message: false });
}
beforeEach(() => {
  closeDatabase();
  initDatabase();
  const db = getDb();
  alice = createUser(db, { username: "alice", displayName: "Alice", role: "admin" }).id;
  bob = createUser(db, { username: "bob", displayName: "Bob" }).id;
  const a = registerChat("web:alice"); registerChat("web:bob");
  registerChat("web:bob-looking-fork", "web:alice", a.branch_id);
  registerChat("web:alice-other"); registerChat("web:unowned");
  provisionUserHome(db, alice, "web:alice"); provisionUserHome(db, bob, "web:bob");
  assignRootOwner(db, "web:alice-other", alice);
  updateUser(db, alice, { enabled: true }); updateUser(db, bob, { enabled: true });
  createWebSession("alice-token", alice, 3600, "totp"); createWebSession("bob-token", bob, 3600, "passkey");
  for (const jid of ["web:alice", "web:bob", "web:bob-looking-fork", "web:alice-other", "web:unowned"]) seedMessage(jid, `needle #test ${jid}`);
  gateway = new WebAuthGateway({ accessMode: "family-shared", passkeyMode: "", totpSecret: "", internalSecret: "internal-test", sessionTtlSeconds: 3600, hasTls: true }, {
    json, challenges: new WebauthnChallengeTracker(), failureTracker: new TotpFailureTracker(),
  });
  hub = new SseHub();
  channel = {
    authGateway: gateway, json,
    clampInt: (v: string | null, fallback: number, min: number, max: number) => v && Number.isFinite(Number(v)) ? Math.max(min, Math.min(max, Math.trunc(Number(v)))) : fallback,
    parseOptionalInt: (v: string | null) => v && Number.isSafeInteger(Number(v)) ? Number(v) : null,
    handleSse: (req: Request, authority: any) => hub.handleRequest(req, authority),
    serveStatic: async (path: string) => new Response(`static:${path}`),
    endpointContexts: { auth: () => ({ serveStatic: async (path: string) => new Response(`auth:${path}`) }) },
    handleTimeline: () => { throw Error("legacy fallback entered"); },
  };
  router = new RequestRouterService(channel, "family-shared");
});
afterEach(() => { hub.closeAll(); closeDatabase(); });

test("family route binds missing target to live home and preserves owned forks, not JID prefixes", async () => {
  for (const path of ["/timeline", "/hashtag/test"]) {
    const response = await router.handle(request(path));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toContain("Cookie");
    expect(response.headers.get("x-request-id")).toBeTruthy();
    const body = await response.json();
    expect(body.posts.map((row: any) => row.chat_jid)).toEqual(["web:alice"]);
    if (path === "/timeline") expect(body.identity).toEqual({ user_name: "Alice" });
  }
  const response = await router.handle(request("/timeline?chat_jid=web:bob-looking-fork"));
  expect((await response.json()).posts[0].chat_jid).toBe("web:bob-looking-fork");
  provisionUserHome(getDb(), alice, "web:alice-other");
  expect((await (await router.handle(request("/timeline"))).json()).posts[0].chat_jid).toBe("web:alice-other");
});

test("foreign, unknown, blank, duplicate and unowned targets all deny without redirects", async () => {
  for (const route of ["/timeline", "/hashtag/test", "/thread/1", "/search?q=needle", "/sse/stream"]) {
    for (const query of ["chat_jid=web:bob", "chat_jid=missing", "chat_jid=", "chat_jid=%20", "chat_jid=web:unowned", "chat_jid=web:alice&chat_jid=web:bob", "root_chat_jid=web:bob"]) {
      const response = await router.handle(request(`${route}${route.includes("?") ? "&" : "?"}${query}`));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Session access denied." });
      expect(response.headers.get("location")).toBeNull();
    }
  }
  expect(hub.clients.size).toBe(0);
});

test("all/root search filters in SQL before pagination and never includes foreign or unowned chats", async () => {
  for (const [scope, expected] of [
    ["current", ["web:alice"]], ["root", ["web:alice", "web:bob-looking-fork"]],
    ["all", ["web:alice", "web:alice-other", "web:bob-looking-fork"]],
  ] as const) {
    const response = await router.handle(request(`/search?q=needle&scope=${scope}`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.results.map((row: any) => row.chat_jid).sort()).toEqual([...expected].sort());
    expect(body.scope).toBe(scope);
  }
  const page = await (await router.handle(request("/search?q=needle&scope=all&offset=1&limit=1"))).json();
  expect(page.results).toHaveLength(1);
  expect(page.results[0].chat_jid).not.toBe("web:bob");
  expect((getSearchResponse("web:alice", "needle", 10, 0, "all", null, null, []).body as any).results).toEqual([]);
  expect((await router.handle(request("/search?q=needle&scope=invalid"))).status).toBe(403);
});

test("thread ID cannot select a foreign message even with an owned chat", async () => {
  const db = getDb();
  const a = (db.query("SELECT rowid FROM messages WHERE chat_jid='web:alice'").get() as any).rowid;
  const b = (db.query("SELECT rowid FROM messages WHERE chat_jid='web:bob'").get() as any).rowid;
  expect((await router.handle(request(`/thread/${a}`))).status).toBe(200);
  const foreign = await router.handle(request(`/thread/${b}`));
  const missing = await router.handle(request("/thread/999999"));
  expect(foreign.status).toBe(404); expect(await foreign.text()).toBe(await missing.text());
});

test("terminal gate denies early add-ons, widget state, indirect resources, controls and new routes", async () => {
  const paths = ["/api/addons/test", "/api/state", "/api/state/events", "/agent/addons/api/test/read", "/agent/models", "/agent/active-chats", "/agent/keychain", "/workspace/raw", "/export/timeline", "/internal/export/timeline", "/terminal/session", "/vnc/session", "/recordings", "/avatar/user", "/avatar/agent", "/manifest.json", "/sw.js", "/docs/configuration.md", "/future-route"];
  for (const path of paths) {
    expect((await router.handle(request(path))).status).toBe(403);
    const anonymous = await router.handle(request(path, null));
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("location")).toBeNull();
    expect(anonymous.headers.get("cache-control")).toBe("private, no-store");
  }
  for (const path of ["/post", "/internal/post", "/auth/e2e/bootstrap", "/auth/webauthn/register/start", "/sse/stream", "/static/common/dist/login.bundle.js"]) {
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) expect((await router.handle(request(path, "alice-token", method))).status).toBe(403);
  }
  expect((await router.handle(request("/timeline", "alice-token", "HEAD"))).status).toBe(403);
});

test("public assets are narrow and anonymous APIs use JSON 401, not redirects", async () => {
  for (const path of ["/static/common/dist/login.bundle.js", "/static/common/dist/login.bundle.css"]) {
    expect((await router.handle(request(path, null))).status).toBe(200);
  }
  for (const path of ["/timeline", "/search?q=needle", "/sse/stream", "/static/common/dist/login.bundle.js.map", "/static/common/fonts/test.woff2"]) {
    expect((await router.handle(request(path, null))).status).toBe(401);
  }
  expect((await router.handle(request("/"))).status).toBe(200);
  expect(await (await router.handle(request("/", null))).text()).toBe("auth:login.html");
  expect(await (await router.handle(request("/login", null))).text()).toBe("auth:login.html");
  expect((await router.handle(request("/auth/me"))).status).toBe(200);
  expect((await router.handle(request("/auth/me", null))).status).toBe(401);
});

test("new requests reject revoked/disabled accounts and isolated configuration never falls through", async () => {
  revokeUserWebSessions(alice);
  expect((await router.handle(request("/timeline"))).status).toBe(401);
  expect((await router.handle(request("/timeline", "bob-token"))).status).toBe(200);
  updateUser(getDb(), bob, { enabled: false });
  expect((await router.handle(request("/timeline", "bob-token"))).status).toBe(401);
  const isolated = new RequestRouterService(channel, "isolated-containers");
  expect((await isolated.handle(request("/api/addons/test"))).status).toBe(503);
  channel.authGateway = { isAuthEnabled: () => false };
  expect((await router.handle(request("/timeline"))).status).toBe(503);
});

test("legacy single-user routing and unscoped SSE behaviour remain unchanged", async () => {
  const legacy = new RequestRouterService({ ...channel, handleTimeline: (_limit: number, _before: number, jid: string) => json({ legacy: jid }) }, "single-user");
  const response = await legacy.handle(request("/timeline?chat_jid=web:bob"));
  expect(await response.json()).toEqual({ legacy: "web:bob" });
  expect(response.headers.get("cache-control")).not.toBe("private, no-store");
  const stream = hub.handleRequest(request("/sse/stream"));
  const reader = stream.body!.getReader(); await reader.read();
  hub.broadcast("unknown_global", { legacy: true });
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('"legacy":true');
  await reader.cancel(); expect(hub.clients.size).toBe(0);
});

test("prototype to HTTP surface to broadcast service preserves subscription authority", async () => {
  class FixtureChannel {}
  installWebChannelPrototype(FixtureChannel.prototype as any);
  const fixture = new FixtureChannel() as any;
  fixture.sessionBroadcast = new WebSessionBroadcastService({ setProviderUsageRefreshListener: () => {} } as any, {
    sse: hub, bindSessionBinder: () => {}, uiBridge: {} as any,
  });
  let enabled = true;
  const authority = { chatJid: "web:alice", isAuthorised: () => enabled };
  const stream = fixture.handleSse(request("/sse/stream?chat_jid=web:bob"), authority) as Response;
  const reader = stream.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('"chat_jid":"web:alice"');
  expect([...hub.clients][0]?.authorisation).toBe(authority);
  enabled = false;
  hub.broadcast("new_post", { chat_jid: "web:alice", secret: "revoked" });
  expect((await reader.read()).done).toBe(true);
  expect(hub.handleRequest(request("/sse/stream"), authority).status).toBe(403);
  expect(hub.clients.size).toBe(0);
});

test("SSE receives only approved own-chat events, never global or unknown payloads", async () => {
  const response = await router.handle(request("/sse/stream"));
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  const connected = new TextDecoder().decode((await reader.read()).value);
  expect(connected).toContain('"chat_jid":"web:alice"');
  expect(connected).not.toContain("ui_theme");
  hub.broadcast("new_post", { chat_jid: "web:bob", secret: "foreign" });
  hub.broadcast("unknown_global", { secret: "global" });
  hub.broadcast("unknown_scoped", { chat_jid: "web:alice", secret: "unknown" });
  hub.broadcast("new_post", { chat_jid: "web:alice", content: "mine" });
  const event = new TextDecoder().decode((await reader.read()).value);
  expect(event).toContain("mine"); expect(event).not.toMatch(/foreign|global|unknown/);
  revokeUserWebSessions(alice);
  hub.broadcast("new_post", { chat_jid: "web:alice", secret: "after logout" });
  expect((await reader.read()).done).toBe(true); expect(hub.clients.size).toBe(0);
});

test("stream revalidation closes on expiry, role/account change and invalidated parent chain", async () => {
  const mutations = [
    () => getDb().query("UPDATE web_sessions SET expires_at='invalid' WHERE user_id=?").run(alice),
    () => updateUser(getDb(), alice, { enabled: false }),
    () => updateUser(getDb(), alice, { role: "member" }),
    () => getDb().query("UPDATE chat_branches SET archived_at=? WHERE chat_jid='web:bob-looking-fork'").run(new Date().toISOString()),
    () => getDb().query("UPDATE chat_branches SET parent_branch_id='missing' WHERE chat_jid='web:bob-looking-fork'").run(),
  ];
  for (const mutate of mutations) {
    updateUser(getDb(), alice, { enabled: true, role: "admin" });
    createWebSession("alice-token", alice, 3600, "totp");
    const root = (getDb().query("SELECT branch_id FROM chat_branches WHERE chat_jid='web:alice'").get() as any).branch_id;
    getDb().query("UPDATE chat_branches SET archived_at=NULL,parent_branch_id=? WHERE chat_jid='web:bob-looking-fork'").run(root);
    const response = await router.handle(request("/sse/stream?chat_jid=web:bob-looking-fork"));
    const reader = response.body!.getReader(); await reader.read();
    const client = [...hub.clients][0]!;
    mutate();
    // This is also the production heartbeat's check; no event is required to revoke idle clients.
    expect(revalidateSseClient(hub, client)).toBe(false);
    expect((await reader.read()).done).toBe(true); expect(hub.clients.size).toBe(0);
  }
  expect(getUser(getDb(), bob)?.enabled).toBe(true);
});
