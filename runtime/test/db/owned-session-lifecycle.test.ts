import { beforeEach, afterEach, expect, test } from "bun:test";
import Database from "bun:sqlite";
import { createSseAuthorisation } from "../../src/channels/web/http/family-authorisation.js";
import { SseHub } from "../../src/channels/web/sse/sse-hub.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempWorkspace, setEnv } from "../helpers.js";
import { closeDatabase, initDatabase, getDb } from "../../src/db/connection.js";
import { createWebSession, revokeUserWebSessions } from "../../src/db/web-sessions.js";
import { getUser } from "../../src/db/users.js";
import { provisionFamilyAccount, updateManagedAccount } from "../../src/db/account-administration.js";
import { resolveRequestPrincipal } from "../../src/channels/web/auth/principal.js";
import type { AuthenticatedPrincipal } from "../../src/core/access-types.js";
import { createOwnedRoot, selectOwnedHome, archiveOwnedSession, restoreOwnedSession, listOwnedLifecycleSessions, readOwnedSessionSettings } from "../../src/db/owned-session-lifecycle.js";
import { getRootOwnership, resolveAuthorisedChat } from "../../src/db/session-ownership.js";
import { commitOwnedFork, readOwnedForkSeed } from "../../src/db/owned-forks.js";
import { AgentBranchManager } from "../../src/agent-pool/branch-manager.js";
import { AgentSessionManager } from "../../src/agent-pool/session-manager.js";
import { authoriseExecutionIdentity } from "../../src/agent-pool/execution-identity.js";
import { withExecutionIdentity } from "../../src/core/execution-context.js";
import { RequestRouterService } from "../../src/channels/web/request-router-service.js";
import { WebAuthGateway } from "../../src/channels/web/auth/auth-gateway.js";
import { WebauthnChallengeTracker } from "../../src/channels/web/auth/webauthn-challenges.js";
import { TotpFailureTracker } from "../../src/channels/web/auth/totp-failure-tracker.js";

let alice: AuthenticatedPrincipal, bob: AuthenticatedPrincipal;
let ws: ReturnType<typeof createTempWorkspace>, restore: () => void;
function actor(id: string) {
  const login = createWebSession(`token-${id}`, id, 3600, "passkey");
  return resolveRequestPrincipal(new Request("https://family.local", { headers: { cookie: "piclaw_session=fixture" } }), { mode: "family-shared", authEnabled: true }, {
    getSession: () => login, getUser: () => getUser(getDb(), id), getLocalDisplayName: () => "Unused",
  })!;
}
function child(parent: string, key = "fork") { return commitOwnedFork(getDb(), alice, parent, key, "child", JSON.stringify({ version: 1, mode: "stable_branch", branchEntries: [], model: null, thinkingLevel: null, sessionName: "child", parentSession: null })); }
function manager(extra: Record<string, unknown> = {}) {
  return new AgentBranchManager({ pool: new Map(), sidePool: new Map(), activeForkBaseLeafByChat: new Map(), getOrCreateRuntime: async () => { throw Error("must not hydrate"); }, refreshRuntime: async () => {}, isActive: () => false, ...extra });
}
beforeEach(() => {
  ws = createTempWorkspace("piclaw-owned-lifecycle-"); restore = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });
  mkdirSync(join(ws.workspace, ".piclaw")); writeFileSync(join(ws.workspace, ".piclaw/config.json"), JSON.stringify({ domains: { access: { mode: "family-shared" } } }));
  closeDatabase(); initDatabase(); const admin = actor("default");
  for (const name of ["alice", "bob"]) {
    const user = provisionFamilyAccount(getDb(), admin, { username: name, displayName: name });
    getDb().query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key) VALUES (?,'family.local',?,'key')").run(user.id, name);
    updateManagedAccount(getDb(), admin, user.id, { enabled: true }, { totp: false, passkey: true, rpId: "family.local" });
    if (name === "alice") alice = actor(user.id); else bob = actor(user.id);
  }
});
afterEach(() => { closeDatabase(); restore(); ws.cleanup(); });

