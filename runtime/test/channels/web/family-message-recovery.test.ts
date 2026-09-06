import { beforeEach, afterEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempWorkspace, setEnv } from "../../helpers.js";
import { closeDatabase, initDatabase, getDb } from "../../../src/db/connection.js";
import { createWebSession, revokeUserWebSessions } from "../../../src/db/web-sessions.js";
import { getUser } from "../../../src/db/users.js";
import { provisionFamilyAccount, updateManagedAccount } from "../../../src/db/account-administration.js";
import { getChatCursor, beginChatRun, rollbackChatRunWithError, getFailedRun, endChatRun } from "../../../src/db/chat-cursors.js";
import { resolveRequestPrincipal } from "../../../src/channels/web/auth/principal.js";
import type { AuthenticatedPrincipal } from "../../../src/core/access-types.js";
import { admitFamilyMessage, resolveFamilyMessageAuthority } from "../../../src/channels/web/messaging/family-message-authority.js";
import { recoverFamilyMessage, readFamilyRecoveryStatus } from "../../../src/channels/web/messaging/family-message-recovery.js";
import { RequestRouterService } from "../../../src/channels/web/request-router-service.js";
import { WebAuthGateway } from "../../../src/channels/web/auth/auth-gateway.js";
import { TotpFailureTracker } from "../../../src/channels/web/auth/totp-failure-tracker.js";
import { WebauthnChallengeTracker } from "../../../src/channels/web/auth/webauthn-challenges.js";
import { WebChannel } from "../../../src/channels/web.js";
import { getExecutionIdentity } from "../../../src/core/execution-context.js";

let alice: AuthenticatedPrincipal, bob: AuthenticatedPrincipal;
let ws: ReturnType<typeof createTempWorkspace>, restore: () => void;
function actor(id: string) { const login = createWebSession(`token-${id}`, id, 3600, "passkey"); return resolveRequestPrincipal(new Request("https://family.local", { headers: { cookie: "piclaw_session=fixture" } }), { mode: "family-shared", authEnabled: true }, { getSession: () => login, getUser: () => getUser(getDb(), id), getLocalDisplayName: () => "unused" })!; }
function input(content = "first", requestId = content, owner = alice) {
  const interaction = admitFamilyMessage(owner, { content, requestId }).interaction;
  const messageId = (getDb().query("SELECT id FROM messages WHERE rowid=?").get(interaction.id) as any).id;
  return { interaction, messageId };
}
function fail(message: ReturnType<typeof input>) {
  beginChatRun(alice.homeChatJid!, message.interaction.timestamp, { prevTs: getChatCursor(alice.homeChatJid!), messageId: message.messageId, startedAt: new Date().toISOString() });
  rollbackChatRunWithError(alice.homeChatJid!, { prevTs: "", failedTs: message.interaction.timestamp, messageId: message.messageId, threadRootId: message.interaction.id, createdAt: new Date().toISOString() });
}
beforeEach(() => {
  ws = createTempWorkspace("piclaw-message-recovery-"); restore = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });
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

test("recovery discovery exposes only oldest owned held ID, never failure details or input text", () => {
  expect(readFamilyRecoveryStatus(alice)).toEqual({ state: "idle" });
  const first = input("private text", "private-text");
  expect(readFamilyRecoveryStatus(alice)).toEqual({ state: "queued" });
  fail(first);
  expect(readFamilyRecoveryStatus(alice)).toEqual({ state: "held", message_rowid: first.interaction.id });
  expect(() => readFamilyRecoveryStatus(bob, alice.homeChatJid!)).toThrow();
  expect(readFamilyRecoveryStatus(bob)).toEqual({ state: "idle" });
  beginChatRun(alice.homeChatJid!, first.interaction.timestamp, { prevTs: "", messageId: first.messageId, startedAt: new Date().toISOString() });
  expect(readFamilyRecoveryStatus(alice)).toEqual({ state: "working" }); endChatRun(alice.homeChatJid!); fail(first);
  getDb().query("UPDATE messages SET content='tampered' WHERE rowid=?").run(first.interaction.id);
  expect(readFamilyRecoveryStatus(alice)).toEqual({ state: "blocked" });
});

