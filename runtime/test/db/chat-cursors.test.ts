/** Polling position and durable queued payload/provenance; SDK tasks own execution. */
import { beforeAll, describe, expect, test } from "bun:test";

import { getTestWorkspace, setEnv } from "../helpers.js";

let db: typeof import("../../src/db.js");

const jid = (suffix: string) => `cursors:${suffix}`;

beforeAll(async () => {
  const ws = getTestWorkspace();
  setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });
  db = await import("../../src/db.js");
  db.initDatabase();
});

describe("getChatCursor", () => {
  test("returns empty string for a chat that has never been seen", () => {
    expect(db.getChatCursor(jid("get-unknown"))).toBe("");
  });

  test("returns the value written by setChatCursor", () => {
    const chatJid = jid("get-set");
    db.setChatCursor(chatJid, "2024-01-01T00:00:00.000Z");
    expect(db.getChatCursor(chatJid)).toBe("2024-01-01T00:00:00.000Z");
  });

  test("returns the most recent value after multiple setChatCursor calls", () => {
    const chatJid = jid("get-overwrite");
    db.setChatCursor(chatJid, "2024-01-01T00:00:00.000Z");
    db.setChatCursor(chatJid, "2024-06-15T12:00:00.000Z");
    expect(db.getChatCursor(chatJid)).toBe("2024-06-15T12:00:00.000Z");
  });
});

describe("getAllChatCursors", () => {
  test("includes cursors written with setChatCursor", () => {
    const chatJid = jid("all-basic");
    db.setChatCursor(chatJid, "2024-02-01T00:00:00.000Z");
    expect(db.getAllChatCursors()[chatJid]).toBe("2024-02-01T00:00:00.000Z");
  });

  test("queue-only persistence creates no processed cursor", () => {
    const chatJid = jid("all-queue-only");
    db.setDeferredQueuedFollowups(chatJid, [{rowId:-1,queuedContent:"pending",threadId:null,queuedAt:"2024-03-01T00:00:00.000Z"}]);
    expect(db.getAllChatCursors()[chatJid]).toBe("");
    expect(db.getDeferredQueuedFollowups(chatJid)).toHaveLength(1);
  });
});

describe("deferred queued follow-ups", () => {
  test("round-trips deferred queued items through chat_cursors", () => {
    const chatJid = jid("deferred-basic");
    db.setDeferredQueuedFollowups(chatJid, [{
      rowId: -1,
      queuedContent: "queued",
      threadId: null,
      queuedAt: "2024-03-10T00:00:00.000Z",
      mediaIds: [1, 2],
      contentBlocks: [{ type: "markdown", text: "queued" }],
      linkPreviews: [{ url: "https://example.com" }],
    }]);

    expect(db.getDeferredQueuedFollowups(chatJid)).toEqual([{ 
      rowId: -1,
      queuedContent: "queued",
      threadId: null,
      queuedAt: "2024-03-10T00:00:00.000Z",
      mediaIds: [1, 2],
      contentBlocks: [{ type: "markdown", text: "queued" }],
      linkPreviews: [{ url: "https://example.com" }],
      materializeRetries: 0,
    }]);
  });

  test("removes only the matching source-tagged protected continuation", () => {
    const chatJid = jid("deferred-replay-cleanup");
    db.setDeferredQueuedFollowups(chatJid, [
      {
        rowId: -1,
        queuedContent: "stale protected",
        threadId: null,
        queuedAt: "2024-03-10T00:00:00.000Z",
        source: "auto-protected-recovery-continuation",
        queuedBy: { source: "runtime", sourceMessageId: "source-replay" },
      },
      {
        rowId: -2,
        queuedContent: "other protected",
        threadId: null,
        queuedAt: "2024-03-10T00:00:01.000Z",
        source: "auto-protected-recovery-continuation",
        queuedBy: { source: "runtime", sourceMessageId: "other-source" },
      },
      {
        rowId: -3,
        queuedContent: "user follow-up",
        threadId: null,
        queuedAt: "2024-03-10T00:00:02.000Z",
      },
    ]);

    expect(db.removeProtectedRecoveryContinuationForSourceMessageId(chatJid, "source-replay")).toBe(true);
    expect(db.getDeferredQueuedFollowups(chatJid).map((item) => item.queuedContent)).toEqual([
      "other protected",
      "user follow-up",
    ]);
  });

  test("cursor acknowledgments preserve queued payloads", () => {
    const chatJid = jid("deferred-survives-run");
    db.setDeferredQueuedFollowups(chatJid, [{
      rowId: -1,
      queuedContent: "queued",
      threadId: null,
      queuedAt: "2024-03-10T00:00:00.000Z",
    }]);

    db.setChatCursor(chatJid, "2024-03-11T00:00:00.000Z");

    expect(db.getDeferredQueuedFollowups(chatJid)).toEqual([{
      rowId: -1,
      queuedContent: "queued",
      threadId: null,
      queuedAt: "2024-03-10T00:00:00.000Z",
      materializeRetries: 0,
    }]);
  });
});