test("additional roots are atomic/private with owner-local names; home switches only default selection", () => {
  const db = getDb(); const home = alice.homeChatJid!;
  const a = createOwnedRoot(db, alice, "@Research"), b = createOwnedRoot(db, bob, "research");
  expect(a.agent_name).toBe("research"); expect(a.chat_jid).not.toBe(b.chat_jid);
  expect(getRootOwnership(db, a.chat_jid)?.ownerUserId).toBe(alice.userId);
  const count = (db.query("SELECT count(*) n FROM chats").get() as any).n;
  expect(() => createOwnedRoot(db, alice, "RESEARCH")).toThrow("UNIQUE");
  expect((db.query("SELECT count(*) n FROM chats").get() as any).n).toBe(count);
  const fork = child(a.chat_jid);
  expect(() => selectOwnedHome(db, alice, fork.chat_jid)).toThrow();
  expect(() => selectOwnedHome(db, alice, b.chat_jid)).toThrow();
  expect(selectOwnedHome(db, alice, a.chat_jid)).toBe(a.chat_jid);
  expect(resolveAuthorisedChat(db, alice, undefined, "session.read").chatJid).toBe(a.chat_jid);
  expect(resolveAuthorisedChat(db, alice, home, "session.read").chatJid).toBe(home);
  expect(getUser(db, bob.userId)?.home_chat_jid).toBe(bob.homeChatJid);
});

test("archive home/active descendants denied; bottom-up archive/top-down restore preserves identities and seeds", () => {
  const db = getDb(); expect(() => archiveOwnedSession(db, alice, alice.homeChatJid!)).toThrow("another owned home");
  const root = createOwnedRoot(db, alice, "root"), fork = child(root.chat_jid), nested = child(fork.chat_jid, "nested");
  const seed = readOwnedForkSeed(db, alice, nested.chat_jid);
  expect(() => archiveOwnedSession(db, alice, root.chat_jid)).toThrow("descendants");
  expect(() => archiveOwnedSession(db, alice, fork.chat_jid)).toThrow("descendants");
  archiveOwnedSession(db, alice, nested.chat_jid); archiveOwnedSession(db, alice, fork.chat_jid); archiveOwnedSession(db, alice, root.chat_jid);
  expect(listOwnedLifecycleSessions(db, alice, root.chat_jid)).toHaveLength(0);
  expect(listOwnedLifecycleSessions(db, alice, root.chat_jid, true)).toHaveLength(3);
  expect(() => resolveAuthorisedChat(db, alice, nested.chat_jid, "session.read")).toThrow();
  expect(() => restoreOwnedSession(db, alice, nested.chat_jid)).toThrow();
  restoreOwnedSession(db, alice, root.chat_jid); restoreOwnedSession(db, alice, fork.chat_jid);
  const restored = restoreOwnedSession(db, alice, nested.chat_jid);
  expect(restored.branch_id).toBe(nested.branch_id); expect(restored.root_chat_jid).toBe(root.chat_jid);
  expect(readOwnedForkSeed(db, alice, nested.chat_jid)).toBe(seed);
});

test("restore collision rolls back; explicit rename resolves it without ID or ownership change", () => {
  const db = getDb(); const root = createOwnedRoot(db, alice, "research"); archiveOwnedSession(db, alice, root.chat_jid);
  createOwnedRoot(db, alice, "research");
  expect(() => restoreOwnedSession(db, alice, root.chat_jid)).toThrow("UNIQUE");
  expect(listOwnedLifecycleSessions(db, alice, root.chat_jid, true)[0]?.archived_at).toBeTruthy();
  const restored = restoreOwnedSession(db, alice, root.chat_jid, "research-old");
  expect(restored.chat_jid).toBe(root.chat_jid); expect(restored.branch_id).toBe(root.branch_id); expect(restored.agent_name).toBe("research-old");
  expect(getRootOwnership(db, root.chat_jid)?.ownerUserId).toBe(alice.userId);
});

