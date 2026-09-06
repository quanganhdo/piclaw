import { beforeEach, afterEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempWorkspace, setEnv } from "../../helpers.js";
import { closeDatabase, getDb, initDatabase } from "../../../src/db/connection.js";
import { createWebSession, revokeUserWebSessions } from "../../../src/db/web-sessions.js";
import { getUser, updateUser } from "../../../src/db/users.js";
import { provisionFamilyAccount, updateManagedAccount } from "../../../src/db/account-administration.js";
import { resolveRequestPrincipal } from "../../../src/channels/web/auth/principal.js";
import type { AuthenticatedPrincipal } from "../../../src/core/access-types.js";
import { admitFamilyMessage, resolveFamilyMessageAuthority } from "../../../src/channels/web/messaging/family-message-authority.js";
import { RequestRouterService } from "../../../src/channels/web/request-router-service.js";
import { WebAuthGateway } from "../../../src/channels/web/auth/auth-gateway.js";
import { WebauthnChallengeTracker } from "../../../src/channels/web/auth/webauthn-challenges.js";
import { TotpFailureTracker } from "../../../src/channels/web/auth/totp-failure-tracker.js";
import { getExecutionIdentity } from "../../../src/core/execution-context.js";
import { getChatJid } from "../../../src/core/chat-context.js";
import { getChatCursor, beginChatRun, rollbackChatRunWithError } from "../../../src/db/chat-cursors.js";
import { storeMessage } from "../../../src/db/messages.js";
import { WebChannel } from "../../../src/channels/web.js";
import { handleAgentMessage } from "../../../src/channels/web/handlers/agent.js";

let alice: AuthenticatedPrincipal, bob: AuthenticatedPrincipal;
let ws: ReturnType<typeof createTempWorkspace>, restore: () => void;
const webs: WebChannel[] = [];
function actor(id: string) {
  const login = createWebSession(`token-${id}`, id, 3600, "passkey");
  return resolveRequestPrincipal(new Request("https://family.local", { headers: { cookie: "piclaw_session=fixture" } }), { mode: "family-shared", authEnabled: true }, { getSession: () => login, getUser: () => getUser(getDb(), id), getLocalDisplayName: () => "unused" })!;
}
function request(body: unknown, target = alice.homeChatJid!, origin: string | null = "https://family.local") {
  return new Request(`https://family.local/agent/default/message?chat_jid=${encodeURIComponent(target)}`, { method: "POST", headers: { cookie: `piclaw_session=token-${alice.userId}`, ...(origin ? { origin } : {}), "x-piclaw-user-id": bob.userId, "x-piclaw-internal-secret": "secret" }, body: JSON.stringify(body) });
}
function router(channelExtra: Record<string, unknown> = {}) {
  const json = (body: unknown, status=200) => Response.json(body, { status });
  const authGateway = new WebAuthGateway({ accessMode: "family-shared", passkeyMode: "", totpSecret: "", internalSecret: "secret", sessionTtlSeconds: 3600, hasTls: true }, { json, challenges: new WebauthnChallengeTracker(), failureTracker: new TotpFailureTracker() });
  return new RequestRouterService({ json, authGateway, broadcastEvent: () => {}, resumeChat: () => {}, ...channelExtra } as any, "family-shared");
}
function web(pool: any) {
  const instance = new WebChannel({ queue: { enqueue: () => {} }, agentPool: { setSessionBinder: () => {}, getContextUsageForChat: async () => null, ...pool } } as any);
  webs.push(instance); return instance;
}
beforeEach(() => {
  ws = createTempWorkspace("piclaw-family-ingress-"); restore = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });
  mkdirSync(join(ws.workspace, ".piclaw")); writeFileSync(join(ws.workspace, ".piclaw/config.json"), JSON.stringify({ domains: { access: { mode: "family-shared" } } }));
  closeDatabase(); initDatabase(); const admin = actor("default");
  for (const name of ["alice", "bob"]) {
    const user = provisionFamilyAccount(getDb(), admin, { username: name, displayName: name }).id;
    getDb().query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key) VALUES (?,'family.local',?,'key')").run(user, name);
    updateManagedAccount(getDb(), admin, user, { enabled: true }, { totp: false, passkey: true, rpId: "family.local" });
    if (name === "alice") alice = actor(user); else bob = actor(user);
  }
});
afterEach(() => { for (const instance of webs.splice(0)) instance.sse.closeAll(); closeDatabase(); restore(); ws.cleanup(); });

