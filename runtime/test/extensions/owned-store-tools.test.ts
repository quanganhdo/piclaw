import { beforeEach, afterEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempWorkspace, setEnv } from "../helpers.js";
import { initDatabase, closeDatabase, getDb } from "../../src/db/connection.js";
import { createWebSession, revokeUserWebSessions } from "../../src/db/web-sessions.js";
import { getUser } from "../../src/db/users.js";
import { provisionFamilyAccount, updateManagedAccount } from "../../src/db/account-administration.js";
import { createOwnedRoot, archiveOwnedSession } from "../../src/db/owned-session-lifecycle.js";
import { storeMessage } from "../../src/db/messages.js";
import { resolveRequestPrincipal } from "../../src/channels/web/auth/principal.js";
import type { AuthenticatedPrincipal } from "../../src/core/access-types.js";
import { withChatContext } from "../../src/core/chat-context.js";
import { withExecutionIdentity } from "../../src/core/execution-context.js";
import { authoriseExecutionIdentity } from "../../src/agent-pool/execution-identity.js";
import { messagesCrud, runMessagesTool, postMessagesToolMessage } from "../../src/extensions/messages-crud.js";
import { sqlIntrospect } from "../../src/extensions/sql-introspect.js";
import { scheduledTasks } from "../../src/extensions/scheduled-tasks.js";
import { sessionStatus, trackToolStart, clearSessionStatusForTests } from "../../src/extensions/session-status.js";

let alice: AuthenticatedPrincipal, bob: AuthenticatedPrincipal, root: string, archived: string;
let mine: number, other: number, extra: number, seq = 0;
let ws: ReturnType<typeof createTempWorkspace>, restore: () => void;
function actor(id: string) {
  const login = createWebSession(`token-${id}`, id, 3600, "passkey");
  return resolveRequestPrincipal(new Request("https://local", { headers: { cookie: "piclaw_session=fixture" } }), { mode: "family-shared", authEnabled: true }, { getSession: () => login, getUser: () => getUser(getDb(), id), getLocalDisplayName: () => "unused" })!;
}
function message(jid: string, content: string) { return storeMessage({ id: `message-${++seq}`, chat_jid: jid, content, timestamp: new Date().toISOString(), sender: "user", sender_name: "Person", is_from_me: false, is_bot_message: false }); }
function run<T>(fn: () => T | Promise<T>, owner = alice): Promise<T> {
  const jid = owner.homeChatJid!;
  const identity = authoriseExecutionIdentity(getDb(), "family-shared", jid, { actorUserId: owner.userId, ownerUserId: owner.userId, chatJid: jid, kind: "interactive", authenticationSessionId: owner.authentication.sessionId! })!;
  return withExecutionIdentity(identity, () => withChatContext(jid, "web", async () => fn()));
}
function tools() {
  const toolMap = new Map<string, any>(), commands = new Map<string, any>(), replies: any[] = [];
  const pi = { on: () => {}, registerTool: (tool: any) => toolMap.set(tool.name, tool), registerCommand: (name: string, command: any) => commands.set(name, command), sendMessage: (message: any) => replies.push(message) };
  for (const factory of [messagesCrud, sqlIntrospect, scheduledTasks, sessionStatus]) factory(pi as any);
  return { toolMap, commands, replies };
}
beforeEach(() => {
  ws = createTempWorkspace("piclaw-owned-tools-"); restore = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });
  mkdirSync(join(ws.workspace, ".piclaw")); writeFileSync(join(ws.workspace, ".piclaw/config.json"), JSON.stringify({ domains: { access: { mode: "family-shared" } } }));
  closeDatabase(); initDatabase(); clearSessionStatusForTests(); const admin = actor("default");
  for (const name of ["alice", "bob"]) {
    const user = provisionFamilyAccount(getDb(), admin, { username: name, displayName: name });
    getDb().query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key) VALUES (?,'local',?,'key')").run(user.id, name);
    updateManagedAccount(getDb(), admin, user.id, { enabled: true }, { totp: false, passkey: true, rpId: "local" });
    if (name === "alice") alice = actor(user.id); else bob = actor(user.id);
  }
  root = createOwnedRoot(getDb(), alice, "other-root").chat_jid;
  archived = createOwnedRoot(getDb(), alice, "archived").chat_jid;
  mine = message(alice.homeChatJid!, "needle #topic alpha=1");
  other = message(bob.homeChatJid!, "needle #topic FOREIGN alpha=9");
  extra = message(root, "needle #topic alpha=2");
  message(archived, "needle #topic ARCHIVED alpha=8"); archiveOwnedSession(getDb(), alice, archived);
});
afterEach(() => { clearSessionStatusForTests(); closeDatabase(); restore(); ws.cleanup(); });

test("message wildcard, hashtag, FTS and fallback search scope before pagination", async () => {
  for (const query of ["*", "#topic", "needle", "needle AND"]) {
    const result = await run(() => runMessagesTool({ action: "search", chat_jid: "all", query, limit: 50 }));
    expect(JSON.stringify(result)).not.toContain("FOREIGN"); expect(JSON.stringify(result)).not.toContain("ARCHIVED");
    expect((result.details as any).results.map((row: any) => row.rowid)).toEqual([extra, mine]);
  }
  const page = await run(() => runMessagesTool({ action: "search", chat_jid: "*", query: "*", limit: 1, offset: 1 }));
  expect((page.details as any).results[0].rowid).toBe(mine);
  const padded = await run(() => runMessagesTool({ action: "search", chat_jid: " ALL ", query: "*" }));
  expect((padded.details as any).results.map((row: any) => row.rowid)).toEqual([extra, mine]);
  const current = await run(() => runMessagesTool({ action: "search", query: "*" }, bob.homeChatJid!));
  expect((current.details as any).results.map((row: any) => row.rowid)).toEqual([mine]);
  // Force FTS query failure, then exercise the LIKE fallback with the same owner fence.
  getDb().exec("DROP TABLE messages_fts");
  const fallback = await run(() => runMessagesTool({ action: "search", chat_jid: "all", query: "needle" }));
  expect((fallback.details as any).results.map((row: any) => row.rowid)).toEqual([extra, mine]);
});