test("foreign, unknown, forged namespace and revoked sessions deny all lifecycle operations", () => {
  const db = getDb(); const root = createOwnedRoot(db, bob, "other");
  for (const jid of [root.chat_jid, "missing", ""]) {
    for (const action of [() => selectOwnedHome(db, alice, jid), () => archiveOwnedSession(db, alice, jid), () => restoreOwnedSession(db, alice, jid), () => listOwnedLifecycleSessions(db, alice, jid, true)]) expect(action).toThrow("Session access denied");
  }
  db.query("UPDATE chat_branches SET handle_owner_id=? WHERE chat_jid=?").run(alice.userId, root.chat_jid);
  expect(listOwnedLifecycleSessions(db, alice, undefined, true).some(row => row.chat_jid === root.chat_jid)).toBe(false);
  revokeUserWebSessions(alice.userId);
  expect(() => createOwnedRoot(db, alice, "new")).toThrow();
  expect(() => listOwnedLifecycleSessions(db, alice)).toThrow();
});

test("manager denies busy/pending work; detaches caches during archive and blocks restore until disposal finishes", async () => {
  const root = createOwnedRoot(getDb(), alice, "idle"); let release!: () => void, disposals = 0;
  const pool = new Map([[root.chat_jid, { lastUsed: Date.now(), runtime: { session: {}, dispose: async () => { disposals++; await new Promise<void>(resolve => { release = resolve; }); } } as any }]]);
  let pending = true;
  const branchManager = manager({ pool, hasPendingSessionWork: () => pending });
  await expect(branchManager.changeOwnedSessionLifecycle(alice, root.chat_jid, "archive")).rejects.toThrow("idle");
  pending = false;
  const archiving = branchManager.changeOwnedSessionLifecycle(alice, root.chat_jid, "archive");
  expect(pool.size).toBe(0); expect(disposals).toBe(1);
  await expect(branchManager.changeOwnedSessionLifecycle(alice, root.chat_jid, "restore")).rejects.toThrow("idle");
  release(); await archiving;
  const restored = await branchManager.changeOwnedSessionLifecycle(alice, root.chat_jid, "restore");
  expect(restored.archived_at).toBeNull(); expect(pool.size).toBe(0);
});

test("pending-session guard reflects real hydration singleflight and protected runs", async () => {
  let release!: () => void;
  const sessionManager = new AgentSessionManager({ pool: new Map(), sidePool: new Map(), modelRuntime: {} as any,
    settingsManager: { getDefaultProvider: () => undefined, getDefaultModel: () => undefined } as any,
    createSession: async () => { await new Promise<void>(resolve => { release = resolve; }); return { session: { model: {} }, dispose: async () => {} } as any; },
    createDefaultTools: () => [] as any, bindSession: async () => {}, ensureBranchRegistration: () => {},
  });
  const root = alice.homeChatJid!;
  const identity = authoriseExecutionIdentity(getDb(), "family-shared", root, { actorUserId: alice.userId, ownerUserId: alice.userId, chatJid: root, kind: "interactive", authenticationSessionId: alice.authentication.sessionId! })!;
  const run = withExecutionIdentity(identity, () => sessionManager.getOrCreate(root));
  await Bun.sleep(1); expect(sessionManager.hasPendingSessionWork(root)).toBe(true); release(); await run;
  expect(sessionManager.hasPendingSessionWork(root)).toBe(false);
  const unprotect = sessionManager.acquireEvictionProtection(root);
  expect(sessionManager.hasPendingSessionWork(root)).toBe(true); unprotect();
  expect(sessionManager.hasPendingSessionWork(root)).toBe(false); await sessionManager.shutdown();
});

