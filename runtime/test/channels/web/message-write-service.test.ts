import { describe, expect, test } from "bun:test";
import {
  WebMessageWriteService,
  createMessageWriteContext,
  type WebMessageWriteServiceDeps,
} from "../../../src/channels/web/message-write-service.js";

function createDeps(overrides: Partial<WebMessageWriteServiceDeps> = {}): WebMessageWriteServiceDeps {
  return {
    defaultAgentId: "default",
    storeMessage: () => null,
    replaceMessageContent: () => null,
    setMessageThreadToSelf: () => {},
    broadcastAgentResponse: () => {},
    broadcastInteractionUpdated: () => {},
    enqueueFollowupPlaceholder: () => {},
    ...overrides,
  };
}

describe("web message write service", () => {
  test("createMessageWriteContext wires store, broadcaster, and follow-up callbacks", () => {
    const calls: string[] = [];
    const deps = createDeps({
      storeMessage: () => {
        calls.push("store");
        return { id: 1, timestamp: "t", data: {} };
      },
      replaceMessageContent: () => {
        calls.push("replace");
        return { id: 2, timestamp: "t", data: {} };
      },
      setMessageThreadToSelf: (messageId) => calls.push(`thread:${messageId}`),
      broadcastAgentResponse: (interaction) => calls.push(`agent:${interaction.id}`),
      broadcastInteractionUpdated: (interaction) => calls.push(`updated:${interaction.id}`),
      enqueueFollowupPlaceholder: (chatJid, rowId, queuedContent, threadId, queuedAt) =>
        calls.push(`followup:${chatJid}:${rowId}:${queuedContent}:${threadId ?? "null"}:${queuedAt ?? "null"}`),
    });

    const context = createMessageWriteContext(deps);

    context.store.storeMessage("web:default", "hello", true, [], undefined);
    context.store.replaceMessageContent("web:default", 2, "updated", [], undefined, true);
    context.store.setMessageThreadToSelf(9);
    context.broadcaster.broadcastAgentResponse({ id: 3, timestamp: "t", data: {} });
    context.broadcaster.broadcastInteractionUpdated({ id: 4, timestamp: "t", data: {} });
    context.followups.enqueue("web:default", 5, "queued", 6, "2026-01-01T00:00:00.000Z");

    expect(calls).toEqual([
      "store",
      "replace",
      "thread:9",
      "agent:3",
      "updated:4",
      "followup:web:default:5:queued:6:2026-01-01T00:00:00.000Z",
    ]);
  });

  test("queueFollowupPlaceholder preserves queued content and suppresses agent-response broadcasts", () => {
    const calls: string[] = [];
    const service = new WebMessageWriteService(createDeps({
      storeMessage: (_chatJid, content, _isBot, _mediaIds, options) => {
        calls.push(`store:${content}:thread=${options?.threadId ?? "undefined"}`);
        return {
          id: 7,
          timestamp: "2026-01-01T00:00:00.000Z",
          data: { type: "agent_response", content },
        };
      },
      broadcastAgentResponse: (interaction) => calls.push(`agent:${interaction.id}`),
      enqueueFollowupPlaceholder: (chatJid, rowId, queuedContent, threadId, queuedAt) => {
        calls.push(`followup:${chatJid}:${rowId}:${queuedContent}:${threadId ?? "null"}:${queuedAt}`);
      },
    }));

    const interaction = service.queueFollowupPlaceholder("web:default", "queued", 99, " queued later ");

    expect(interaction?.id).toBe(7);
    expect(calls).toEqual([
      "store:queued:thread=99",
      "followup:web:default:7:queued later:99:2026-01-01T00:00:00.000Z",
    ]);
  });

  test("replaceQueuedFollowupPlaceholder updates metadata and broadcasts interaction updates", () => {
    const calls: string[] = [];
    const service = new WebMessageWriteService(createDeps({
      replaceMessageContent: (_chatJid, rowId, text, mediaIds, _contentBlocks, isTerminalAgentReply) => {
        calls.push(`replace:${rowId}:${text}:${mediaIds.join(",")}:terminal=${isTerminalAgentReply ? 1 : 0}`);
        return {
          id: rowId,
          timestamp: "2026-01-01T00:00:00.000Z",
          data: { type: "agent_response", content: text },
        };
      },
      broadcastInteractionUpdated: (interaction) => calls.push(`updated:${interaction.id}`),
    }));

    const interaction = service.replaceQueuedFollowupPlaceholder(
      "web:default",
      55,
      "updated",
      [8, 9],
      [{ type: "text" }],
      123,
      true,
    );

    expect(interaction?.data.agent_id).toBe("default");
    expect(interaction?.data.thread_id).toBe(123);
    expect(calls).toEqual([
      "replace:55:updated:8,9:terminal=1",
      "updated:55",
    ]);
  });

  test("postDashboardWidget delegates through the sendMessage write path", async () => {
    const writes: Array<{ chatJid: string; text: string; blocks: unknown[] | undefined }> = [];
    const service = new WebMessageWriteService(createDeps({
      storeMessage: (chatJid, text, _isBot, _mediaIds, options) => {
        writes.push({
          chatJid,
          text,
          blocks: options?.contentBlocks,
        });
        return {
          id: 101,
          timestamp: "2026-01-01T00:00:00.000Z",
          data: { type: "agent_response", content: text },
        };
      },
    }));

    await service.postDashboardWidget("web:test", {
      threadId: 42,
      text: "Dashboard is ready.",
      widgetId: "widget-test-service",
    });

    expect(writes).toHaveLength(1);
    expect(writes[0].chatJid).toBe("web:test");
    expect(writes[0].text).toBe("Dashboard is ready.");
    expect(Array.isArray(writes[0].blocks)).toBe(true);
    expect((writes[0].blocks?.[0] as Record<string, unknown>).widget_id).toBe("widget-test-service");
  });
});

test('WebMessageWriteService rejects an uncommitted reply instead of reporting success',async()=>{
 let broadcasts=0;const service=new WebMessageWriteService(createDeps({broadcastAgentResponse:()=>{broadcasts++;}}));await expect(service.sendMessage('web:default','test',{forceRoot:true,requirePersistence:true})).rejects.toThrow('could not be persisted');expect(broadcasts).toBe(0);
});

test('non-strict reply failure preserves legacy control-command completion semantics',async()=>{
 const service=new WebMessageWriteService(createDeps());await expect(service.sendMessage('web:default','already executed control reply')).resolves.toBeUndefined();
});
