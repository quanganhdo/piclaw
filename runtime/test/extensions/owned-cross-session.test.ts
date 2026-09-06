import { beforeEach, afterEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempWorkspace, setEnv } from "../helpers.js";
import { initDatabase, getDb, closeDatabase } from "../../src/db/connection.js";
import { getUser } from "../../src/db/users.js";
import { createWebSession, revokeUserWebSessions } from "../../src/db/web-sessions.js";
import { provisionFamilyAccount, updateManagedAccount } from "../../src/db/account-administration.js";
import { resolveRequestPrincipal } from "../../src/channels/web/auth/principal.js";
import { createOwnedRoot } from "../../src/db/owned-session-lifecycle.js";
import { renameOwnedSessionHandle } from "../../src/db/session-handles.js";
import { authoriseExecutionIdentity } from "../../src/agent-pool/execution-identity.js";
import { withExecutionIdentity } from "../../src/core/execution-context.js";
import { withChatContext } from "../../src/core/chat-context.js";
import { resolveOwnedSessionTarget } from "../../src/agent-pool/owned-session-target.js";
import { inspectOwnedSession } from "../../src/runtime/owned-session-control.js";
import { getChatTransportDirectories, registerChatTransport, resetChatTransportRegistryForTests, sendViaChatTransport } from "../../src/extensions/chat-transport-registry.js";
import { createDirectChatToolRelayHandler } from "../../src/extensions/chat-tool-runtime.js";
import { parseChatAddress } from "../../src/extensions/chat-address.js";
import { chatTool } from "../../src/extensions/chat-tool.js";
import { sessionControl, setSessionControlHandler } from "../../src/extensions/session-control.js";
import type { AuthenticatedPrincipal } from "../../src/core/access-types.js";

let alice: AuthenticatedPrincipal, bob: AuthenticatedPrincipal, target: string;
let ws: ReturnType<typeof createTempWorkspace>, restore: () => void;
function actor(id: string) { const login = createWebSession(`token-${id}`, id, 3600, "passkey"); return resolveRequestPrincipal(new Request("https://local", { headers: { cookie: "piclaw_session=fixture" } }), { mode: "family-shared", authEnabled: true }, { getSession: () => login, getUser: () => getUser(getDb(), id), getLocalDisplayName: () => "unused" })!; }
function run<T>(fn: () => T | Promise<T>, owner = alice): Promise<T> {
  const jid = owner.homeChatJid!;
  const identity = authoriseExecutionIdentity(getDb(), "family-shared", jid, { actorUserId: owner.userId, ownerUserId: owner.userId, chatJid: jid, kind: "interactive", authenticationSessionId: owner.authentication.sessionId! })!;
  return withExecutionIdentity(identity, () => withChatContext(jid, "web", async () => fn()));
}
beforeEach(() => {
  ws = createTempWorkspace("piclaw-owner-targets-"); restore = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });
  mkdirSync(join(ws.workspace, ".piclaw")); writeFileSync(join(ws.workspace, ".piclaw/config.json"), JSON.stringify({ domains: { access: { mode: "family-shared" } } }));
  closeDatabase(); initDatabase(); const admin = actor("default");
  for (const name of ["alice", "bob"]) {
    const user = provisionFamilyAccount(getDb(), admin, { username: name, displayName: name });
    getDb().query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key) VALUES (?,'local',?,'key')").run(user.id, name);
    updateManagedAccount(getDb(), admin, user.id, { enabled: true }, { totp: false, passkey: true, rpId: "local" });
    if (name === "alice") alice = actor(user.id); else bob = actor(user.id);
  }
  target = createOwnedRoot(getDb(), alice, "research").chat_jid;
  renameOwnedSessionHandle(getDb(), bob, bob.homeChatJid!, "research");
});
afterEach(() => { resetChatTransportRegistryForTests(); setSessionControlHandler(undefined); closeDatabase(); restore(); ws.cleanup(); });

test("owner-local names and direct JIDs resolve without cross-owner or missing-target fallback", async () => {
  expect(await run(() => resolveOwnedSessionTarget(alice.homeChatJid!, { target_agent_name: "@RESEARCH" }).chat_jid)).toBe(target);
  expect(await run(() => resolveOwnedSessionTarget(bob.homeChatJid!, { target_agent_name: "research" }).chat_jid, bob)).toBe(bob.homeChatJid!);
  for (const selector of [{ target_chat_jid: bob.homeChatJid! }, { target_chat_jid: "missing" }, { target_chat_jid: "" }, { target_agent_name: "missing" }, { target_chat_jid: target, target_agent_name: "research" }]) await expect(run(() => resolveOwnedSessionTarget(alice.homeChatJid!, selector))).rejects.toThrow("Session access denied");
  await expect(run(() => resolveOwnedSessionTarget(bob.homeChatJid!, { target_agent_name: "research" }))).rejects.toThrow();
  expect(() => resolveOwnedSessionTarget(alice.homeChatJid!, { target_chat_jid: target })).toThrow();
});

