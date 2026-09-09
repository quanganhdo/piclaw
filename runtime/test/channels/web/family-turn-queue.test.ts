import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempWorkspace, setEnv } from "../../helpers.js";
import { closeDatabase, getDb, initDatabase } from "../../../src/db/connection.js";
import { createWebSession, revokeUserWebSessions } from "../../../src/db/web-sessions.js";
import { getUser } from "../../../src/db/users.js";
import { provisionFamilyAccount, updateManagedAccount } from "../../../src/db/account-administration.js";
import { resolveRequestPrincipal } from "../../../src/channels/web/auth/principal.js";
import type { AuthenticatedPrincipal } from "../../../src/core/access-types.js";
import { admitFamilyMessage, resolveFamilyMessageAuthority } from "../../../src/channels/web/messaging/family-message-authority.js";
import { getMessagesSince, getTimeline } from "../../../src/db/messages.js";
import { getIdentityConfig } from "../../../src/core/config.js";
import { completeFamilyTurnRun, listOwnedFamilyQueuedTurns, removeOwnedFamilyQueuedTurn, reorderOwnedFamilyQueuedTurns, settleRecoveredFamilyTurn } from "../../../src/db/family-turn-queue.js";
import { beginChatRun, clearInflightMarker } from "../../../src/db/chat-cursors.js";
import { projectFamilySseEvent } from "../../../src/channels/web/sse/family-event-projector.js";
import { getHashtagResponse, getSearchResponse, getThreadResponse } from "../../../src/channels/web/timeline-service.js";
import { handleFamilyTurnControl } from "../../../src/channels/web/http/family-turn-control.js";
import { getExecutionIdentity } from "../../../src/core/execution-context.js";

let owner: AuthenticatedPrincipal, foreign: AuthenticatedPrincipal;
let workspace: ReturnType<typeof createTempWorkspace>, restore: () => void;
function actor(id: string) {
  const login = createWebSession(`token-${id}`, id, 3600, "passkey");
  return resolveRequestPrincipal(new Request("https://family.local", { headers: { cookie: "piclaw_session=fixture" } }),
    { mode: "family-shared", authEnabled: true }, { getSession: () => login, getUser: () => getUser(getDb(), id), getLocalDisplayName: () => "unused" })!;
}
beforeEach(() => {
  workspace = createTempWorkspace("family-turn-queue-");
  restore = setEnv({ PICLAW_WORKSPACE: workspace.workspace, PICLAW_STORE: workspace.store, PICLAW_DATA: workspace.data });
  mkdirSync(join(workspace.workspace, ".piclaw"));
  writeFileSync(join(workspace.workspace, ".piclaw/config.json"), JSON.stringify({ domains: { access: { mode: "family-shared" } } }));
  closeDatabase(); initDatabase(); const admin = actor("default");
  for (const name of ["owner", "foreign"]) {
    const user = provisionFamilyAccount(getDb(), admin, { username: name, displayName: name });
    getDb().query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key) VALUES (?,'family.local',?,'key')").run(user.id, name);
    updateManagedAccount(getDb(), admin, user.id, { enabled: true }, { totp: false, passkey: true, rpId: "family.local" });
    if (name === "owner") owner = actor(user.id); else foreign = actor(user.id);
  }
});
afterEach(() => { closeDatabase(); restore(); workspace.cleanup(); });

