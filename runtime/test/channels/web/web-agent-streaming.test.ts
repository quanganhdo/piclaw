/**
 * test/channels/web/web-agent-streaming.test.ts – Tests for agent event streaming over SSE.
 *
 * Verifies that agent session events (drafts, thoughts, completions) are
 * correctly translated into SSE payloads and broadcast to connected clients.
 */

import { describe, test, expect } from "bun:test";
import { AgentQueue } from "../../../src/queue.js";
import { buildAgentStatusPhaseKey } from "../../../src/channels/web/handlers/agent.js";
import { waitFor } from "../../helpers.js";
import { createWebChannelTestFixture } from "./helpers/web-channel-fixture.js";

function makeEvent(type: string, payload: Record<string, unknown> = {}) {
  return { type, ...payload } as any;
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("agent status phase identity ignores presentation text", () => {
  expect(buildAgentStatusPhaseKey({
    type: "intent",
    intent_key: "recovery",
    classifier: "timeout",
    title: "First recovery title",
  })).toBe(buildAgentStatusPhaseKey({
    type: "intent",
    intent_key: "recovery",
    classifier: "network",
    title: "Completely different presentation",
  }));

  expect(buildAgentStatusPhaseKey({
    type: "tool_status",
    tool_call_id: "tool-1",
    tool_name: "bash",
    title: "bash: first command",
  })).toBe(buildAgentStatusPhaseKey({
    type: "tool_status",
    tool_call_id: "tool-1",
    tool_name: "bash",
    title: "renamed tool presentation",
  }));
});

describe("web agent streaming", () => {
  test("processChat broadcasts streaming events and stores turns", async () => {
    const agentPool = {
      setSessionBinder: () => {},
      runAgent: async (_prompt: string, _chatJid: string, options: any) => {
        options.onEvent?.(makeEvent("message_update", {
          assistantMessageEvent: { type: "thinking_start" },
        }));
        options.onEvent?.(makeEvent("message_update", {
          assistantMessageEvent: { type: "thinking_delta", delta: "Thinking..." },
        }));
        options.onEvent?.(makeEvent("message_update", {
          assistantMessageEvent: { type: "thinking_end", content: "Thinking..." },
        }));
        options.onEvent?.(makeEvent("thinking_level_changed", {
          level: "high",
        }));
        options.onEvent?.(makeEvent("thinking_level_select", {
          level: "medium",
          previousLevel: "high",
        }));
        options.onEvent?.(makeEvent("model_select", {
          model: { provider: "openai", id: "gpt-5" },
          previousModel: { provider: "anthropic", id: "claude-sonnet-4-5" },
          source: "set",
        }));
        options.onEvent?.(makeEvent("message_update", {
          assistantMessageEvent: {
            type: "toolcall_end",
            toolCall: { id: "tool-1", name: "bash", arguments: { command: "echo hi" } },
          },
        }));
        options.onEvent?.(makeEvent("tool_execution_start", {
          toolCallId: "tool-1",
          toolName: "bash",
          args: { command: "echo hi" },
        }));
        options.onEvent?.(makeEvent("tool_execution_update", {
          toolCallId: "tool-1",
          toolName: "bash",
          args: { command: "echo hi" },
          partialResult: {
            content: [{
              type: "text",
              text: Array.from({ length: 105 }, (_, index) => `line ${index + 1}`).join("\n"),
            }],
          },
        }));
        options.onEvent?.(makeEvent("tool_execution_end", {
          toolCallId: "tool-1",
          toolName: "bash",
          isError: false,
        }));
        options.onEvent?.(makeEvent("message_update", {
          assistantMessageEvent: { type: "text_start" },
        }));
        options.onEvent?.(makeEvent("message_update", {
          assistantMessageEvent: { type: "text_delta", delta: "Partial" },
        }));
        options.onTurnComplete?.({
          text: "intermediate",
          attachments: [],
          turnKind: "intermediate",
          cause: "completed_boundary",
        });
        options.onEvent?.(makeEvent("message_update", {
          assistantMessageEvent: { type: "text_delta", delta: " final" },
        }));

        return { status: "success", result: "final response", attachments: [] };
      },
      getContextUsageForChat: async () => null,
    } as any;

    const fixture = await createWebChannelTestFixture({
      queue: new AgentQueue(),
      agentPool,
    });

    try {
      const { channel, events } = fixture;
      const interaction = channel.storeMessage("web:default", "hello", false, []);
      expect(interaction).not.toBeNull();

      await channel.processChat("web:default", "default");

      const eventTypes = events.map((event) => event.type);
      expect(eventTypes).toContain("agent_status");
      expect(eventTypes).toContain("agent_thought");
      expect(eventTypes).toContain("agent_draft");
      expect(eventTypes).toContain("agent_draft_delta");
      expect(eventTypes).toContain("agent_thought_delta");
      expect(eventTypes).toContain("agent_response");
      expect(eventTypes).toContain("model_changed");

      const thinkingEvents = events.filter((event) => event.type === "model_changed" && event.data?.thinking_level);
      const thinkingLevels = thinkingEvents.map((event) => event.data?.thinking_level);
      expect(thinkingLevels).toContain("high");
      expect(thinkingLevels).toContain("medium");
      expect(thinkingEvents.some((event) =>
        event.data?.thinking_level === "medium" && event.data?.previous_thinking_level === "high"
      )).toBe(true);

      const modelEvent = events.find((event) => event.type === "model_changed" && event.data?.model === "openai/gpt-5");
      expect(modelEvent?.data?.previous_model).toBe("anthropic/claude-sonnet-4-5");
      expect(modelEvent?.data?.source).toBe("set");

      const toolStatus = events.find(
        (event) => event.type === "agent_status" && event.data?.type === "tool_status"
      );
      expect(toolStatus).toBeDefined();
      expect(toolStatus?.data?.tool_name).toBe("bash");
      expect(toolStatus?.data?.tool_args).toEqual({ command: "echo hi" });
      expect(toolStatus?.data?.title).toBe("bash: echo hi");
      expect(typeof toolStatus?.data?.started_at).toBe("string");
      expect(typeof toolStatus?.data?.last_event_at).toBe("string");
      expect(toolStatus?.data?.output_preview).toBe(Array.from({ length: 100 }, (_, index) => `line ${index + 6}`).join("\n"));
      expect(toolStatus?.data?.output_total_lines).toBe(105);
      expect(toolStatus?.data?.output_preview_lines).toBe(100);
      expect(toolStatus?.data?.output_truncated).toBe(true);

      const responses = events.filter((event) => event.type === "agent_response");
      expect(responses.length).toBeGreaterThanOrEqual(2);
      expect(responses.find((event) => event.data?.data?.content === "intermediate")?.data?.data?.content_blocks).toContainEqual(expect.objectContaining({
        type: "agent_turn_marker",
        kind: "intermediate",
        cause: "completed_boundary",
      }));
      for (const response of responses) {
        expect(typeof response.data?.id).toBe("number");
        expect(typeof response.data?.timestamp).toBe("string");
        expect(response.data?.data?.type).toBe("agent_response");
        expect(typeof response.data?.data?.content).toBe("string");
        expect(response.data?.delta).toBeUndefined();
      }

      const done = events.find(
        (event) => event.type === "agent_status" && event.data?.type === "done"
      );
      expect(done).toBeDefined();
    } finally {
      fixture.cleanup();
    }
  });

  test("persists interrupted draft classification metadata without labeling the terminal reply", async () => {
    const agentPool = {
      setSessionBinder: () => {},
      runAgent: async (_prompt: string, _chatJid: string, options: any) => {
        options.onTurnComplete?.({
          text: "Visible progress before steering.",
          attachments: [],
          turnKind: "draft_snapshot",
          cause: "interrupted_text_start",
        });
        return { status: "success", result: "Final after steering.", attachments: [] };
      },
      getContextUsageForChat: async () => null,
    } as any;
    const fixture = await createWebChannelTestFixture({
      workspace: "temp",
      queue: new AgentQueue(),
      agentPool,
      resetSql: "DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;",
    });

    try {
      const { channel, db } = fixture;
      expect(channel.storeMessage("web:default", "continue", false, [])).not.toBeNull();
      await channel.processChat("web:default", "default");

      expect(db.getDb().prepare(`
        SELECT json_extract(block.value, '$.kind') AS kind,
               json_extract(block.value, '$.cause') AS cause
        FROM messages AS message, json_each(message.content_blocks) AS block
        WHERE message.chat_jid = ? AND message.content = ?
          AND json_extract(block.value, '$.type') = 'agent_turn_marker'
      `).get("web:default", "Visible progress before steering.")).toEqual({
        kind: "draft_snapshot",
        cause: "interrupted_text_start",
      });
      expect(db.getDb().prepare(`
        SELECT is_terminal_agent_reply,
               EXISTS (
                 SELECT 1 FROM json_each(messages.content_blocks) AS block
                 WHERE json_extract(block.value, '$.type') = 'agent_turn_marker'
               ) AS has_turn_marker
        FROM messages WHERE chat_jid = ? AND content = ?
      `).get("web:default", "Final after steering.")).toEqual({
        is_terminal_agent_reply: 1,
        has_turn_marker: 0,
      });
    } finally {
      fixture.cleanup();
    }
  });

  test("persists a completed tool-use lead-in before tool execution starts", async () => {
    let inspectTimeline = (): any[] => [];
    let timelineAtToolStart: any[] = [];
    const agentPool = {
      setSessionBinder: () => {},
      runAgent: async (_prompt: string, _chatJid: string, options: any) => {
        const leadIn = "I will inspect the workspace now.";
        options.onEvent?.(makeEvent("message_update", {
          assistantMessageEvent: { type: "text_start" },
        }));
        options.onEvent?.(makeEvent("message_update", {
          assistantMessageEvent: { type: "text_delta", delta: leadIn },
        }));
        options.onEvent?.(makeEvent("message_end", {
          message: {
            role: "assistant",
            stopReason: "toolUse",
            content: [
              { type: "text", text: leadIn },
              { type: "toolCall", id: "tool-1", name: "read", arguments: { path: "README.md" } },
            ],
          },
        }));
        options.onTurnComplete?.({
          text: leadIn,
          attachments: [],
          turnKind: "intermediate",
          cause: "tool_use",
          followedByToolUse: true,
        });

        timelineAtToolStart = inspectTimeline();
        options.onEvent?.(makeEvent("tool_execution_start", {
          toolCallId: "tool-1",
          toolName: "read",
          args: { path: "README.md" },
        }));
        options.onEvent?.(makeEvent("tool_execution_end", {
          toolCallId: "tool-1",
          toolName: "read",
          isError: false,
        }));
        return { status: "success", result: "Inspection complete.", attachments: [] };
      },
      getContextUsageForChat: async () => null,
    } as any;

    const fixture = await createWebChannelTestFixture({
      workspace: "temp",
      queue: new AgentQueue(),
      agentPool,
      resetSql: "DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;",
    });

    try {
      const { channel, db, events } = fixture;
      inspectTimeline = () => db.getTimeline("web:default", 20);
      expect(channel.storeMessage("web:default", "inspect it", false, [])).not.toBeNull();

      await channel.processChat("web:default", "default");

      expect(timelineAtToolStart.some((row) => row.data?.content === "I will inspect the workspace now.")).toBe(true);
      const finalTimeline = inspectTimeline();
      expect(finalTimeline.filter((row) => row.data?.content === "I will inspect the workspace now.")).toHaveLength(1);
      expect(finalTimeline.filter((row) => row.data?.content === "Inspection complete.")).toHaveLength(1);
      expect(db.getDb().prepare(`
        SELECT json_extract(block.value, '$.kind') AS kind,
               json_extract(block.value, '$.cause') AS cause,
               json_extract(block.value, '$.followed_by_tool_use') AS followed_by_tool_use
        FROM messages AS message, json_each(message.content_blocks) AS block
        WHERE message.chat_jid = ? AND message.content = ?
          AND json_extract(block.value, '$.type') = 'agent_turn_marker'
      `).get("web:default", "I will inspect the workspace now.")).toEqual({
        kind: "intermediate",
        cause: "tool_use",
        followed_by_tool_use: 1,
      });
      expect(db.getDb().prepare(`
        SELECT is_terminal_agent_reply,
               EXISTS (
                 SELECT 1 FROM json_each(messages.content_blocks) AS block
                 WHERE json_extract(block.value, '$.type') = 'agent_turn_marker'
                   AND json_extract(block.value, '$.kind') = 'draft_snapshot'
               ) AS has_draft_marker
        FROM messages WHERE chat_jid = ? AND content = ?
      `).get("web:default", "Inspection complete.")).toEqual({
        is_terminal_agent_reply: 1,
        has_draft_marker: 0,
      });

      const clearDraftIndices = events.flatMap((event, index) => event.type === "agent_draft" && event.data?.text === "" ? [index] : []);
      const committedResponseIndex = events.findIndex((event) => event.type === "agent_response" && event.data?.data?.content === "I will inspect the workspace now.");
      const toolStartIndex = events.findIndex((event) => event.type === "agent_status" && event.data?.type === "tool_call" && event.data?.tool_name === "read");
      expect(clearDraftIndices).toHaveLength(1);
      expect(committedResponseIndex).toBeLessThan(toolStartIndex);
      expect(clearDraftIndices[0]).toBeLessThan(toolStartIndex);
      expect(toolStartIndex).toBeGreaterThan(committedResponseIndex);
    } finally {
      fixture.cleanup();
    }
  });

  test("keeps the draft available when the pre-tool intermediate post cannot be persisted", async () => {
    const leadIn = "I will inspect the workspace now.";
    const agentPool = {
      setSessionBinder: () => {},
      runAgent: async (_prompt: string, _chatJid: string, options: any) => {
        options.onEvent?.(makeEvent("message_update", {
          assistantMessageEvent: { type: "text_start" },
        }));
        options.onEvent?.(makeEvent("message_update", {
          assistantMessageEvent: { type: "text_delta", delta: leadIn },
        }));
        options.onTurnComplete?.({ text: leadIn, attachments: [], followedByToolUse: true });
        return { status: "tool_complete", result: null, attachments: [] };
      },
      getContextUsageForChat: async () => null,
    } as any;

    const fixture = await createWebChannelTestFixture({
      workspace: "temp",
      queue: new AgentQueue(),
      agentPool,
      resetSql: "DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;",
    });

    try {
      const { channel, db, events } = fixture;
      expect(channel.storeMessage("web:default", "inspect it", false, [])).not.toBeNull();
      const originalStoreMessage = channel.storeMessage.bind(channel);
      let rejectNextAgentPost = true;
      channel.storeMessage = ((...args: any[]) => {
        if (args[2] === true && rejectNextAgentPost) {
          rejectNextAgentPost = false;
          return null;
        }
        return originalStoreMessage(...args);
      }) as typeof channel.storeMessage;

      await channel.processChat("web:default", "default");

      const timeline = db.getTimeline("web:default", 20);
      expect(timeline.filter((row) => row.data?.content === leadIn)).toHaveLength(1);
      expect(timeline.find((row) => row.data?.content === leadIn)?.data?.content_blocks).toContainEqual(expect.objectContaining({
        type: "turn_outcome_marker",
        kind: "tool_complete",
        draft_recovered: true,
      }));
      expect(events.filter((event) => event.type === "agent_draft" && event.data?.text === "")).toHaveLength(0);
    } finally {
      fixture.cleanup();
    }
  });

  test("discards tool-use commentary without persisting or recovering it", async () => {
    const commentary = "Need inspect logs then retry.";
    const agentPool = {
      setSessionBinder: () => {},
      runAgent: async (_prompt: string, _chatJid: string, options: any) => {
        options.onEvent?.(makeEvent("message_update", {
          assistantMessageEvent: { type: "text_start" },
        }));
        options.onEvent?.(makeEvent("message_update", {
          assistantMessageEvent: { type: "text_delta", delta: commentary },
        }));
        options.onTurnDiscard?.({ reason: "tool_use_commentary" });
        options.onEvent?.(makeEvent("tool_execution_start", {
          toolCallId: "tool-1",
          toolName: "read",
          args: { path: "README.md" },
        }));
        options.onEvent?.(makeEvent("tool_execution_end", {
          toolCallId: "tool-1",
          toolName: "read",
          isError: false,
        }));
        return { status: "tool_complete", result: null, attachments: [] };
      },
      getContextUsageForChat: async () => null,
    } as any;

    const fixture = await createWebChannelTestFixture({
      workspace: "temp",
      queue: new AgentQueue(),
      agentPool,
      resetSql: "DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;",
    });

    try {
      const { channel, db, events } = fixture;
      expect(channel.storeMessage("web:default", "inspect it", false, [])).not.toBeNull();

      await channel.processChat("web:default", "default");

      const timeline = db.getTimeline("web:default", 20);
      expect(timeline.some((row) => String(row.data?.content || "").includes(commentary))).toBe(false);
      const outcomeBlocks = timeline.flatMap((row) => row.data?.content_blocks || []);
      expect(outcomeBlocks).toContainEqual(expect.objectContaining({
        type: "turn_outcome_marker",
        kind: "tool_complete",
        draft_recovered: false,
      }));
      expect(events.some((event) => event.type === "agent_draft" && event.data?.text === "")).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });

  test("does not recover discarded commentary into a provider-error reply", async () => {
    const commentary = "Searching saved output for a matching record.";
    const agentPool = {
      setSessionBinder: () => {},
      runAgent: async (_prompt: string, _chatJid: string, options: any) => {
        options.onEvent?.(makeEvent("message_update", {
          assistantMessageEvent: { type: "text_start" },
        }));
        options.onEvent?.(makeEvent("message_update", {
          assistantMessageEvent: { type: "text_delta", delta: commentary },
        }));
        options.onTurnDiscard?.({ reason: "commentary_only" });
        return {
          status: "error",
          result: null,
          error: "Temporary provider error; try again.",
          failureCategory: "provider",
        };
      },
      getContextUsageForChat: async () => null,
    } as any;

    const fixture = await createWebChannelTestFixture({
      workspace: "temp",
      queue: new AgentQueue(),
      agentPool,
      resetSql: "DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;",
    });

    try {
      const { channel, db, events } = fixture;
      expect(channel.storeMessage("web:default", "inspect it", false, [])).not.toBeNull();

      await channel.processChat("web:default", "default");

      const timeline = db.getTimeline("web:default", 20);
      expect(timeline.some((row) => String(row.data?.content || "").includes(commentary))).toBe(false);
      const outcomeBlocks = timeline.flatMap((row) => row.data?.content_blocks || []);
      expect(outcomeBlocks).toContainEqual(expect.objectContaining({
        type: "turn_outcome_marker",
        kind: "provider",
        failure_category: "provider",
        draft_recovered: false,
      }));
      expect(events.some((event) => event.type === "agent_draft" && event.data?.text === "")).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });

  test("streams live generated widget events for show_widget tool calls", async () => {
    const agentPool = {
      setSessionBinder: () => {},
      runAgent: async (_prompt: string, _chatJid: string, options: any) => {
        options.onEvent?.(makeEvent("message_update", {
          assistantMessageEvent: {
            type: "toolcall_start",
            contentIndex: 0,
            partial: {
              content: [{
                type: "toolCall",
                id: "widget-tool-1",
                name: "show_widget",
                arguments: {
                  title: "Live widget",
                  w: "<div>hel",
                },
              }],
            },
          },
        }));
        options.onEvent?.(makeEvent("message_update", {
          assistantMessageEvent: {
            type: "toolcall_delta",
            contentIndex: 0,
            delta: "lo",
            partial: {
              content: [{
                type: "toolCall",
                id: "widget-tool-1",
                name: "show_widget",
                arguments: {
                  title: "Live widget",
                  w: "<div>hello</div>",
                  width: 800,
                  height: 600,
                },
              }],
            },
          },
        }));
        options.onEvent?.(makeEvent("message_update", {
          assistantMessageEvent: {
            type: "toolcall_end",
            contentIndex: 0,
            toolCall: {
              id: "widget-tool-1",
              name: "show_widget",
              arguments: {
                title: "Live widget",
                w: "<div>hello</div>",
                width: 800,
                height: 600,
              },
            },
          },
        }));
        return { status: "success", result: "widget response", attachments: [] };
      },
      getContextUsageForChat: async () => null,
    } as any;

    const fixture = await createWebChannelTestFixture({
      queue: new AgentQueue(),
      agentPool,
    });

    try {
      const { channel, events } = fixture;
      const interaction = channel.storeMessage("web:default", "show me a widget", false, []);
      expect(interaction).not.toBeNull();

      await channel.processChat("web:default", "default");

      const openEvent = events.find((event) => event.type === "generated_widget_open");
      expect(openEvent).toBeDefined();
      expect(openEvent?.data?.chat_jid).toBe("web:default");
      expect(openEvent?.data?.tool_call_id).toBe("widget-tool-1");
      expect(openEvent?.data?.artifact?.html).toBe("<div>hel");

      const deltaEvent = events.find((event) => event.type === "generated_widget_delta");
      expect(deltaEvent).toBeDefined();
      expect(deltaEvent?.data?.width).toBe(800);
      expect(deltaEvent?.data?.height).toBe(600);
      expect(deltaEvent?.data?.artifact?.html).toBe("<div>hello</div>");

      const finalEvent = events.find((event) => event.type === "generated_widget_final");
      expect(finalEvent).toBeDefined();
      expect(finalEvent?.data?.status).toBe("final");
      expect(finalEvent?.data?.artifact?.html).toBe("<div>hello</div>");
    } finally {
      fixture.cleanup();
    }
  });

  test("pre-prompt compaction defers in background and resumes the chat lane", async () => {
    const previousForeground = process.env.PICLAW_PREPROMPT_COMPACTION_FOREGROUND_MS;
    process.env.PICLAW_PREPROMPT_COMPACTION_FOREGROUND_MS = "0";
    const releaseCompaction = deferred<void>();
    const chatJid = "web:preprompt-defers";
    let compactCalls = 0;
    let runCalls = 0;
    const session = {
      isStreaming: false,
      isCompacting: false,
      isRetrying: false,
      model: { provider: "test", id: "large", contextWindow: 100 },
      settingsManager: { getCompactionSettings: () => ({ enabled: true, reserveTokens: 25 }) },
      getContextUsage: () => ({ tokens: compactCalls === 0 ? 90 : 10, contextWindow: 100, percent: compactCalls === 0 ? 90 : 10 }),
      sessionManager: {
        buildSessionContext: () => ({ messages: [{ role: "user", content: [{ type: "text", text: "x".repeat(compactCalls === 0 ? 360 : 4) }] }] }),
      },
      compact: async () => {
        compactCalls += 1;
        await releaseCompaction.promise;
        return { summary: "compacted", tokensBefore: 90, firstKeptEntryId: "entry-1" };
      },
    } as any;
    const agentPool = {
      setSessionBinder: () => {},
      getSessionForIntrospection: async () => session,
      runAgent: async () => {
        runCalls += 1;
        return { status: "success", result: "after compaction", attachments: [] };
      },
      getContextUsageForChat: async () => null,
    } as any;

    const queuedResumeTasks: Array<() => Promise<void>> = [];
    const fixture = await createWebChannelTestFixture({
      workspace: "temp",
      queue: {
        enqueue: (fn: () => Promise<void>) => {
          queuedResumeTasks.push(fn);
        },
      },
      agentPool,
    });

    try {
      const { channel, db } = fixture;
      const interaction = channel.storeMessage(chatJid, "hello", false, []);
      expect(interaction).not.toBeNull();

      await channel.processChat(chatJid, "default");

      expect(compactCalls).toBe(1);
      expect(runCalls).toBe(0);

      releaseCompaction.resolve(undefined);
      await waitFor(() => queuedResumeTasks.length === 1, 2_000, 10);
      expect(runCalls).toBe(0);

      await queuedResumeTasks[0]!();

      expect(runCalls).toBe(1);
      expect(db.getChatCursor(chatJid)).toBe(interaction!.timestamp);
    } finally {
      if (previousForeground === undefined) delete process.env.PICLAW_PREPROMPT_COMPACTION_FOREGROUND_MS;
      else process.env.PICLAW_PREPROMPT_COMPACTION_FOREGROUND_MS = previousForeground;
      releaseCompaction.resolve(undefined);
      fixture.cleanup();
    }
  });

  test("auto-compaction start/end status events always carry non-empty titles", async () => {
    const agentPool = {
      setSessionBinder: () => {},
      runAgent: async (_prompt: string, _chatJid: string, options: any) => {
        options.onEvent?.(makeEvent("compaction_start", { reason: "overflow" }));
        options.onEvent?.(makeEvent("message_update", { assistantMessageEvent: { type: "text_start" } }));
        options.onEvent?.(makeEvent("message_update", { assistantMessageEvent: { type: "text_delta", delta: "compact" } }));
        options.onEvent?.(makeEvent("compaction_end", { reason: "overflow", result: undefined, aborted: false, willRetry: false, errorMessage: undefined }));
        return { status: "success", result: "compaction response", attachments: [] };
      },
      getContextUsageForChat: async () => null,
    } as any;

    const fixture = await createWebChannelTestFixture({
      queue: new AgentQueue(),
      agentPool,
    });

    try {
      const { channel, events } = fixture;
      const interaction = channel.storeMessage("web:default", "hello", false, []);
      expect(interaction).not.toBeNull();

      await channel.processChat("web:default", "default");

      const compactionStarts = events.filter(
        (event) => event.type === "agent_status" && event.data?.type === "intent" && event.data?.intent_key === "compaction"
      );
      expect(compactionStarts.length).toBeGreaterThanOrEqual(1);
      const compactionStart = compactionStarts[0];
      expect(typeof compactionStart.data?.title).toBe("string");
      expect(String(compactionStart.data.title).trim()).toBe("Compacting context");
      const done = events.find(
        (event) => event.type === "agent_status" && event.data?.type === "done"
      );
      expect(done).toBeDefined();
    } finally {
      fixture.cleanup();
    }
  });
});
