import { afterEach, describe, expect, test } from "bun:test";
import { createTempWorkspace, setEnv } from "../../../helpers.js";

let restoreEnv: (() => void) | null = null;
let cleanupWorkspace: (() => void) | null = null;

afterEach(() => {
  restoreEnv?.();
  restoreEnv = null;
  cleanupWorkspace?.();
  cleanupWorkspace = null;
});

async function createServiceFixture() {
  const ws = createTempWorkspace("piclaw-queued-followup-service-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const mod = await import("../../../../src/channels/web/runtime/queued-followup-lifecycle-service.js");
  const service = new mod.QueuedFollowupLifecycleService();
  return { db, service };
}

describe("queued follow-up lifecycle service", () => {
  test('asynchronous admission commits one atomic queue update and rolls back revoked authority', async () => {
    const { service } = await createServiceFixture();
    const signal = new AbortController().signal;
    await Promise.all([
      service.admitQueuedFollowupItem(['web:admit',0,'first'],()=>{},signal),
      service.admitQueuedFollowupItem(['web:admit',0,'second'],()=>{},signal),
    ]);
    expect(service.getQueuedFollowupItems('web:admit').map(item=>item.queuedContent)).toEqual(['first','second']);
    let checks=0;
    await expect(service.admitQueuedFollowupItem(['web:admit',0,'revoked'],()=>{if(++checks===2)throw Error('revoked');},signal)).rejects.toThrow('revoked');
    expect(service.getQueuedFollowupItems('web:admit').map(item=>item.queuedContent)).toEqual(['first','second']);
  });
  test('asynchronous admission rejects redirected workspace before committing captured database work', async () => {
    const {service}=await createServiceFixture();
    let restore:(()=>void)|undefined;
    try {
      await expect(service.admitQueuedFollowupItem(['web:binding',0,'must not commit'],()=>{restore??=setEnv({PICLAW_WORKSPACE:process.env.PICLAW_WORKSPACE+'/changed'});},new AbortController().signal)).rejects.toThrow('binding changed');
    } finally { restore?.(); }
    expect(service.getQueuedFollowupItems('web:binding')).toEqual([]);
  });
  test("combines deferred and placeholder items into queue-state payloads without duplicate row ids", async () => {
    const { db, service } = await createServiceFixture();

    const placeholderTimestamp = "2024-01-01T00:00:03.000Z";
    const placeholderRowId = db.storeMessage({
      id: `msg-${Math.random()}`,
      chat_jid: "web:default",
      sender: "web-agent",
      sender_name: "Pi",
      content: "\u2063",
      timestamp: placeholderTimestamp,
      is_from_me: false,
      is_bot_message: true,
      thread_id: 77,
    });

    const deferredRowId = service.enqueueQueuedFollowupItem(
      "web:default",
      0,
      "deferred first",
      12,
      "2024-01-01T00:00:01.000Z"
    );
    service.enqueueQueuedFollowupItem(
      "web:default",
      placeholderRowId,
      "dedup wins from deferred",
      21,
      "2024-01-01T00:00:02.000Z"
    );
    service.enqueuePlaceholder(
      "web:default",
      placeholderRowId,
      "placeholder survives",
      77,
      placeholderTimestamp
    );

    const items = service.getQueuedFollowupItems("web:default");
    expect(items.map((item) => item.rowId)).toEqual([deferredRowId, placeholderRowId]);
    expect(items.map((item) => item.queuedContent)).toEqual([
      "deferred first",
      "dedup wins from deferred",
    ]);

    const queueState = service.listQueuedStateItems("web:default");
    expect(queueState).toEqual([
      {
        row_id: deferredRowId,
        content: "deferred first",
        timestamp: "2024-01-01T00:00:01.000Z",
        thread_id: 12,
      },
      {
        row_id: placeholderRowId,
        content: "dedup wins from deferred",
        timestamp: placeholderTimestamp,
        thread_id: 77,
      },
    ]);
  });

  test("removes placeholder-backed queued follow-ups from both queue stores and timeline", async () => {
    const { db, service } = await createServiceFixture();

    const placeholderRowId = db.storeMessage({
      id: `msg-${Math.random()}`,
      chat_jid: "web:default",
      sender: "web-agent",
      sender_name: "Pi",
      content: "\u2063",
      timestamp: "2024-01-01T00:00:00.000Z",
      is_from_me: false,
      is_bot_message: true,
      thread_id: 31,
    });
    service.enqueuePlaceholder("web:default", placeholderRowId, "queued placeholder", 31, "2024-01-01T00:00:00.000Z");

    const sessionRemovals: Array<{ chatJid: string; content: string | undefined }> = [];
    const result = await service.removeQueuedFollowupForAction("web:default", placeholderRowId, {
      removeQueuedFollowupMessage: async (chatJid, content) => {
        sessionRemovals.push({ chatJid, content });
        return true;
      },
    });

    expect(result.source).toBe("placeholder");
    expect(result.removed?.queuedContent).toBe("queued placeholder");
    expect(service.getQueuedFollowupCount("web:default")).toBe(0);
    expect(db.getMessageByRowId("web:default", placeholderRowId)).toBeUndefined();
    expect(sessionRemovals).toEqual([{ chatJid: "web:default", content: "queued placeholder" }]);
  });

  test("persists deferred queued follow-ups with canonical metadata projection and mutation isolation", async () => {
    const { db, service } = await createServiceFixture();
    const contentBlock = { type: "text", nested: { value: 1 } };
    const linkPreview = { href: "https://example.test" };
    const queuedBy = { userId: " user ", sessionId: " session ", clientId: " client " };

    const rowId = service.enqueueQueuedFollowupItem("web:default", 0, "deferred metadata", null, "2024-01-01T00:00:00.000Z", {
      mediaIds: [1, 2],
      contentBlocks: [contentBlock],
      linkPreviews: [linkPreview],
      screenHint: " mobile ",
      source: " test ",
      queuedBy,
    });

    contentBlock.nested.value = 99;
    linkPreview.href = "https://mutated.test";
    queuedBy.userId = "mutated";

    const persisted = db.getDeferredQueuedFollowups("web:default");
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      rowId,
      queuedContent: "deferred metadata",
      threadId: null,
      queuedAt: "2024-01-01T00:00:00.000Z",
      mediaIds: [1, 2],
      screenHint: "mobile",
      source: "test",
      queuedBy: { userId: "user", sessionId: "session", clientId: "client" },
      materializeRetries: 0,
    });
    expect((persisted[0].contentBlocks?.[0] as any).nested.value).toBe(1);
    expect((persisted[0].linkPreviews?.[0] as any).href).toBe("https://example.test");

    (persisted[0].contentBlocks?.[0] as any).nested.value = 2;
    expect((service.getQueuedFollowupItems("web:default")[0].contentBlocks?.[0] as any).nested.value).toBe(1);
  });

  test("prioritizes protected source continuations ahead of later queued follow-ups", async () => {
    const { service } = await createServiceFixture();

    service.enqueueQueuedFollowupItem("web:default", 0, "user follow-up", 10, "2024-01-01T00:00:02.000Z", {
      source: "user-queued",
    });
    service.enqueueQueuedFollowupItem("web:default", 0, "protected first", 10, "2024-01-01T00:00:03.000Z", {
      source: "auto-protected-recovery-continuation",
      queuedBy: { source: "runtime", sourceMessageId: "source-1" },
    });
    service.enqueueQueuedFollowupItem("web:default", 0, "protected second", 20, "2024-01-01T00:00:04.000Z", {
      source: "auto-protected-recovery-continuation",
      queuedBy: { source: "runtime", sourceMessageId: "source-2" },
    });

    expect(service.getQueuedFollowupItems("web:default").map((item) => item.queuedContent)).toEqual([
      "protected first",
      "protected second",
      "user follow-up",
    ]);
  });

  test("replaces retry metadata in one persisted queue mutation", async () => {
    const { service } = await createServiceFixture();
    const rowId = service.enqueueQueuedFollowupItem("web:default", 0, "retry me", 10, "2024-01-01T00:00:00.000Z");
    const original = service.getQueuedFollowupItems("web:default")[0]!;

    expect(service.replaceQueuedFollowupItem("web:default", { ...original, materializeRetries: 1 })).toBe(true);
    expect(service.getQueuedFollowupItems("web:default")).toEqual([
      expect.objectContaining({ rowId, materializeRetries: 1 }),
    ]);
  });

  test("rejects reordering that moves ordinary work ahead of protected continuations", async () => {
    const { service } = await createServiceFixture();

    service.enqueueQueuedFollowupItem("web:default", 0, "protected", 10, "2024-01-01T00:00:00.000Z", {
      source: "auto-protected-recovery-continuation",
      queuedBy: { source: "runtime", sourceMessageId: "source-1" },
    });
    service.enqueueQueuedFollowupItem("web:default", 0, "ordinary", 10, "2024-01-01T00:00:01.000Z");

    expect(service.reorderQueuedFollowupItems("web:default", 1, 0)).toBe(false);
    expect(service.getQueuedFollowupItems("web:default").map((item) => item.queuedContent)).toEqual([
      "protected",
      "ordinary",
    ]);
  });

  test("removes deferred queued follow-ups without touching active-session placeholder cleanup", async () => {
    const { db, service } = await createServiceFixture();

    const deferredRowId = service.enqueueQueuedFollowupItem(
      "web:default",
      0,
      "deferred only",
      null,
      "2024-01-01T00:00:00.000Z",
      { mediaIds: [9], contentBlocks: [{ type: "text" }], linkPreviews: [{ href: "https://example.com" }] }
    );

    let sessionRemovalCalls = 0;
    const result = await service.removeQueuedFollowupForAction("web:default", deferredRowId, {
      removeQueuedFollowupMessage: async () => {
        sessionRemovalCalls += 1;
        return true;
      },
    });

    expect(result.source).toBe("deferred");
    expect(result.removed).toEqual({
      rowId: deferredRowId,
      queuedContent: "deferred only",
      threadId: null,
      queuedAt: "2024-01-01T00:00:00.000Z",
      mediaIds: [9],
      contentBlocks: [{ type: "text" }],
      linkPreviews: [{ href: "https://example.com" }],
      materializeRetries: 0,
    });
    expect(service.getQueuedFollowupCount("web:default")).toBe(0);
    expect(db.getDeferredQueuedFollowups("web:default")).toEqual([]);
    expect(sessionRemovalCalls).toBe(0);
  });
});