test("HTTP roots/home/archive/restore remain cookie-owner scoped and require Origin and strict payloads", async () => {
  const json = (body: unknown, status = 200) => Response.json(body, { status });
  const authGateway = new WebAuthGateway({ accessMode: "family-shared", passkeyMode: "", totpSecret: "", internalSecret: "secret", hasTls: true, sessionTtlSeconds: 3600 }, { json, challenges: new WebauthnChallengeTracker(), failureTracker: new TotpFailureTracker() });
  const router = new RequestRouterService({ json, authGateway, agentPool: manager(), endpointContexts: {} } as any, "family-shared");
  const req = (path: string, method = "POST", body: unknown = {}, origin: string | null = "https://family.local") => router.handle(new Request("https://family.local" + path, { method, headers: { cookie: `piclaw_session=token-${alice.userId}`, "x-piclaw-internal-secret": "secret", ...(origin ? { origin } : {}) }, ...(method === "GET" ? {} : { body: JSON.stringify(body) }) }));
  expect((await req("/agent/root-session", "POST", { agent_name: "new" }, null)).status).toBe(403);
  expect((await req("/agent/root-session", "POST", { agent_name: "new", user_id: bob.userId })).status).toBe(400);
  const response = await req("/agent/root-session", "POST", { agent_name: "new" }); expect(response.status).toBe(201);
  const { branch } = await response.json();
  expect((await req("/account/home", "PATCH", { chat_jid: bob.homeChatJid })).status).toBe(403);
  expect((await req("/account/home", "PATCH", { chat_jid: branch.chat_jid })).status).toBe(200);
  expect((await req("/agent/branch-prune", "POST", { chat_jid: branch.chat_jid })).status).toBe(400);
  expect((await req("/agent/branch-prune", "POST", { chat_jid: alice.homeChatJid })).status).toBe(200);
  const list = await req("/agent/branches?include_archived=true", "GET"); expect(list.status).toBe(200);
  const branches = (await list.json()).branches; expect(branches).toHaveLength(2);
  expect(branches.some((row: any) => row.chat_jid === bob.homeChatJid)).toBe(false);
  expect((await req("/agent/branch-restore", "POST", { chat_jid: alice.homeChatJid })).status).toBe(200);
  expect((await req("/agent/branch-restore", "POST", { chat_jid: bob.homeChatJid })).status).toBe(403);
  expect((await req("/agent/branches?include_archived=anything", "GET")).status).toBe(403);
});

test("file-backed reopen preserves home, archive and deferred seeds without rewriting IDs", () => {
  const root = createOwnedRoot(getDb(), alice, "persisted"), fork = child(root.chat_jid);
  const originalSeed = readOwnedForkSeed(getDb(), alice, fork.chat_jid);
  selectOwnedHome(getDb(), alice, root.chat_jid);
  archiveOwnedSession(getDb(), alice, fork.chat_jid);
  const path = join(ws.store, "lifecycle.sqlite");
  getDb().query("VACUUM INTO ?").run(path);
  const reopened = new Database(path);
  try {
    expect(resolveAuthorisedChat(reopened, alice, undefined, "session.read").chatJid).toBe(root.chat_jid);
    expect(listOwnedLifecycleSessions(reopened, alice, root.chat_jid, true).some(row => row.chat_jid === fork.chat_jid && row.archived_at)).toBe(true);
    const restored = restoreOwnedSession(reopened, alice, fork.chat_jid, "renamed-after-restart");
    expect(restored.branch_id).toBe(fork.branch_id);
    expect(readOwnedForkSeed(reopened, alice, fork.chat_jid)).toBe(originalSeed);
  } finally { reopened.close(); }
});

test("archiving disconnects its SSE on next delivery, without affecting another owned stream", async () => {
  const root = createOwnedRoot(getDb(), alice, "streamed");
  const hub = new SseHub();
  try {
    const archived = hub.handleRequest(undefined, createSseAuthorisation(getDb(), alice, root.chat_jid)).body!.getReader();
    const home = hub.handleRequest(undefined, createSseAuthorisation(getDb(), alice, alice.homeChatJid!)).body!.getReader();
    await archived.read(); await home.read();
    archiveOwnedSession(getDb(), alice, root.chat_jid);
    hub.broadcast("new_post", { chat_jid: root.chat_jid, content: "must not leak" });
    expect((await archived.read()).done).toBe(true); expect(hub.clients.size).toBe(1);
    hub.broadcast("new_post", { chat_jid: alice.homeChatJid, content: "still active" });
    expect(new TextDecoder().decode((await home.read()).value)).toContain("still active");
    await home.cancel();
  } finally { hub.closeAll(); }
});