test("admission atomically persists owner/login authority and retries without duplicate messages", () => {
  const first = admitFamilyMessage(alice, { content: "hello", requestId: "request" });
  const again = admitFamilyMessage(alice, { content: "hello", requestId: "request" });
  expect(first.created).toBe(true); expect(again.created).toBe(false); expect(again.interaction.id).toBe(first.interaction.id);
  const row = getDb().query("SELECT * FROM message_execution_authorities").get() as any;
  expect(row.owner_user_id).toBe(alice.userId); expect(row.login_session_id).toBe(alice.authentication.sessionId);
  expect(JSON.stringify(row)).not.toContain(`token-${alice.userId}`);
  expect(() => admitFamilyMessage(alice, { content: "different", requestId: "request" })).toThrow();
  expect(() => admitFamilyMessage(alice, { chatJid: bob.homeChatJid!, content: "foreign", requestId: "foreign" })).toThrow();
  getDb().exec("CREATE TRIGGER fail_admission BEFORE INSERT ON message_execution_authorities BEGIN SELECT RAISE(ABORT,'authority failure'); END;");
  expect(() => admitFamilyMessage(alice, { content: "rollback", requestId: "rollback" })).toThrow();
  expect((getDb().query("SELECT count(*) n FROM messages").get() as any).n).toBe(1);
});

test("queued processChat recovers persisted identity without ambient caller context and labels it from live user", async () => {
  const admitted = admitFamilyMessage(alice, { content: "hello", requestId: "request" });
  updateUser(getDb(), alice.userId, { displayName: "Alice Updated" });
  let calls = 0;
  const instance = web({ runAgent: async (prompt: string, jid: string, options: any) => {
    calls++;
    expect(jid).toBe(alice.homeChatJid!); expect(getChatJid()).toBe(jid);
    expect(getExecutionIdentity()?.username).toBe("alice"); expect(prompt).toContain("Alice Updated");
    expect(options.executionProvenance.authenticationSessionId).toBe(alice.authentication.sessionId);
    expect(options.userId).toBe(alice.userId);
    expect(options.toolCeilingFilter("messages")).toBe(true); expect(options.toolCeilingFilter("bash")).toBe(false); expect(options.toolCeilingFilter("keychain")).toBe(false);
    expect(options.scheduleIdleAutoCompaction).toBe(false); expect(options.deferToolEnabledContinuation).toBe(false);
    return { status: "success", result: "reply", attachments: [] };
  } });
  await instance.processChat(alice.homeChatJid!, "default");
  expect(calls).toBe(1); expect(getExecutionIdentity()).toBeNull();
  expect(getChatCursor(alice.homeChatJid!)).toBe(admitted.interaction.timestamp);
  expect(getDb().query("SELECT content,thread_id FROM messages WHERE chat_jid=? AND is_bot_message=1").get(alice.homeChatJid!)).toEqual({ content: "reply", thread_id: admitted.interaction.id });
});

test("revocation before dequeue blocks runtime creation and does not consume the message", async () => {
  admitFamilyMessage(alice, { content: "queued", requestId: "request" }); revokeUserWebSessions(alice.userId);
  let calls = 0; const instance = web({ runAgent: async () => { calls++; throw Error("must not execute"); } });
  await expect(instance.processChat(alice.homeChatJid!, "default")).rejects.toThrow("Session access denied");
  expect(calls).toBe(0); expect(getChatCursor(alice.homeChatJid!)).toBe("");
});

test("unprovenanced or changed payloads and foreign thread IDs never execute", async () => {
  const msg = admitFamilyMessage(alice, { content: "original", requestId: "request" }).interaction;
  const id = (getDb().query("SELECT id FROM messages WHERE rowid=?").get(msg.id) as any).id;
  getDb().query("UPDATE messages SET content='changed' WHERE rowid=?").run(msg.id);
  expect(() => resolveFamilyMessageAuthority(alice.homeChatJid!, id)).toThrow();
  const foreign = admitFamilyMessage(bob, { content: "foreign", requestId: "request" }).interaction;
  expect(() => admitFamilyMessage(alice, { content: "reply", requestId: "reply", threadId: foreign.id })).toThrow();
  getDb().query("DELETE FROM messages WHERE rowid=?").run(msg.id);
  storeMessage({ id: "unowned-input", chat_jid: alice.homeChatJid!, content: "no proof", sender: alice.userId, sender_name: "Alice", timestamp: new Date().toISOString(), is_bot_message: false });
  const instance = web({ runAgent: async () => { throw Error("must not run"); } });
  await expect(instance.processChat(alice.homeChatJid!, "default")).rejects.toThrow("Session access denied");
});

