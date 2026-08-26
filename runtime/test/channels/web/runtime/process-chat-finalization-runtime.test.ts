import { describe, expect, test } from "bun:test";

import { finalizeSuccessfulProcessChatRun, persistIntermediateProcessChatTurn } from "../../../../src/channels/web/runtime/process-chat-finalization-runtime.js";
import { getChatCursor, initDatabase, setChatCursor, storeChatMetadata } from "../../../../src/db.js";
import { withTempWorkspaceEnv } from "../../../helpers.js";

function emitter(statuses: Array<Record<string, unknown>>) {
  return {
    status: (payload: Record<string, unknown>) => statuses.push(payload),
    response() {}, thought() {}, thoughtDelta() {}, draft() {}, draftDelta() {},
    generatedWidgetOpen() {}, generatedWidgetDelta() {}, generatedWidgetFinal() {}, generatedWidgetClose() {}, generatedWidgetError() {}, modelChanged() {},
  };
}

describe("process chat finalization runtime", () => {
  test("finalizes cursor/state and resumes persisted work before queued materialization", async () => {
    await withTempWorkspaceEnv("process-chat-finalize-", {}, async () => {
      initDatabase();
      const chatJid = "web:test";
      storeChatMetadata(chatJid, "2026-01-01T00:00:00.000Z", "Web");
      setChatCursor(chatJid, "2026-01-01T00:00:00.000Z");
      const statuses: Array<Record<string, unknown>> = [];
      const calls: string[] = [];
      const channel: any = {
        agentPool: { getContextUsageForChat: async () => ({ tokens: 10, contextWindow: 100, percent: 10 }) },
        consumePendingSteering: () => [], saveState: () => calls.push("save"), setContextUsage: () => calls.push("context"),
        resumeChat: () => calls.push("resume"), peekQueuedFollowupItem: () => { calls.push("peek-queue"); return null; }, consumeQueuedFollowupItem: () => { calls.push("consume-queue"); return null; },
        prependQueuedFollowupItem() {}, replaceQueuedFollowupItem: () => false, storeMessage() { return null; }, broadcastEvent() {}, sendMessage: async () => {}, updateAgentStatus() {}, retryFailedOnModelSwitch: () => false,
      };
      await finalizeSuccessfulProcessChatRun({ channel, emitter: emitter(statuses) as any, chatJid, agentId: "default", turnId: "turn-1", threadId: 1, prevCursor: getChatCursor(chatJid), recovery: null });
      expect(calls).toEqual(["save", "context", "peek-queue"]);
      expect(statuses).toEqual([expect.objectContaining({ type: "done", context_usage: { tokens: 10, contextWindow: 100, percent: 10 } })]);
    });
  });

  test("intermediate persistence stores a typed tool-use marker and preserves draft-clear ordering", () => {
    const calls: string[] = [];
    let storedOptions: any = null;
    const channel: any = {
      consumeQueuedFollowupPlaceholder: () => { calls.push("consume"); return null; },
      storeMessage: (_chat: string, _text: string, _bot: boolean, _media: number[], options: any) => {
        calls.push(`store:${options.threadId}`);
        storedOptions = options;
        return { id: 42, chat_jid: "web:test" };
      },
      broadcastEvent() {},
    };
    const result = persistIntermediateProcessChatTurn({
      channel,
      emitter: emitter([]) as any,
      chatJid: "web:test",
      text: "partial",
      attachments: [],
      channelName: "web",
      threadId: 7,
      skipPlaceholder: true,
      timingBlock: { type: "agent_timing", turn_id: "turn-1", source_message_id: "msg-1" },
      turnKind: "intermediate",
      cause: "tool_use",
      followedByToolUse: true,
      clearCommittedDraft: () => calls.push("clear-draft"),
    });
    expect(result).toBe(42);
    expect(calls).toEqual(["store:7", "clear-draft"]);
    expect(storedOptions.contentBlocks).toContainEqual({
      type: "agent_turn_marker",
      kind: "intermediate",
      cause: "tool_use",
      followed_by_tool_use: true,
      turn_id: "turn-1",
      source_message_id: "msg-1",
    });
  });

  test("contradictory completed-boundary metadata is not persisted as authoritative", () => {
    let storedOptions: any = null;
    const channel: any = {
      consumeQueuedFollowupPlaceholder: () => null,
      storeMessage: (_chat: string, _text: string, _bot: boolean, _media: number[], options: any) => {
        storedOptions = options;
        return { id: 44, chat_jid: "web:test" };
      },
      broadcastEvent() {},
    };
    expect(persistIntermediateProcessChatTurn({
      channel,
      emitter: emitter([]) as any,
      chatJid: "web:test",
      text: "contradictory",
      attachments: [],
      channelName: "web",
      threadId: 7,
      skipPlaceholder: true,
      timingBlock: { type: "agent_timing" },
      turnKind: "intermediate",
      cause: "completed_boundary",
      followedByToolUse: true,
      clearCommittedDraft: () => {},
    })).toBe(44);
    expect(storedOptions.contentBlocks).not.toContainEqual(expect.objectContaining({ type: "agent_turn_marker" }));
  });

  test("interrupted draft persistence stores a draft snapshot marker without clearing the draft", () => {
    let storedOptions: any = null;
    const channel: any = {
      consumeQueuedFollowupPlaceholder: () => null,
      storeMessage: (_chat: string, _text: string, _bot: boolean, _media: number[], options: any) => {
        storedOptions = options;
        return { id: 43, chat_jid: "web:test" };
      },
      broadcastEvent() {},
    };
    const result = persistIntermediateProcessChatTurn({
      channel,
      emitter: emitter([]) as any,
      chatJid: "web:test",
      text: "visible draft",
      attachments: [],
      channelName: "web",
      threadId: 7,
      skipPlaceholder: true,
      timingBlock: { type: "agent_timing", turn_id: "turn-2" },
      turnKind: "draft_snapshot",
      cause: "interrupted_text_start",
      clearCommittedDraft: () => { throw new Error("draft should not clear"); },
    });
    expect(result).toBe(43);
    expect(storedOptions.contentBlocks).toContainEqual({
      type: "agent_turn_marker",
      kind: "draft_snapshot",
      cause: "interrupted_text_start",
      turn_id: "turn-2",
    });
  });
});
