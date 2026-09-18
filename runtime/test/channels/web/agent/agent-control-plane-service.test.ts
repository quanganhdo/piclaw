import { describe, expect, test } from "bun:test";

import "../../../helpers.js";
import { beginChatRun, getDb, getInflightRuns, initDatabase } from "../../../../src/db.js";
import {
  buildStalledWorkDiagnostic,
  WebAgentControlPlaneService,
} from "../../../../src/channels/web/agent/agent-control-plane-service.js";
import type { QueuedFollowupLifecycleService } from "../../../../src/channels/web/runtime/queued-followup-lifecycle-service.js";

function abortRequest(payload: unknown): Request {
  return new Request("https://example.com/agent/runs/abort", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type QueueLifecycleStub = Pick<
  QueuedFollowupLifecycleService,
  "getQueuedFollowupCount" | "listQueuedStateItems" | "prependQueuedFollowupItem" | "removeQueuedFollowupForAction"
>;

function createService(overrides: Partial<ConstructorParameters<typeof WebAgentControlPlaneService>[0]> = {}) {
  const queueLifecycle: QueueLifecycleStub = {
    getQueuedFollowupCount: () => 0,
    listQueuedStateItems: () => [],
    prependQueuedFollowupItem: () => {},
    removeQueuedFollowupForAction: async () => ({ removed: null, source: null }),
  };

  return new WebAgentControlPlaneService({
    defaultChatJid: "web:default",
    defaultAgentId: "default",
    json: jsonResponse,
    broadcastEvent: () => {},
    queue: { enqueue: () => {} },
    agentPool: { setSessionBinder: () => {} },
    queuedFollowupLifecycle: queueLifecycle,
    queuePendingSteering: () => {},
    storeMessage: () => null,
    processChat: () => {},
    ...overrides,
  });
}

describe("buildStalledWorkDiagnostic", () => {
  const progress = {
    chatJid: "web:tool-run",
    phase: "tool_execution" as const,
    startedAt: Date.parse("2026-08-07T12:00:00.000Z"),
    lastProgressAt: Date.parse("2026-08-07T12:00:20.000Z"),
  };

  test("uses progress age rather than treating every tool-execution phase as stale", () => {
    expect(buildStalledWorkDiagnostic(progress, {
      nowMs: Date.parse("2026-08-07T12:00:50.000Z"),
      thresholdMs: 60_000,
    })).toEqual({
      detected: false,
      phase: "tool_execution",
      age_ms: 30_000,
      threshold_ms: 60_000,
      started_at: "2026-08-07T12:00:00.000Z",
      last_progress_at: "2026-08-07T12:00:20.000Z",
    });
  });

  test("reports stalled work only after the configured threshold", () => {
    expect(buildStalledWorkDiagnostic(progress, {
      nowMs: Date.parse("2026-08-07T12:01:20.000Z"),
      thresholdMs: 60_000,
    })).toMatchObject({ detected: true, age_ms: 60_000, threshold_ms: 60_000 });
  });

  test("keeps age diagnostics without claiming a stall when detection is disabled", () => {
    expect(buildStalledWorkDiagnostic(progress, {
      nowMs: Date.parse("2026-08-07T12:10:20.000Z"),
      thresholdMs: 0,
    })).toMatchObject({ detected: false, age_ms: 600_000, threshold_ms: null });
  });
});

describe("WebAgentControlPlaneService", () => {
  test("persists provider-ready OOBE completion at the instance level", async () => {
    initDatabase();
    const service = createService();
    const response = await service.handleAgentOobeComplete(new Request("https://example.com/agent/oobe/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "provider-ready" }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      kind: "provider-ready",
      provider_ready_completed_instance: true,
    });
  });

  test("shapes autoresearch control responses with default chat fallbacks", async () => {
    const statusChats: string[] = [];
    const stopInputs: Array<{ chat_jid: string; generate_report: boolean }> = [];
    const dismissChats: string[] = [];
    const service = createService({
      getAutoresearchWidgetPayload: (chatJid) => {
        statusChats.push(chatJid);
        return { chat_jid: chatJid, live: true };
      },
      stopAutoresearchFromWeb: async (input) => {
        stopInputs.push(input);
        return { stopped: true };
      },
      dismissAutoresearchWidget: (chatJid) => {
        dismissChats.push(chatJid);
        return false;
      },
    });

    const statusResponse = await service.handleAutoresearchStatus(new Request("https://example.com/agent/autoresearch/status"));
    expect(statusResponse.status).toBe(200);
    expect(await statusResponse.json()).toEqual({ chat_jid: "web:default", live: true });

    const stopResponse = await service.handleAutoresearchStop(new Request("https://example.com/agent/autoresearch/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generate_report: false }),
    }));
    expect(stopResponse.status).toBe(200);
    expect(await stopResponse.json()).toEqual({
      status: "ok",
      chat_jid: "web:default",
      result: { stopped: true },
    });

    const dismissResponse = await service.handleAutoresearchDismiss(new Request("https://example.com/agent/autoresearch/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_jid: "web:branch" }),
    }));
    expect(dismissResponse.status).toBe(200);
    expect(await dismissResponse.json()).toEqual({
      status: "noop",
      chat_jid: "web:branch",
    });

    expect(statusChats).toEqual(["web:default"]);
    expect(stopInputs).toEqual([{ chat_jid: "web:default", generate_report: false }]);
    expect(dismissChats).toEqual(["web:branch"]);
  });

  test("shapes queue state and queue removal responses via queued follow-up lifecycle dependency", async () => {
    const events: Array<{ type: string; data: unknown }> = [];
    const queueLifecycle: QueueLifecycleStub = {
      getQueuedFollowupCount: (chatJid: string) => (chatJid === "web:branch" ? 1 : 0),
      listQueuedStateItems: () => [{ row_id: 7, content: "queued followup", timestamp: "2024-01-01T00:00:00.000Z", thread_id: 11 }],
      prependQueuedFollowupItem: () => {},
      removeQueuedFollowupForAction: async () => ({
        removed: {
          rowId: 7,
          queuedContent: "queued followup",
          threadId: 11,
          queuedAt: "2024-01-01T00:00:00.000Z",
          materializeRetries: 0,
        },
        source: "deferred",
      }),
    };
    const service = createService({
      broadcastEvent: (type, data) => {
        events.push({ type, data });
      },
      queuedFollowupLifecycle: queueLifecycle,
    });

    const stateResponse = await service.handleAgentQueueState(new Request("https://example.com/agent/queue-state?chat_jid=web%3Abranch"));
    expect(stateResponse.status).toBe(200);
    expect(await stateResponse.json()).toEqual({
      count: 1,
      items: [{ row_id: 7, content: "queued followup", timestamp: "2024-01-01T00:00:00.000Z", thread_id: 11 }],
    });

    const removeResponse = await service.handleAgentQueueRemove(new Request("https://example.com/agent/queue-remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_jid: "web:branch", row_id: 7 }),
    }));
    expect(removeResponse.status).toBe(200);
    expect(await removeResponse.json()).toEqual({
      status: "ok",
      removed: true,
      row_id: 7,
      count: 1,
    });
    expect(events).toEqual([
      {
        type: "agent_followup_removed",
        data: { chat_jid: "web:branch", row_id: 7, thread_id: 11 },
      },
    ]);
  });

  test("lists active runs and supports targeted abort, stale marker clear, and queue drain", async () => {
    initDatabase();
    const events: Array<{ type: string; data: unknown }> = [];
    const controlCalls: Array<{ chatJid: string; command: unknown }> = [];
    const removedRows: number[] = [];
    beginChatRun("web:hung", "2024-01-01T00:00:02.000Z", {
      prevTs: "2024-01-01T00:00:01.000Z",
      messageId: "msg-hung",
      startedAt: "2024-01-01T00:00:03.000Z",
    });
    const queueLifecycle: QueueLifecycleStub = {
      getQueuedFollowupCount: () => 2,
      listQueuedStateItems: () => [
        { rowId: 41, content: "first" },
        { row_id: 42, content: "second" },
      ],
      prependQueuedFollowupItem: () => {},
      removeQueuedFollowupForAction: async (_chatJid, rowId) => {
        removedRows.push(rowId);
        return {
          removed: {
            rowId,
            queuedContent: `queued-${rowId}`,
            queuedAt: "2024-01-01T00:00:00.000Z",
            materializeRetries: 0,
          },
          source: "deferred",
        };
      },
    };
    const service = createService({
      broadcastEvent: (type, data) => events.push({ type, data }),
      queuedFollowupLifecycle: queueLifecycle,
      getAgentStatus: (chatJid) => chatJid === "web:hung" ? { type: "thinking", turn_id: "turn-hung" } : null,
      agentPool: {
        setSessionBinder: () => {},
        listActiveChats: () => [{ chat_jid: "web:hung", agent_name: "hung", is_active: true }],
        applyControlCommand: async (chatJid: string, command: unknown) => {
          controlCalls.push({ chatJid, command });
          return { status: "success", message: "aborted" };
        },
      },
    });

    const listResponse = await service.handleAgentRuns(new Request("https://example.com/agent/runs?chat_jid=web%3Ahung"));
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toEqual(expect.objectContaining({
      runs: [expect.objectContaining({
        chat_jid: "web:hung",
        is_active: true,
        queue_count: 2,
        inflight: expect.objectContaining({ messageId: "msg-hung" }),
        status: expect.objectContaining({ turn_id: "turn-hung" }),
      })],
    }));

    const abortResponse = await service.handleAgentRunAbort(new Request("https://example.com/agent/runs/abort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_jid: "web:hung", turn_id: "turn-hung" }),
    }));
    expect(abortResponse.status).toBe(200);
    expect(await abortResponse.json()).toEqual(expect.objectContaining({ status: "ok", chat_jid: "web:hung", turn_id: "turn-hung" }));
    expect(controlCalls).toEqual([{ chatJid: "web:hung", command: { type: "abort", raw: "/abort" } }]);

    const drainResponse = await service.handleAgentRunDrainQueue(new Request("https://example.com/agent/runs/drain-queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_jid: "web:hung" }),
    }));
    expect(drainResponse.status).toBe(200);
    expect(await drainResponse.json()).toEqual({ status: "ok", chat_jid: "web:hung", removed_count: 2 });
    expect(removedRows).toEqual([41, 42]);

    const clearResponse = await service.handleAgentRunClearStale(new Request("https://example.com/agent/runs/clear-stale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_jid: "web:hung" }),
    }));
    expect(clearResponse.status).toBe(200);
    expect(await clearResponse.json()).toEqual({
      status: "ok",
      chat_jid: "web:hung",
      cleared: true,
      had_inflight: true,
      had_preflight: false,
      had_status: true,
    });
    expect(getInflightRuns().some((run) => run.chatJid === "web:hung")).toBe(false);
    expect(events).toEqual(expect.arrayContaining([
      { type: "agent_followup_drained", data: { chat_jid: "web:hung", removed_count: 2 } },
    ]));
  });

  test("run abort dispatches the parsed control command to the captured chat", async () => {
    const aborted: string[] = [];
    const controller = new AbortController();
    controller.signal.addEventListener("abort", () => aborted.push("web:target"), { once: true });
    const service = createService({
      getAgentStatus: () => ({ turnId: "current-turn" }),
      agentPool: {
        setSessionBinder: () => {},
        applySlashCommand: async () => { throw new Error("legacy slash path must not run"); },
        applyControlCommand: async (chatJid, command) => {
          expect(chatJid).toBe("web:target");
          expect(command).toEqual({ type: "abort", raw: "/abort" });
          controller.abort();
          return { status: "success", message: "Aborted current response.", sessionGeneration: "owned-session" };
        },
      },
    });
    const response = await service.handleAgentRunAbort(abortRequest({ chat_jid: " web:target ", turn_id: " current-turn " }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", chat_jid: "web:target", turn_id: "current-turn", result: {
      status: "success", message: "Aborted current response.", sessionGeneration: "owned-session",
    } });
    expect(aborted).toEqual(["web:target"]);
  });

  test("stale run abort and invalid payloads never invoke a control command", async () => {
    let calls = 0;
    const service = createService({
      getAgentStatus: () => ({ turn_id: "new-turn" }),
      agentPool: { setSessionBinder: () => {}, applyControlCommand: async () => {
        calls++; return { status: "success", message: "aborted" };
      } },
    });
    const stale = await service.handleAgentRunAbort(abortRequest({ chat_jid: "web:target", turn_id: "old-turn" }));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: "turn_id does not match the active run", active_turn_id: "new-turn" });
    expect((await service.handleAgentRunAbort(abortRequest({}))).status).toBe(400);
    expect((await service.handleAgentRunAbort(new Request("https://example.com/agent/runs/abort", { method: "POST", body: "{" }))).status).toBe(400);
    expect(calls).toBe(0);
  });

  test("run abort returns unavailable without falling back to slash dispatch", async () => {
    let calls = 0;
    const service = createService({ agentPool: { setSessionBinder: () => {}, applySlashCommand: async () => {
      calls++; return { status: "success", message: "not a control path" };
    } } });
    const response = await service.handleAgentRunAbort(abortRequest({ chat_jid: "web:target" }));
    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ error: "Run abort is not available." });
    expect(calls).toBe(0);
  });

  test("run abort reports command failure without an outer success", async () => {
    const failure = { status: "error" as const, message: "Cancellation failed", sessionGeneration: "owned-session" };
    const service = createService({ getAgentStatus: () => ({ turn_id: "target-turn" }), agentPool: {
      setSessionBinder: () => {}, applyControlCommand: async () => failure,
    } });
    const response = await service.handleAgentRunAbort(abortRequest({ chat_jid: "web:target", turn_id: "target-turn" }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ status: "error", error: "Cancellation failed", chat_jid: "web:target", turn_id: "target-turn", result: failure });
  });

  test("run abort reports a rejected control dispatch as a bounded failure", async () => {
    const service = createService({ agentPool: { setSessionBinder: () => {}, applyControlCommand: async () => {
      throw new Error("internal failure detail");
    } } });
    const response = await service.handleAgentRunAbort(abortRequest({ chat_jid: "web:target" }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ status: "error", error: "Run abort failed.", chat_jid: "web:target", turn_id: null });
  });

  test("preserves branch lifecycle wrapper status codes and payload shapes", async () => {
    const service = createService({
      agentPool: {
        setSessionBinder: () => {},
        createForkedChatBranch: async (chatJid: string, options?: { agentName?: string | null }) => ({
          chat_jid: `${chatJid}:branch:1`,
          agent_name: options?.agentName ?? "child",
        }),
        renameChatBranch: async (chatJid: string, options?: { agentName?: string | null }) => ({
          chat_jid: chatJid,
          agent_name: options?.agentName ?? null,
        }),
        pruneChatBranch: async (chatJid: string) => ({ chat_jid: chatJid, archived_at: "2024-01-01T00:00:00.000Z" }),
        permanentPurgeChatBranch: async (chatJid: string) => ({
          branch: { chat_jid: chatJid, agent_name: "archived", archived_at: "2024-01-01T00:00:00.000Z" },
          removedSessionArtifacts: ["/tmp/session"],
        }),
        restoreChatBranch: async (chatJid: string, options?: { agentName?: string | null }) => ({
          chat_jid: chatJid,
          agent_name: options?.agentName ?? "restored",
          archived_at: null,
        }),
      },
    });

    const forkResponse = await service.handleAgentBranchFork(new Request("https://example.com/agent/branch-fork", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_chat_jid: "web:root", agent_name: "research" }),
    }));
    expect(forkResponse.status).toBe(201);
    expect(await forkResponse.json()).toEqual({
      status: "ok",
      branch: { chat_jid: "web:root:branch:1", agent_name: "research" },
    });

    const renameResponse = await service.handleAgentBranchRename(new Request("https://example.com/agent/branch-rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_jid: "web:root:branch:1", agent_name: "lead" }),
    }));
    expect(renameResponse.status).toBe(200);
    expect(await renameResponse.json()).toEqual({
      status: "ok",
      branch: { chat_jid: "web:root:branch:1", agent_name: "lead" },
    });

    const pruneResponse = await service.handleAgentBranchPrune(new Request("https://example.com/agent/branch-prune", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_jid: "web:root:branch:1" }),
    }));
    expect(pruneResponse.status).toBe(200);
    expect(await pruneResponse.json()).toEqual({
      status: "ok",
      branch: { chat_jid: "web:root:branch:1", archived_at: "2024-01-01T00:00:00.000Z" },
    });

    const purgeResponse = await service.handleAgentBranchPurge(new Request("https://example.com/agent/branch-purge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_jid: "web:root:branch:1" }),
    }));
    expect(purgeResponse.status).toBe(200);
    expect(await purgeResponse.json()).toEqual({
      status: "ok",
      branch: { chat_jid: "web:root:branch:1", agent_name: "archived", archived_at: "2024-01-01T00:00:00.000Z" },
      removedSessionArtifacts: ["/tmp/session"],
    });

    const restoreResponse = await service.handleAgentBranchRestore(new Request("https://example.com/agent/branch-restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_jid: "web:root:branch:1", agent_name: "restored" }),
    }));
    expect(restoreResponse.status).toBe(200);
    expect(await restoreResponse.json()).toEqual({
      status: "ok",
      branch: { chat_jid: "web:root:branch:1", agent_name: "restored", archived_at: null },
    });
  });

  test("downloads archived branch data as attachment JSON", async () => {
    initDatabase();
    const db = getDb();
    db.prepare(`INSERT OR REPLACE INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)`).run(
      "web:archived-download-service",
      "Archived Download Service",
      "2026-06-12T00:00:00.000Z",
    );
    db.prepare(`INSERT OR REPLACE INTO chat_branches (branch_id, chat_jid, root_chat_jid, parent_branch_id, agent_name, created_at, updated_at, archived_at)
      VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`).run(
      "branch-archived-download-service",
      "web:archived-download-service",
      "web:archived-download-service",
      "download-service",
      "2026-06-11T00:00:00.000Z",
      "2026-06-12T00:00:00.000Z",
      "2026-06-12T01:00:00.000Z",
    );
    db.prepare(`INSERT INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      "msg-archived-download-service",
      "web:archived-download-service",
      "web-user",
      "You",
      "download me",
      "2026-06-12T00:00:01.000Z",
      0,
      0,
    );

    const service = createService();
    const response = service.handleAgentBranchDownload(new Request("https://example.com/agent/branch-download?chat_jid=web%3Aarchived-download-service"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toContain("attachment;");
    const payload = await response.json();
    expect(payload.schema).toBe("piclaw.archived-session.v1");
    expect(payload.branch.chat_jid).toBe("web:archived-download-service");
    expect(payload.messages[0].content).toBe("download me");
  });
});