function controlRequest(path: string, body?: Record<string, unknown>) {
  const chat = encodeURIComponent(owner.homeChatJid!);
  return new Request(`https://family.local${path}${body ? "" : `?chat_jid=${chat}`}`, {
    method: body ? "POST" : "GET",
    headers: body ? { origin: "https://family.local", "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

function controlChannel(overrides: Record<string, unknown> = {}) {
  return {
    json: (value: unknown, status = 200) => Response.json(value, { status }),
    broadcastEvent: () => {},
    getAgentStatus: () => null,
    agentPool: {},
    ...overrides,
  } as any;
}

test("durable family queue exposes only held items and promotes one turn at a time", () => {
  const first = admitFamilyMessage(owner, { content: "first", requestId: "first", mode: "send" });
  const second = admitFamilyMessage(owner, { content: "second", requestId: "second", mode: "queue" });
  const third = admitFamilyMessage(owner, { content: "third", requestId: "third", mode: "queue_all" });
  expect(first.queue.state).toBe("ready"); expect(second.queue.state).toBe("held"); expect(third.queue.state).toBe("held");
  expect(getTimeline(owner.homeChatJid!, 10).map(row => row.id)).toEqual([first.interaction.id]);
  expect(getMessagesSince(owner.homeChatJid!, "", getIdentityConfig().assistantName).map(row => row.content)).toEqual(["first"]);
  expect(listOwnedFamilyQueuedTurns(owner).map((row: any) => row.content)).toEqual(["second", "third"]);
  expect(() => listOwnedFamilyQueuedTurns(foreign, owner.homeChatJid!)).toThrow();
  expect(reorderOwnedFamilyQueuedTurns(owner, owner.homeChatJid!, 1, 0)).toBe(true);
  expect(listOwnedFamilyQueuedTurns(owner).map((row: any) => row.content)).toEqual(["third", "second"]);
  const id = (getDb().query("SELECT id FROM messages WHERE rowid=?").get(first.interaction.id) as { id: string }).id;
  beginChatRun(owner.homeChatJid!, first.interaction.timestamp, { prevTs: "", messageId: id, startedAt: new Date().toISOString() });
  completeFamilyTurnRun(owner.homeChatJid!);
  expect(getMessagesSince(owner.homeChatJid!, first.interaction.timestamp, getIdentityConfig().assistantName).map(row => row.content)).toEqual(["third"]);
  expect(() => resolveFamilyMessageAuthority(owner.homeChatJid!, id)).toThrow();
});

test("queued removal is terminal and idempotent admission cannot resurrect it", () => {
  const active = admitFamilyMessage(owner, { content: "active", requestId: "active" });
  const queued = admitFamilyMessage(owner, { content: "private queued", requestId: "queued", mode: "queue" });
  expect(removeOwnedFamilyQueuedTurn(owner, owner.homeChatJid!, queued.interaction.id)).toBe(true);
  expect(removeOwnedFamilyQueuedTurn(owner, owner.homeChatJid!, queued.interaction.id)).toBe(false);
  expect(admitFamilyMessage(owner, { content: "private queued", requestId: "queued", mode: "queue" }).queue.state).toBe("removed");
  expect(getTimeline(owner.homeChatJid!, 10).map(row => row.id)).toEqual([active.interaction.id]);
  expect((getSearchResponse(owner.homeChatJid!, "private queued", 10, 0).body as any).results).toEqual([]);
  expect((getHashtagResponse(owner.homeChatJid!, "queued", 10, 0).body as any).posts).toEqual([]);
  expect(getThreadResponse(owner.homeChatJid!, queued.interaction.id).status).toBe(404);
});

test("recovery settles a ready turn only after clearing the old run barrier", () => {
  const first = admitFamilyMessage(owner, { content: "first", requestId: "first" });
  const second = admitFamilyMessage(owner, { content: "second", requestId: "second", mode: "queue" });
  const messageId = (getDb().query("SELECT id FROM messages WHERE rowid=?").get(first.interaction.id) as { id: string }).id;
  beginChatRun(owner.homeChatJid!, first.interaction.timestamp, { prevTs: "", messageId, startedAt: new Date().toISOString() });
  expect(settleRecoveredFamilyTurn(owner.homeChatJid!, messageId).settled).toBe(false);
  clearInflightMarker(owner.homeChatJid!);
  expect(settleRecoveredFamilyTurn(owner.homeChatJid!, messageId).settled).toBe(true);
  expect((getDb().query("SELECT state FROM family_turn_queue WHERE message_rowid=?").get(second.interaction.id) as any).state).toBe("ready");
  expect(getMessagesSince(owner.homeChatJid!, first.interaction.timestamp, getIdentityConfig().assistantName).map(row => row.content)).toEqual(["second"]);
});

test("family SSE projection removes unknown, extension, widget, tool arguments and private blocks", () => {
  expect(projectFamilySseEvent("unknown", { chat_jid: owner.homeChatJid, secret: "x" })).toBeNull();
  expect(projectFamilySseEvent("extension_ui_widget", { chat_jid: owner.homeChatJid, secret: "x" })).toBeNull();
  const status = projectFamilySseEvent("agent_status", { chat_jid: owner.homeChatJid, type: "tool_call", tool_name: "read", tool_args: { path: "PRIVATE" }, runtime_generation: "PRIVATE" });
  expect(status).toEqual({ chat_jid: owner.homeChatJid, type: "tool_call", tool_name: "read" });
  const response: any = projectFamilySseEvent("agent_response", { chat_jid: owner.homeChatJid, id: 1, data: { type: "agent_response", content: "ok", content_blocks: [
    { type: "agent_timing", turn_id: "turn" }, { type: "generated_widget", html: "PRIVATE" }, { type: "adaptive_card", payload: "PRIVATE" },
  ] } });
  expect(response.data.content_blocks).toEqual([{ type: "agent_timing", turn_id: "turn" }]);
  expect(JSON.stringify(response)).not.toContain("PRIVATE");
});

test("family queue controls stay owner-scoped and mutate only held rows", async () => {
  admitFamilyMessage(owner, { content: "active", requestId: "active" });
  const first = admitFamilyMessage(owner, { content: "first queued", requestId: "first", mode: "queue" });
  const second = admitFamilyMessage(owner, { content: "second queued", requestId: "second", mode: "queue" });
  const events: Array<{ type: string; data: any }> = [];
  const channel = controlChannel({ broadcastEvent: (type: string, data: any) => events.push({ type, data }) });

  const listed = await handleFamilyTurnControl(channel, controlRequest("/agent/queue-state"), owner);
  expect((await listed.json()).items.map((item: any) => item.row_id)).toEqual([first.interaction.id, second.interaction.id]);
  expect((await handleFamilyTurnControl(channel, controlRequest("/agent/queue-state"), foreign)).status).toBe(403);

  const reorder = await handleFamilyTurnControl(channel, controlRequest("/agent/queue-reorder", {
    chat_jid: owner.homeChatJid, from_index: 1, to_index: 0,
  }), owner);
  expect(await reorder.json()).toMatchObject({ status: "ok", reordered: true });
  expect(listOwnedFamilyQueuedTurns(owner).map((item: any) => item.row_id)).toEqual([second.interaction.id, first.interaction.id]);

  const foreignRemove = await handleFamilyTurnControl(channel, controlRequest("/agent/queue-remove", {
    chat_jid: owner.homeChatJid, row_id: second.interaction.id,
  }), foreign);
  expect(foreignRemove.status).toBe(403);
  const removed = await handleFamilyTurnControl(channel, controlRequest("/agent/queue-remove", {
    chat_jid: owner.homeChatJid, row_id: second.interaction.id,
  }), owner);
  expect(await removed.json()).toMatchObject({ removed: true, count: 1 });
  expect(events).toEqual([{ type: "agent_followup_removed", data: { chat_jid: owner.homeChatJid, row_id: second.interaction.id } }]);
});

test("queued steering and abort use the current live login without hydrating foreign sessions", async () => {
  const active = admitFamilyMessage(owner, { content: "active", requestId: "active" });
  const queued = admitFamilyMessage(owner, { content: "steer now", requestId: "steer", mode: "queue" });
  const activeMessageId = (getDb().query("SELECT id FROM messages WHERE rowid=?").get(active.interaction.id) as { id: string }).id;
  beginChatRun(owner.homeChatJid!, active.interaction.timestamp, { prevTs: "", messageId: activeMessageId, startedAt: new Date().toISOString() });
  revokeUserWebSessions(owner.userId);
  owner = actor(owner.userId);
  const currentLogin = owner.authentication.sessionId;
  const calls: string[] = [], events: string[] = [];
  const channel = controlChannel({
    getAgentStatus: () => ({ turn_id: "turn-live" }),
    broadcastEvent: (type: string) => events.push(type),
    agentPool: {
      queueOwnedStreamingMessage: async (_chatJid: string, text: string) => {
        expect(getExecutionIdentity()?.provenance.authenticationSessionId).toBe(currentLogin);
        calls.push(`steer:${text}`); return { queued: true };
      },
      abortOwnedRun: async () => {
        expect(getExecutionIdentity()?.provenance.authenticationSessionId).toBe(currentLogin);
        calls.push("abort"); return { status: "success" };
      },
    },
  });

  const steered = await handleFamilyTurnControl(channel, controlRequest("/agent/queue-steer", {
    chat_jid: owner.homeChatJid, row_id: queued.interaction.id,
  }), owner);
  expect(steered.status).toBe(201);
  expect((getDb().query("SELECT state FROM family_turn_queue WHERE message_rowid=?").get(queued.interaction.id) as any).state).toBe("steered");
  expect((getDb().query("SELECT is_steering_message FROM messages WHERE rowid=?").get(queued.interaction.id) as any).is_steering_message).toBe(1);

  expect((await handleFamilyTurnControl(channel, controlRequest("/agent/runs/abort", {
    chat_jid: owner.homeChatJid, turn_id: "stale-turn",
  }), owner)).status).toBe(409);
  const aborted = await handleFamilyTurnControl(channel, controlRequest("/agent/runs/abort", {
    chat_jid: owner.homeChatJid, turn_id: "turn-live",
  }), owner);
  expect(aborted.status).toBe(200);
  expect(calls).toEqual(["steer:steer now", "abort"]);
  expect(events).toEqual(["agent_followup_removed", "new_post", "agent_steer_queued"]);
});