test("discovery detects revoked admission after fresh login and GET validates selectors without requiring recent auth", async () => {
  const held = input(); revokeUserWebSessions(alice.userId); alice = actor(alice.userId);
  expect(readFamilyRecoveryStatus(alice)).toEqual({ state: "held", message_rowid: held.interaction.id });
  getDb().query("UPDATE web_sessions SET created_at=? WHERE session_id=?").run(new Date(Date.now()-600_000).toISOString(), alice.authentication.sessionId!);
  const json = (body: unknown, status=200) => Response.json(body, { status });
  const authGateway = new WebAuthGateway({ accessMode: "family-shared", passkeyMode: "", totpSecret: "", internalSecret: "", sessionTtlSeconds: 3600, hasTls: true }, { json, challenges: new WebauthnChallengeTracker(), failureTracker: new TotpFailureTracker() });
  const router = new RequestRouterService({ json, authGateway } as any, "family-shared");
  const request = (query = "") => new Request("https://family.local/agent/message-recovery"+query, { headers: { cookie: `piclaw_session=token-${alice.userId}` } });
  const response = await router.handle(request()); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ state: "held", message_rowid: held.interaction.id });
  for (const query of ["?chat_jid=", "?chat_jid=%20", "?chat_jid=x&chat_jid=y", `?chat_jid=${bob.homeChatJid}`]) expect((await router.handle(request(query))).status).toBe(403);
  expect(() => recoverFamilyMessage(alice, { chatJid: alice.homeChatJid!, messageRowId: held.interaction.id, requestId: "stale-auth", action: "retry" })).toThrow();
});

test("explicit retry binds a new login without modifying original admission, and is idempotent", () => {
  const message = input(); fail(message);
  const original = getDb().query("SELECT * FROM message_execution_authorities").get();
  revokeUserWebSessions(alice.userId); alice = actor(alice.userId);
  expect(() => resolveFamilyMessageAuthority(alice.homeChatJid!, message.messageId)).toThrow();
  const request = { chatJid: alice.homeChatJid!, messageRowId: message.interaction.id, requestId: "recover", action: "retry" as const };
  const result = recoverFamilyMessage(alice, request); expect(result.created).toBe(true);
  expect(recoverFamilyMessage(alice, request).created).toBe(false);
  expect(getFailedRun(alice.homeChatJid!)).toBeUndefined(); expect(getChatCursor(alice.homeChatJid!)).toBe("");
  expect(getDb().query("SELECT * FROM message_execution_authorities").get()).toEqual(original);
  expect(resolveFamilyMessageAuthority(alice.homeChatJid!, message.messageId).provenance.authenticationSessionId).toBe(alice.authentication.sessionId);
  expect(JSON.stringify(getDb().query("SELECT * FROM message_recovery_authorities").all())).not.toContain(`token-${alice.userId}`);
});

test("skip only advances the oldest pending admitted message and prevents execution by an old retry", () => {
  const first = input(), second = input("second"); fail(first);
  expect(() => recoverFamilyMessage(alice, { chatJid: alice.homeChatJid!, messageRowId: second.interaction.id, requestId: "bad", action: "skip" })).toThrow();
  recoverFamilyMessage(alice, { chatJid: alice.homeChatJid!, messageRowId: first.interaction.id, requestId: "skip", action: "skip" });
  expect(getChatCursor(alice.homeChatJid!)).toBe(first.interaction.timestamp);
  expect(() => resolveFamilyMessageAuthority(alice.homeChatJid!, first.messageId)).toThrow();
  expect(resolveFamilyMessageAuthority(alice.homeChatJid!, second.messageId).username).toBe("alice");
  expect(() => recoverFamilyMessage(alice, { chatJid: alice.homeChatJid!, messageRowId: first.interaction.id, requestId: "rewind", action: "retry" })).toThrow();
});