test("get IDs and surrounding context never expose foreign rows; grep/extract/diff obey all-owner scope", async () => {
  const get = await run(() => runMessagesTool({ action: "get", row_ids: [mine, other, extra], context_before: 20, context_after: 20 }));
  expect((get.details as any).messages.map((item: any) => item.message.rowid)).toEqual([mine, extra]);
  expect((get.details as any).missing_row_ids).toEqual([other]); expect(JSON.stringify(get)).not.toContain("FOREIGN");
  for (const action of ["grep", "extract", "diff"] as const) {
    const result = await run(() => runMessagesTool({ action, chat_jid: "all", pattern: "alpha=(\\d)", regex: true, capture_group: 1, after_row: mine-1, after: "2000-01-01" }));
    expect(JSON.stringify(result)).not.toContain("FOREIGN"); expect(JSON.stringify(result)).not.toContain("ARCHIVED");
    if (action === "extract") expect((result.details as any).values.map((item: any) => item.value)).toEqual(["1", "2"]);
    else expect((result.details as any).count).toBe(2);
  }
});

test("missing context, foreign/blank targets, writes and direct post helper deny without mutation", async () => {
  for (const chat_jid of ["", " ", bob.homeChatJid!, archived, "missing"]) {
    const result = await run(() => runMessagesTool({ query: "*", chat_jid })); expect(result.details?.error).toBe("access_denied");
  }
  expect(runMessagesTool({ action: "get", row_ids: [other] }).details?.error).toBe("access_denied");
  const before = (getDb().query("SELECT count(*) n FROM messages").get() as any).n;
  for (const action of ["add", "post", "delete", "move"] as const) {
    const result = await run(() => runMessagesTool({ action, content: "write", row_ids: [mine], target_chat_jid: root, force: true }));
    expect(result.details?.error).toBe("access_denied");
  }
  expect((await run(() => postMessagesToolMessage({ content: "post", chat_jid: root }))).details?.error).toBe("access_denied");
  expect((getDb().query("SELECT count(*) n FROM messages").get() as any).n).toBe(before);
  await run(() => { revokeUserWebSessions(alice.userId); expect(runMessagesTool({ query: "*" }).details?.error).toBe("access_denied"); });
});

test("scope is isolated across owners and released after each direct messages call", async () => {
  const results = await Promise.all([
    run(async () => { await Bun.sleep(5); return runMessagesTool({ query: "*", chat_jid: "all" }); }),
    run(async () => runMessagesTool({ query: "*", chat_jid: "all" }), bob),
  ]);
  expect((results[0]!.details as any).results.map((row: any) => row.rowid)).toEqual([extra, mine]);
  expect((results[1]!.details as any).results.map((row: any) => row.rowid)).toEqual([other]);
  expect(runMessagesTool({ query: "*", chat_jid: "all" }).details?.error).toBe("access_denied");
});

test("raw SQL, scheduling tools and slash listings deny without exposing instance state", async () => {
  const { toolMap, commands, replies } = tools();
  const sql = await run(() => toolMap.get("introspect_sql").execute("call", { query: "SELECT token FROM web_sessions" }));
  expect(sql.details.error).toBe("access_denied"); expect(sql.details.rows).toEqual([]); expect(JSON.stringify(sql)).not.toContain("token-");
  for (const name of ["scheduled_tasks", "schedule_task"]) {
    for (const action of ["list", "get", "create", "delete"]) {
      const result = await run(() => toolMap.get(name).execute("call", { action, chat_jid: bob.homeChatJid, id: "foreign" }));
      expect(result.details.error).toBe("access_denied");
    }
  }
  await commands.get("tasks").handler("all"); await commands.get("scheduled").handler("all");
  expect(replies.every(reply => reply.content.includes("disabled"))).toBe(true);
});

test("session status only exposes owned sessions without args and never authorises an instance restart", async () => {
  trackToolStart(root, "mine", "read", { path: "/owned-secret" });
  trackToolStart(bob.homeChatJid!, "foreign", "bash", { secret: "FOREIGN" });
  const tool = tools().toolMap.get("session_status");
  const result = await run(() => tool.execute("call", { action: "list" }, undefined, undefined, { chatJid: bob.homeChatJid }));
  expect(result.details.isolation).toBe("owner");
  expect(result.details.sessions).toHaveLength(1); expect(result.details.sessions[0].chat).toBe(root);
  expect(result.details.sessions[0].tools[0].args).toBeUndefined(); expect(JSON.stringify(result)).not.toContain("FOREIGN");
  const checked = await run(() => tool.execute("call", { action: "check" }));
  expect(checked.details.safe_to_restart).toBe(false); expect(checked.details.instance_restart_authorised).toBe(false);
  const missing = await tool.execute("call", { action: "list" }); expect(missing.details.error).toBe("access_denied");
});