test("HTTP permits only authenticated plain-text/idempotent admission and rejects privileged payloads", async () => {
  const wakes: unknown[] = []; const ingress = router({ resumeChat: (...args: unknown[]) => wakes.push(args) });
  expect((await ingress.handle(request({ content: "hello", request_id: "request" }, alice.homeChatJid!, null))).status).toBe(403);
  for (const content of ["/model dangerous", "@research go", " "]) expect((await ingress.handle(request({ content, request_id: "bad" }))).status).toBe(400);
  for (const field of ["owner_user_id", "executionProvenance", "media_ids", "content_blocks", "mode"]) expect((await ingress.handle(request({ content: "hello", request_id: "bad", [field]: "spoof" }))).status).toBe(400);
  expect((await ingress.handle(request({ content: "hello", request_id: "foreign" }, bob.homeChatJid!))).status).toBe(403);
  expect(wakes).toHaveLength(0);
  const response = await ingress.handle(request({ content: "hello", request_id: "request" }));
  expect(response.status).toBe(201); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect((await response.json()).user_message.chat_jid).toBe(alice.homeChatJid!);
  expect((await ingress.handle(request({ content: "hello", request_id: "request" }))).status).toBe(200);
  expect(wakes).toHaveLength(2);
  expect((await handleAgentMessage({ json: (value: unknown, status: number) => Response.json(value, { status }) } as any, request({ content: "bypass" }), "/agent/default/message", alice.homeChatJid!, "default")).status).toBe(403);
});

test("persisted messages drain individually with distinct current-owner contexts and resume the remainder", async () => {
  const first = admitFamilyMessage(alice, { content: "first", requestId: "first" });
  const second = admitFamilyMessage(alice, { content: "second", requestId: "second" });
  admitFamilyMessage(bob, { content: "bob input", requestId: "first" });
  const calls: Array<{ user: string; prompt: string }> = [], wakeups: unknown[] = [];
  const instance = web({ runAgent: async (prompt: string, _jid: string, options: any) => {
    calls.push({ user: options.executionProvenance.ownerUserId, prompt });
    expect(getExecutionIdentity()?.provenance.ownerUserId).toBe(options.executionProvenance.ownerUserId);
    return { status: "success", result: "reply", attachments: [] };
  } });
  instance.resumeChat = (...args: any[]) => { wakeups.push(args); };
  await instance.processChat(alice.homeChatJid!, "default");
  expect(getChatCursor(alice.homeChatJid!)).toBe(first.interaction.timestamp); expect(wakeups).toHaveLength(1);
  await instance.processChat(alice.homeChatJid!, "default");
  expect(getChatCursor(alice.homeChatJid!)).toBe(second.interaction.timestamp);
  await instance.processChat(bob.homeChatJid!, "default");
  expect(calls.map(call => call.user)).toEqual([alice.userId, alice.userId, bob.userId]);
  expect(calls[0]!.prompt).not.toContain("bob input");
  expect(getExecutionIdentity()).toBeNull();
});

test("revocation during a run prevents reply persistence and leaves the input unconsumed", async () => {
  admitFamilyMessage(alice, { content: "pending", requestId: "request" });
  const instance = web({ runAgent: async () => {
    revokeUserWebSessions(alice.userId);
    return { status: "success", result: "must not persist", attachments: [] };
  } });
  await instance.processChat(alice.homeChatJid!, "default");
  expect((getDb().query("SELECT count(*) n FROM messages WHERE chat_jid=? AND is_bot_message=1").get(alice.homeChatJid!) as any).n).toBe(0);
  expect(getChatCursor(alice.homeChatJid!)).toBe("");
});

test("generic user persistence cannot inject family inputs outside admission", () => {
  const instance = web({ runAgent: async () => { throw Error("unused"); } });
  expect(instance.storeMessage(alice.homeChatJid!, "unprovenanced", false, [])).toBeNull();
  expect((getDb().query("SELECT count(*) n FROM messages").get() as any).n).toBe(0);
});

test("failed family message is held instead of silently skipped by legacy replay selection", async () => {
  const admitted = admitFamilyMessage(alice, { content: "held input", requestId: "held" }).interaction;
  const messageId = (getDb().query("SELECT id FROM messages WHERE rowid=?").get(admitted.id) as any).id;
  beginChatRun(alice.homeChatJid!, admitted.timestamp, { prevTs: "", messageId, startedAt: new Date().toISOString() });
  rollbackChatRunWithError(alice.homeChatJid!, { prevTs: "", failedTs: admitted.timestamp, messageId, threadRootId: admitted.id, createdAt: new Date().toISOString() });
  let executed = false;
  const instance = web({ runAgent: async () => { executed = true; return { status: "success", result: "wrong" }; } });
  await expect(instance.processChat(alice.homeChatJid!, "default")).rejects.toThrow("held for an authorised recovery action");
  expect(executed).toBe(false); expect(getChatCursor(alice.homeChatJid!)).toBe("");
});