test("home changes need recent login and side-session activity prevents archive", async () => {
  const root = createOwnedRoot(getDb(), alice, "extra");
  getDb().query("UPDATE web_sessions SET created_at=? WHERE session_id=?").run(new Date(Date.now()-3600_000).toISOString(), alice.authentication.sessionId!);
  expect(() => selectOwnedHome(getDb(), alice, root.chat_jid)).toThrow("Session access denied");
  const sidePool = new Map([[root.chat_jid, { runtime: { session: { isStreaming: true } } as any, lastUsed: Date.now() }]]);
  await expect(manager({ sidePool }).changeOwnedSessionLifecycle(alice, root.chat_jid, "archive")).rejects.toThrow("idle");
  expect(resolveAuthorisedChat(getDb(), alice, root.chat_jid, "session.read").chatJid).toBe(root.chat_jid);
});

test("tree Settings exposes only owned metadata with active-home and graph eligibility", () => {
  const db = getDb(), root = createOwnedRoot(db, alice, 'work'), fork = child(root.chat_jid), nested = child(fork.chat_jid, 'deep');
  let snapshot = readOwnedSessionSettings(db, alice);
  const caps = (jid: string) => snapshot.branches.find(b => b.chat_jid === jid)!.capabilities;
  expect(snapshot.capabilities.create_root).toBe(true); expect(snapshot.home_chat_jid).toBe(alice.homeChatJid);
  expect(caps(alice.homeChatJid!).archive).toBe(false); expect(caps(alice.homeChatJid!).set_home).toBe(false);
  expect(caps(alice.homeChatJid!).download_transcript).toBe(false);
  expect(caps(root.chat_jid).set_home).toBe(true); expect(caps(fork.chat_jid).set_home).toBe(false);
  expect(caps(root.chat_jid).archive).toBe(false); expect(caps(fork.chat_jid).archive).toBe(false); expect(caps(nested.chat_jid).archive).toBe(true);
  expect(JSON.stringify(snapshot)).not.toContain(bob.homeChatJid!); expect(JSON.stringify(snapshot)).not.toContain('seed_json');
  archiveOwnedSession(db, alice, nested.chat_jid); archiveOwnedSession(db, alice, fork.chat_jid); archiveOwnedSession(db, alice, root.chat_jid);
  snapshot = readOwnedSessionSettings(db, alice);
  expect(caps(root.chat_jid).restore).toBe(true); expect(caps(fork.chat_jid).restore).toBe(false);
  expect(caps(root.chat_jid).open).toBe(false); expect(caps(root.chat_jid).fork).toBe(false);
  expect(caps(root.chat_jid).download_transcript).toBe(true); expect(caps(fork.chat_jid).download_transcript).toBe(true);
  restoreOwnedSession(db, alice, root.chat_jid); snapshot = readOwnedSessionSettings(db, alice); expect(caps(fork.chat_jid).restore).toBe(true);
  db.query('UPDATE web_sessions SET created_at=? WHERE session_id=?').run(new Date(Date.now()-600_000).toISOString(), alice.authentication.sessionId!);
  snapshot = readOwnedSessionSettings(db, alice); expect(caps(root.chat_jid).set_home).toBe(false); expect(caps(root.chat_jid).rename).toBe(true);
  revokeUserWebSessions(alice.userId); expect(() => readOwnedSessionSettings(db, alice)).toThrow();
});

test("tree Settings HTTP rejects selectors and wrong pins and cannot grant admin foreign content", async () => {
  const json = (body: unknown, status = 200) => Response.json(body, { status });
  const authGateway = new WebAuthGateway({ accessMode: 'family-shared', passkeyMode: '', totpSecret: '', internalSecret: '', hasTls: true, sessionTtlSeconds: 3600 }, { json, challenges: new WebauthnChallengeTracker(), failureTracker: new TotpFailureTracker() });
  const router = new RequestRouterService({ json, authGateway } as any, 'family-shared');
  const req = (query = '', pin = alice.userId) => router.handle(new Request('https://family.local/account/trees'+query, { headers: {
    cookie: `piclaw_session=token-${alice.userId}`, 'x-piclaw-account-id': pin, 'x-piclaw-login-id': alice.authentication.sessionId!,
  } }));
  const response = await req(); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect((await response.json()).branches.map((b: any) => b.chat_jid)).toEqual([alice.homeChatJid]);
  expect((await req('?chat_jid='+bob.homeChatJid)).status).toBe(403); expect((await req('', bob.userId)).status).toBe(409);
});
