import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createTempWorkspace, setEnv } from "../helpers.js";
import { initDatabase, closeDatabase, getDb } from "../../src/db/connection.js";
import { createUser, updateUser } from "../../src/db/users.js";
import { ensureChatBranch, getChatBranchByChatJid } from "../../src/db/chat-branches.js";
import { storeChatMetadata } from "../../src/db/messages.js";
import { provisionUserHome } from "../../src/db/session-ownership.js";
import { migrateOwnedSessionHandles, renameOwnedSessionHandle } from "../../src/db/session-handles.js";
import { commitOwnedFork, findOwnedFork, readOwnedForkSeed } from "../../src/db/owned-forks.js";
import { createWebSession, revokeUserWebSessions } from "../../src/db/web-sessions.js";
import { authoriseExecutionIdentity } from "../../src/agent-pool/execution-identity.js";
import { withExecutionIdentity } from "../../src/core/execution-context.js";
import { requireOwnedSessionExecution } from "../../src/agent-pool/owned-session-access.js";
import { AgentBranchManager } from "../../src/agent-pool/branch-manager.js";
import { AgentSessionManager } from "../../src/agent-pool/session-manager.js";
import { RequestRouterService } from "../../src/channels/web/request-router-service.js";
import { WebAuthGateway } from "../../src/channels/web/auth/auth-gateway.js";
import { TotpFailureTracker } from "../../src/channels/web/auth/totp-failure-tracker.js";
import { WebauthnChallengeTracker } from "../../src/channels/web/auth/webauthn-challenges.js";

let workspace: ReturnType<typeof createTempWorkspace>, restore: () => void;
let alice: string, bob: string, login: string;
const managers: AgentSessionManager[] = [];
const seed = { version: 1, parentSession: null, sessionName: "before-rename", model: null, thinkingLevel: null, mode: "stable_branch", branchEntries: [] };
function identity(id = alice, chat = "web:alice") {
  return authoriseExecutionIdentity(getDb(), "family-shared", chat, { actorUserId: id, ownerUserId: id, chatJid: chat, kind: "interactive", authenticationSessionId: id === alice ? login : "invalid" })!;
}
function run<T>(chat: string, fn: () => T): T { return withExecutionIdentity(identity(alice, chat), fn); }
function actor() { return run("web:alice", () => requireOwnedSessionExecution("web:alice")!); }
function fork(key = "request", source = "web:alice") { return commitOwnedFork(getDb(), actor(), source, key, "research", JSON.stringify(seed)); }
function sessionFixture(jid = "web:alice") {
  const file = join(workspace.data, `fixture-${jid.replace(/[^a-z0-9]/gi, "_")}.jsonl`);
  const entries: any[] = [];
  const sessionManager = {
    getSessionFile: () => file, getHeader: () => ({ type: "session", id: jid }), getEntries: () => entries,
    getLeafId: () => "stable", getBranch: async () => [{ type: "message", id: "stable", message: { role: "user", content: "owned source", timestamp: 1 } }],
    buildSessionContext: async () => ({ messages: [{ role: "user", content: "owned source", timestamp: 1 }], thinkingLevel: "off", model: null }),
    appendSessionInfo: (name: string) => { entries.push({ type: "session_info", name }); return "info"; },
    appendMessage: (message: any) => { entries.push({ type: "message", message }); return "msg"; },
    appendModelChange: () => "model",
  };
  const session: any = { sessionId: jid, sessionFile: file, sessionManager, model: null, thinkingLevel: "off", setSessionName: (name: string) => { session.sessionName = name; }, dispose: () => {} };
  const runtime: any = { session, dispose: async () => {}, newSession: async ({ setup }: any) => { entries.length = 0; await setup(sessionManager); return { cancelled: false }; }, switchSession: async () => ({ cancelled: false }) };
  return { runtime, session, entries, file };
}
function lifecycle(create: (jid: string) => Promise<any>) {
  const pool = new Map();
  const manager = new AgentSessionManager({ pool, sidePool: new Map(), createSession: create, createSideSession: create,
    modelRuntime: { getModel: () => undefined } as any, settingsManager: { getDefaultProvider: () => undefined, getDefaultModel: () => undefined } as any,
    createDefaultTools: () => [] as any, bindSession: async () => {}, ensureBranchRegistration: () => {},
  });
  managers.push(manager); return { manager, pool };
}
beforeEach(() => {
  workspace = createTempWorkspace("piclaw-owned-fork-");
  restore = setEnv({ PICLAW_WORKSPACE: workspace.workspace, PICLAW_STORE: workspace.store, PICLAW_DATA: workspace.data });
  mkdirSync(join(workspace.workspace, ".piclaw"), { recursive: true });
  writeFileSync(join(workspace.workspace, ".piclaw/config.json"), JSON.stringify({ domains: { access: { mode: "family-shared" } } }));
  closeDatabase(); initDatabase(); const db = getDb();
  alice = createUser(db, { username: "alice", displayName: "Alice" }).id; bob = createUser(db, { username: "bob", displayName: "Bob" }).id;
  for (const [id, jid] of [[alice, "web:alice"], [bob, "web:bob"]]) {
    storeChatMetadata(jid!, new Date().toISOString(), jid!); ensureChatBranch({ chat_jid: jid! });
    provisionUserHome(db, id!, jid!); updateUser(db, id!, { enabled: true });
  }
  migrateOwnedSessionHandles(db);
  login = createWebSession("token", alice, 3600, "totp").session_id!;
});
afterEach(async () => { for (const manager of managers.splice(0)) await manager.shutdown(); closeDatabase(); restore(); workspace.cleanup(); });