test("discovery skips installed remote/local directory providers and lists only owned aliases with no send modes", async () => {
  let touched = 0;
  for (const kind of ["local", "bang"] as const) registerChatTransport({ id: kind, kind, directory: () => { touched++; return { transport: kind, generated_at: "now", entries: [] }; }, send: async () => { touched++; return {} as any; } });
  const directories = await run(() => getChatTransportDirectories());
  expect(touched).toBe(0); expect(directories).toHaveLength(1);
  expect(directories[0]!.entries.map(row => row.address).sort()).toEqual(["@home", "@research"]);
  expect(directories[0]!.entries.every(row => row.modes.length === 0)).toBe(true);
  expect(JSON.stringify(directories)).not.toContain(bob.homeChatJid!);
  await expect(getChatTransportDirectories()).rejects.toThrow();
});

test("transport registry/direct relay deny sends before callbacks or attachment creation", async () => {
  let sent = 0;
  registerChatTransport({ id: "local", kind: "local", validate: () => { sent++; }, send: async () => { sent++; return {} as any; } });
  await expect(run(() => sendViaChatTransport({ source_chat_jid: alice.homeChatJid!, address: parseChatAddress("@research"), content: "message", mode: "queue" }))).rejects.toThrow();
  const relay = createDirectChatToolRelayHandler({} as any, { handleAgentMessage: async () => { sent++; return Response.json({}); } });
  await expect(run(() => relay({ source_chat_jid: alice.homeChatJid!, target_chat_jid: target, content: "message", attachments: [{ filename: "file", content_type: "text/plain", data: new Uint8Array([1]), size: 1, sha256: "hash" }] }))).rejects.toThrow();
  expect(sent).toBe(0); expect((getDb().query("SELECT count(*) n FROM media").get() as any).n).toBe(0);
});

test("read-only session control checks ownership before metadata access and never hydrates", async () => {
  const touched: string[] = [];
  const pool = { isActive: (jid: string) => { touched.push(jid); return false; }, isStreaming: (jid: string) => { touched.push(jid); return false; } };
  const result = await run(() => inspectOwnedSession(pool, { source_chat_jid: alice.homeChatJid!, action: "inspect", target_agent_name: "research" }));
  expect(result.target_chat_jid).toBe(target); expect(result.before?.active).toBe(false);
  expect(result.before?.model).toBeUndefined(); expect(touched).toEqual([target, target]); touched.length = 0;
  for (const request of [{ action: "inspect", target_chat_jid: bob.homeChatJid! }, { action: "wake", target_chat_jid: target }]) await expect(run(() => inspectOwnedSession(pool, { source_chat_jid: alice.homeChatJid!, ...request } as any))).rejects.toThrow();
  expect(touched).toEqual([]);
});

test("actual tools block write paths before file reads and reject foreign session-control targets", async () => {
  const tools = new Map<string, any>(); const hints: any[] = [];
  const pi = { on: (_event: string, fn: any) => hints.push(fn), registerTool: (tool: any) => tools.set(tool.name, tool) };
  chatTool(pi as any); sessionControl(pi as any);
  const prompts = await run(() => Promise.all(hints.map(fn => fn({ systemPrompt: "base" }))));
  expect(prompts[0].systemPrompt).toContain("Cross-session sends and remote transports are disabled");
  expect(prompts[1].systemPrompt).toContain("Only inspect and assess_stuck");
  const directory = await run(() => tools.get("chat").execute("directory", { action: "directory" }));
  expect(directory.content[0].text).toContain("discovery only; sends disabled");
  const result = await run(() => tools.get("chat").execute("call", { target_agent_name: "research", files: ["/etc/secret"], content: "test" }));
  expect(result.details.error).toContain("disabled");
  let called = 0;
  setSessionControlHandler(async req => { called++; return inspectOwnedSession({ isActive: () => false, isStreaming: () => false }, req); });
  const foreign = await run(() => tools.get("session_control").execute("call", { target_chat_jid: bob.homeChatJid, action: "inspect" }));
  expect(foreign.details.ok).toBe(false); expect(called).toBe(0);
  const owned = await run(() => tools.get("session_control").execute("call", { target_agent_name: "research", action: "assess_stuck" }));
  expect(owned.details.ok).toBe(true); expect(owned.details.assessment).toBe("idle"); expect(called).toBe(1);
  const denied = await run(() => tools.get("session_control").execute("call", { target_agent_name: "research", action: "abort" }));
  expect(denied.details.ok).toBe(false); expect(called).toBe(1);
});

test("revoked login invalidates scoped targets even inside an existing context", async () => {
  await run(() => {
    revokeUserWebSessions(alice.userId);
    expect(() => resolveOwnedSessionTarget(alice.homeChatJid!, { target_chat_jid: target })).toThrow();
  });
});
