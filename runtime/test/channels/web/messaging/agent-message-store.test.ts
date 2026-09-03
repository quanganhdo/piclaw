import { describe, expect, test } from "bun:test";
import { storeAgentTurn } from "../../../../src/channels/web/messaging/agent-message-store.js";
import type { WebChannel } from "../../../../src/channels/web.js";
import type { AgentEventEmitter } from "../../../../src/channels/web/sse/agent-events.js";

/** Minimal mock of WebChannel that tracks placeholder and store calls. */
function createMockChannel(placeholderIds: number[] = []) {
  const calls: string[] = [];
  const broadcasts: Array<{ event: string; payload: any }> = [];
  const queue = [...placeholderIds];
  return {
    calls,
    broadcasts,
    channel: {
      consumeQueuedFollowupPlaceholder: (chatJid: string) => {
        const next = queue.shift() ?? null;
        if (next) calls.push(`consume:${chatJid}:${next}`);
        return next;
      },
      replaceQueuedFollowupPlaceholder: (
        chatJid: string,
        rowId: number,
        _text: string,
        _mediaIds: number[],
        _contentBlocks: unknown,
        threadId: number | undefined,
        isTerminalAgentReply?: boolean
      ) => {
        calls.push(
          `replace:${chatJid}:${rowId}:thread=${threadId ?? "undefined"}:terminal=${isTerminalAgentReply ? 1 : 0}`
        );
        return { id: rowId, timestamp: "t", data: {} };
      },
      storeMessage: (
        chatJid: string,
        _content: string,
        _isBot: boolean,
        _mediaIds: number[],
        opts?: { threadId?: number; isTerminalAgentReply?: boolean }
      ) => {
        calls.push(
          `store:${chatJid}:thread=${opts?.threadId ?? "undefined"}:terminal=${opts?.isTerminalAgentReply ? 1 : 0}`
        );
        return { id: 100, timestamp: "t", data: {} };
      },
      broadcastEvent: (event: string, payload: any) => broadcasts.push({ event, payload }),
    } as unknown as WebChannel,
  };
}

function createMockEmitter() {
  const calls: string[] = [];
  return {
    calls,
    emitter: {
      response: (interaction: unknown) => calls.push(`response:${(interaction as any).id}`),
    } as unknown as AgentEventEmitter,
  };
}

describe("storeAgentTurn", () => {
  test("consumes placeholder when skipPlaceholder is false (default)", () => {
    const { channel, calls } = createMockChannel([50]);
    const { emitter } = createMockEmitter();

    storeAgentTurn(channel, emitter, {
      chatJid: "web:default",
      text: "follow-up response",
      attachments: [],
      channelName: "web",
      threadId: 1,
    });

    expect(calls).toEqual([
      "consume:web:default:50",
      "replace:web:default:50:thread=undefined:terminal=0",
    ]);
  });

  test("does NOT consume placeholder when skipPlaceholder is true", () => {
    const { channel, calls } = createMockChannel([50]);
    const { emitter, calls: emitterCalls } = createMockEmitter();

    storeAgentTurn(channel, emitter, {
      chatJid: "web:default",
      text: "original turn response",
      attachments: [],
      channelName: "web",
      threadId: 1,
      skipPlaceholder: true,
    });

    // Should NOT touch the placeholder at all — stored as a new message instead
    expect(calls).toEqual(["store:web:default:thread=1:terminal=0"]);
    expect(emitterCalls).toEqual(["response:100"]);
  });

  test("placeholder thread_id is NOT overridden (preserves /queue thread)", () => {
    const { channel, calls } = createMockChannel([50]);
    const { emitter } = createMockEmitter();

    storeAgentTurn(channel, emitter, {
      chatJid: "web:default",
      text: "response",
      attachments: [],
      channelName: "web",
      threadId: 999, // processChat's resolvedThreadRootId — should NOT be used
    });

    // The replace call should pass threadId=undefined, preserving the placeholder's original thread
    expect(calls).toEqual([
      "consume:web:default:50",
      "replace:web:default:50:thread=undefined:terminal=0",
    ]);
  });

  test("stored callback receives the placeholder replacement with its preserved thread", () => {
    const { channel, broadcasts } = createMockChannel([50]);
    channel.replaceQueuedFollowupPlaceholder = (() => ({
      id: 50,
      timestamp: "t",
      data: { thread_id: 27 },
    })) as any;
    const stored: Array<{ rowId: number; threadId: number | null }> = [];

    storeAgentTurn(channel, createMockEmitter().emitter, {
      chatJid: "web:default",
      text: "response",
      attachments: [],
      channelName: "web",
      threadId: 999,
      onMessageStored: (rowId, interaction) => stored.push({
        rowId,
        threadId: interaction.data?.thread_id ?? null,
      }),
    });

    expect(stored).toEqual([{ rowId: 50, threadId: 27 }]);
    expect(broadcasts).toContainEqual({
      event: "agent_followup_consumed",
      payload: expect.objectContaining({ row_id: 50, thread_id: 27 }),
    });
  });

  test("intermediate then final turn: placeholder consumed only by final", () => {
    const { channel, calls } = createMockChannel([50]);
    const { emitter, calls: emitterCalls } = createMockEmitter();

    // Intermediate turn (original response) — skipPlaceholder: true
    storeAgentTurn(channel, emitter, {
      chatJid: "web:default",
      text: "original response",
      attachments: [],
      channelName: "web",
      threadId: 1,
      skipPlaceholder: true,
    });

    // Final turn (follow-up response) — skipPlaceholder: false (default)
    storeAgentTurn(channel, emitter, {
      chatJid: "web:default",
      text: "follow-up response",
      attachments: [],
      channelName: "web",
      threadId: 1,
    });

    expect(calls).toEqual([
      // Intermediate: stored as new message, no placeholder touched
      "store:web:default:thread=1:terminal=0",
      // Final: consumed placeholder, replaced with undefined thread (preserving original)
      "consume:web:default:50",
      "replace:web:default:50:thread=undefined:terminal=0",
    ]);
    expect(emitterCalls).toEqual(["response:100"]);
  });

  test("stores as new message when no placeholder is queued", () => {
    const { channel, calls } = createMockChannel([]);
    const { emitter, calls: emitterCalls } = createMockEmitter();

    storeAgentTurn(channel, emitter, {
      chatJid: "web:default",
      text: "normal response",
      attachments: [],
      channelName: "web",
      threadId: 5,
    });

    expect(calls).toEqual(["store:web:default:thread=5:terminal=0"]);
    expect(emitterCalls).toEqual(["response:100"]);
  });

  test("marks terminal assistant replies when requested", () => {
    const { channel, calls } = createMockChannel([]);
    const { emitter } = createMockEmitter();

    storeAgentTurn(channel, emitter, {
      chatJid: "web:default",
      text: "final response",
      attachments: [],
      channelName: "web",
      threadId: 5,
      isTerminalAgentReply: true,
    });

    expect(calls).toEqual(["store:web:default:thread=5:terminal=1"]);
  });
});