test("foreign/stale/active/tampered recovery denies and SQL failure leaves original hold intact", () => {
  const message = input(); fail(message);
  const request = { chatJid: alice.homeChatJid!, messageRowId: message.interaction.id, requestId: "recover", action: "retry" as const };
  expect(() => recoverFamilyMessage(bob, request)).toThrow();
  beginChatRun(alice.homeChatJid!, message.interaction.timestamp, { prevTs: "", messageId: message.messageId, startedAt: new Date().toISOString() });
  expect(() => recoverFamilyMessage(alice, request)).toThrow("idle"); endChatRun(alice.homeChatJid!); fail(message);
  getDb().exec("CREATE TRIGGER fail_recovery BEFORE INSERT ON message_recovery_authorities BEGIN SELECT RAISE(ABORT,'injected failure'); END;");
  expect(() => recoverFamilyMessage(alice, request)).toThrow("injected failure");
  expect(getFailedRun(alice.homeChatJid!)?.messageId).toBe(message.messageId); expect(getChatCursor(alice.homeChatJid!)).toBe("");
  getDb().exec("DROP TRIGGER fail_recovery");
  getDb().query("UPDATE messages SET content='tampered' WHERE rowid=?").run(message.interaction.id);
  expect(() => recoverFamilyMessage(alice, request)).toThrow();
});

test("HTTP serialises recovery into the chat lane and cancellation prevents queued mutation", async () => {
  const first = input(); fail(first); const queued: Array<() => Promise<void>> = [], lanes: string[] = [], wakes: string[] = [];
  const json = (body: unknown, status=200) => Response.json(body, { status });
  const authGateway = new WebAuthGateway({ accessMode: "family-shared", passkeyMode: "", totpSecret: "", internalSecret: "secret", sessionTtlSeconds: 3600, hasTls: true }, { json, challenges: new WebauthnChallengeTracker(), failureTracker: new TotpFailureTracker() });
  const router = new RequestRouterService({ json, authGateway, queue: { enqueue: (fn: () => Promise<void>, _key: string, lane: string) => { queued.push(fn); lanes.push(lane); } }, resumeChat: (jid: string) => wakes.push(jid) } as any, "family-shared");
  const body = { chat_jid: alice.homeChatJid, message_rowid: first.interaction.id, request_id: "http", action: "retry" };
  const request = (from: string | null, signal?: AbortSignal) => new Request("https://family.local/agent/message-recovery", { method: "POST", headers: { cookie: `piclaw_session=token-${alice.userId}`, ...(from ? { origin: from } : {}) }, body: JSON.stringify(body), signal });
  expect((await router.handle(request(null))).status).toBe(403); expect(queued).toHaveLength(0);
  const control = new AbortController(); const cancelled = router.handle(request("https://family.local", control.signal));
  await Bun.sleep(1); control.abort(); expect((await cancelled).status).toBe(400); await queued.shift()!();
  expect((getDb().query("SELECT count(*) n FROM message_recovery_authorities").get() as any).n).toBe(0);
  const response = router.handle(request("https://family.local")); await Bun.sleep(1); await queued.shift()!();
  const result = await response; expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("private, no-store");
  expect(lanes.every(lane => lane === `chat:${alice.homeChatJid}`)).toBe(true); expect(wakes).toEqual([alice.homeChatJid!]);
});

test("retried held message executes with the new login and persists once without changing original authority", async () => {
  const held = input(); fail(held); const original = getDb().query("SELECT * FROM message_execution_authorities").get();
  revokeUserWebSessions(alice.userId); alice = actor(alice.userId);
  recoverFamilyMessage(alice, { chatJid: alice.homeChatJid!, messageRowId: held.interaction.id, requestId: "new-login", action: "retry" });
  let calls = 0;
  const web = new WebChannel({ queue: { enqueue: () => {} }, agentPool: {
    setSessionBinder: () => {}, getContextUsageForChat: async () => null,
    runAgent: async (_prompt: string, _jid: string, options: any) => {
      calls++; expect(options.executionProvenance.authenticationSessionId).toBe(alice.authentication.sessionId);
      expect(getExecutionIdentity()?.provenance.authenticationSessionId).toBe(alice.authentication.sessionId);
      return { status: "success", result: "recovered", attachments: [] };
    },
  } } as any);
  try {
    await web.processChat(alice.homeChatJid!, "default");
    await web.processChat(alice.homeChatJid!, "default");
    expect(calls).toBe(1); expect(getChatCursor(alice.homeChatJid!)).toBe(held.interaction.timestamp);
    expect(getDb().query("SELECT * FROM message_execution_authorities").get()).toEqual(original);
  } finally { web.sse.closeAll(); }
});