test("atomic fork persists child/seed/owner, same-key retries and nested fork keep identities", () => {
  const a = fork(); const retry = fork(); expect(retry).toEqual(a);
  const b = fork("nested", a.chat_jid); expect(b.parent_branch_id).toBe(a.branch_id); expect(b.root_chat_jid).toBe("web:alice");
  expect(b.agent_name).toBe("research-2");
  expect(readOwnedForkSeed(getDb(), actor(), a.chat_jid)).toBe(JSON.stringify(seed));
  expect(() => findOwnedFork(getDb(), actor(), a.chat_jid, "request")).toThrow();
  expect(() => commitOwnedFork(getDb(), actor(), "web:bob", "foreign", "stolen", JSON.stringify(seed))).toThrow();
  expect((getDb().query("SELECT count(*) n FROM owned_fork_operations").get() as any).n).toBe(2);
});

test("operation insert failure rolls back child registry and chat metadata", () => {
  getDb().exec("CREATE TRIGGER fixture_fail BEFORE INSERT ON owned_fork_operations BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
  expect(() => fork()).toThrow("fixture failure");
  expect((getDb().query("SELECT count(*) n FROM chats").get() as any).n).toBe(2);
  expect((getDb().query("SELECT count(*) n FROM chat_branches").get() as any).n).toBe(2);
});

test("hydration rejects missing/foreign identity, revoked cookies and background prewarm before creation", async () => {
  let created = 0;
  const { manager } = lifecycle(async jid => { created++; return sessionFixture(jid).runtime; });
  await expect(manager.getOrCreate("web:alice")).rejects.toThrow("Session access denied");
  await expect(run("web:alice", () => manager.getOrCreate("web:bob"))).rejects.toThrow();
  await expect(run("web:alice", () => manager.getOrCreateSide("web:bob"))).rejects.toThrow();
  expect(run("web:alice", () => manager.prewarm("web:alice"))).toBe(false);
  const stale = identity(); revokeUserWebSessions(alice);
  await expect(withExecutionIdentity(stale, () => manager.getOrCreate("web:alice"))).rejects.toThrow();
  expect(created).toBe(0);
});

test("first-use replay persists seed, honours rename-before-warmup and is not repeated on reopen", async () => {
  const child = fork();
  renameOwnedSessionHandle(getDb(), actor(), child.chat_jid, "renamed");
  const fixture = sessionFixture(child.chat_jid); let replay = 0;
  const original = fixture.runtime.newSession;
  fixture.runtime.newSession = async (options: any) => { replay++; return original(options); };
  const { manager } = lifecycle(async () => fixture.runtime);
  await run(child.chat_jid, () => manager.getOrCreate(child.chat_jid));
  expect(fixture.session.sessionName).toBe("renamed"); expect(existsSync(fixture.file)).toBe(true);
  expect(readOwnedForkSeed(getDb(), actor(), child.chat_jid)).toBeNull();
  const second = lifecycle(async () => fixture.runtime);
  await run(child.chat_jid, () => second.manager.getOrCreate(child.chat_jid));
  expect(replay).toBe(1); expect(findOwnedFork(getDb(), actor(), "web:alice", "request")?.agent_name).toBe("renamed");
});

test("failed replay leaves durable seed for retry and discards cached runtime", async () => {
  const child = fork(); let fail = true, created = 0;
  const { manager, pool } = lifecycle(async jid => {
    created++; const fixture = sessionFixture(jid);
    if (fail) fixture.runtime.newSession = async () => { throw Error("replay failure"); };
    return fixture.runtime;
  });
  await expect(run(child.chat_jid, () => manager.getOrCreate(child.chat_jid))).rejects.toThrow("replay failure");
  expect(pool.size).toBe(0); expect(readOwnedForkSeed(getDb(), actor(), child.chat_jid)).not.toBeNull();
  fail = false; await run(child.chat_jid, () => manager.getOrCreate(child.chat_jid));
  expect(created).toBe(2); expect(readOwnedForkSeed(getDb(), actor(), child.chat_jid)).toBeNull();
});

test("branch manager rejects foreign source before hydration and revalidates async capture", async () => {
  let hydrated = 0, warmups = 0;
  const source = sessionFixture();
  const active = new Map<string, string | null>([["web:alice", "stable"]]);
  const manager = new AgentBranchManager({ pool: new Map(), sidePool: new Map(), activeForkBaseLeafByChat: active,
    getOrCreateRuntime: async () => { hydrated++; return source.runtime; }, refreshRuntime: async () => {}, isActive: () => false,
    scheduleSessionWarmup: () => { warmups++; },
  });
  await expect(run("web:alice", () => manager.createForkedChatBranch("web:bob", { requestId: "foreign" }))).rejects.toThrow();
  expect(hydrated).toBe(0);
  source.session.isStreaming = true;
  const [a, b] = await run("web:alice", () => Promise.all([
    manager.createForkedChatBranch("web:alice", { requestId: "same", agentName: "research" }),
    manager.createForkedChatBranch("web:alice", { requestId: "same", agentName: "research" }),
  ]));
  expect(a.chat_jid).toBe(b.chat_jid); expect(warmups).toBe(0);
  expect(JSON.parse(readOwnedForkSeed(getDb(), actor(), a.chat_jid)!).mode).toBe("stable_branch");
  source.session.sessionManager.getBranch = async () => { revokeUserWebSessions(alice); return []; };
  const captured = identity();
  await expect(withExecutionIdentity(captured, () => manager.createForkedChatBranch("web:alice", { requestId: "revoked" }))).rejects.toThrow();
  expect((getDb().query("SELECT count(*) n FROM owned_fork_operations").get() as any).n).toBe(1);
});

test("runtime handle lookup and active/known lists have no global active-session fallback", () => {
  renameOwnedSessionHandle(getDb(), actor(), "web:alice", "research");
  getDb().query("UPDATE chat_branches SET agent_name='research' WHERE chat_jid='web:bob'").run();
  const pool = new Map([['web:alice', { runtime: sessionFixture().runtime, lastUsed: Date.now() }], ['web:bob', { runtime: sessionFixture('web:bob').runtime, lastUsed: Date.now() }]]);
  const manager = new AgentBranchManager({ pool, sidePool: new Map(), activeForkBaseLeafByChat: new Map(), getOrCreateRuntime: async jid => pool.get(jid)!.runtime, refreshRuntime: async () => {}, isActive: () => false });
  expect(() => manager.findChatByAgentName("research")).toThrow();
  run("web:alice", () => {
    expect(manager.findChatByAgentName("@RESEARCH")?.chat_jid).toBe("web:alice");
    expect(manager.findChatByAgentName("bob")).toBeNull();
    expect(manager.listActiveChats().map(row => row.chat_jid)).toEqual(["web:alice"]);
    expect(manager.listKnownChats().map(row => row.chat_jid)).toEqual(["web:alice"]);
    expect(() => manager.listKnownChats("web:bob")).toThrow();
  });
  expect(getChatBranchByChatJid("web:bob")?.agent_name).toBe("research");
});

test("family HTTP fork/rename/picker use cookie owner, require CSRF and preserve IDs", async () => {
  let hydrated = 0;
  const source = sessionFixture();
  const branchManager = new AgentBranchManager({ pool: new Map(), sidePool: new Map(), activeForkBaseLeafByChat: new Map(),
    getOrCreateRuntime: async () => { hydrated++; return source.runtime; }, refreshRuntime: async () => {}, isActive: () => false,
  });
  const json = (body: unknown, status = 200) => Response.json(body, { status });
  const gateway = new WebAuthGateway({ accessMode: "family-shared", passkeyMode: "", totpSecret: "", internalSecret: "secret", sessionTtlSeconds: 3600, hasTls: true }, {
    json, challenges: new WebauthnChallengeTracker(), failureTracker: new TotpFailureTracker(),
  });
  const router = new RequestRouterService({ authGateway: gateway, json, agentPool: branchManager, endpointContexts: {} } as any, "family-shared");
  const post = (path: string, body: unknown, origin: string | null = "https://family.local") => router.handle(new Request(`https://family.local${path}`, {
    method: "POST", headers: { cookie: "piclaw_session=token", "content-type": "application/json", ...(origin ? { origin } : {}), "x-piclaw-internal-secret": "secret" }, body: JSON.stringify(body),
  }));
  for (const origin of [null, "https://foreign.local"]) expect((await post("/agent/branch-fork", { request_id: "csrf", agent_name: "research" }, origin)).status).toBe(403);
  expect((await post("/agent/branch-fork", { chat_jid: "web:bob", request_id: "foreign", agent_name: "research" })).status).toBe(403);
  expect((await post("/agent/branch-fork", { chat_jid: "", request_id: "blank", agent_name: "research" })).status).toBe(403);
  expect((await post("/agent/branch-fork", { request_id: "spoof", agent_name: "research", owner_user_id: bob })).status).toBe(400);
  expect(hydrated).toBe(0);
  const response = await post("/agent/branch-fork", { request_id: "fork", agent_name: "research" });
  expect(response.status).toBe(201);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const { branch } = await response.json();
  expect(branch.root_chat_jid).toBe("web:alice");
  const retry = await post("/agent/branch-fork", { request_id: "fork", agent_name: "research" });
  expect((await retry.json()).branch.chat_jid).toBe(branch.chat_jid); expect(hydrated).toBe(1);
  const renamed = await post("/agent/branch-rename", { chat_jid: branch.chat_jid, agent_name: "renamed" });
  expect(renamed.status).toBe(200); expect((await renamed.json()).branch.chat_jid).toBe(branch.chat_jid);
  expect((await post("/agent/branch-rename", { chat_jid: "web:bob", agent_name: "stolen" })).status).toBe(403);
  const picker = await router.handle(new Request("https://family.local/agent/branches", { headers: { cookie: "piclaw_session=token" } }));
  const branches = (await picker.json()).branches;
  expect(branches).toHaveLength(2); expect(branches.every((row: any) => row.root_chat_jid === "web:alice")).toBe(true);
  for (const method of [() => branchManager.pruneChatBranch(branch.chat_jid), () => branchManager.restoreChatBranch(branch.chat_jid), () => branchManager.mergeChatBranchIntoParent(branch.chat_jid), () => branchManager.renameChatJid("web:alice", "web:new"), () => branchManager.permanentPurgeChatBranch(branch.chat_jid)]) {
    await expect(run("web:alice", method)).rejects.toThrow("Session access denied");
  }
});
