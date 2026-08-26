// Self-isolating: forces PICLAW_DB_IN_MEMORY=1 via shared test helpers
import "../../helpers.js";

import { describe, test, expect, beforeAll, beforeEach } from "bun:test";
import { getDb, initDatabase } from "../../../src/db/connection.js";
import {
  storeThinkingContent,
  getThinkingContentForChat,
} from "../../../src/db/messages.js";

/**
 * R2 endpoint security tests for getThinkingContentForChat — the validated
 * lookup function called by GET /agent/thinking.
 *
 * The maintainer asked: "Please verify the requested id corresponds to a
 * real visible bot message containing a thinking_ref block, and ideally
 * include/check chat_jid so the endpoint is scoped to the timeline context
 * rather than being a raw thinking-content lookup."
 *
 * These tests cover each prong of that validation independently so any
 * regression in the IDOR defenses is caught at the unit level. The 400
 * branches (missing params) live in the HTTP handler and are validated by
 * inspection of dispatch-agent.ts — they cannot be exercised against the
 * function whose signature requires both string parameters.
 *
 * Key invariant: any single missing prong returns null (which the handler
 * translates to a uniform 404). No oracle distinguishes "wrong chat" from
 * "no such message" from "is a user message" — all surface as null.
 */
describe("getThinkingContentForChat — endpoint validation", () => {
  beforeAll(() => {
    initDatabase();
  });

  /** Seed a fresh DB with controllable knobs for each prong. */
  function seedScenario(opts: {
    chatJid: string;
    isBotMessage?: boolean;
    contentBlocks?: unknown[] | null;
    withThinkingContent?: boolean;
  }): number {
    const db = getDb();
    db.exec("DELETE FROM thinking_content");
    db.exec("DELETE FROM messages");
    db.exec("DELETE FROM chats");
    db.prepare("INSERT OR IGNORE INTO chats(jid, name) VALUES (?, ?)").run(opts.chatJid, opts.chatJid);
    const messageId = `test-${Date.now()}-${Math.random()}`;
    const blocks = opts.contentBlocks === undefined
      ? [{ type: "thinking_ref", lines: 5, duration_ms: 1000 }]
      : opts.contentBlocks;
    db.prepare(
      `INSERT INTO messages(id, chat_jid, sender, sender_name, content, content_blocks, timestamp, is_from_me, is_bot_message, is_terminal_agent_reply)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 1)`
    ).run(
      messageId,
      opts.chatJid,
      opts.isBotMessage === false ? "web-user" : "web-agent",
      "tester",
      "hello",
      blocks === null ? null : JSON.stringify(blocks),
      new Date().toISOString(),
      opts.isBotMessage === false ? 0 : 1,
    );
    const row = db.prepare("SELECT rowid FROM messages WHERE id = ? AND chat_jid = ?").get(messageId, opts.chatJid) as { rowid: number };
    if (opts.withThinkingContent !== false) {
      storeThinkingContent(String(row.rowid), "reasoning trace text", 5, 1000, "test-model");
    }
    return row.rowid;
  }

  test("happy path: bot message in chat with thinking_ref + thinking_content → returns payload", () => {
    const rowId = seedScenario({ chatJid: "web:default" });
    const result = getThinkingContentForChat("web:default", String(rowId));
    expect(result).not.toBeNull();
    expect(result!.text).toBe("reasoning trace text");
    expect(result!.lines).toBe(5);
    expect(result!.duration_ms).toBe(1000);
    expect(result!.model).toBe("test-model");
    expect(result!.truncated).toBe(false);
  });

  test("agent turn classification remains orthogonal to thinking retrieval", () => {
    const rowId = seedScenario({
      chatJid: "web:default",
      contentBlocks: [
        { type: "agent_turn_marker", kind: "draft_snapshot", cause: "interrupted_text_start" },
        { type: "thinking_ref", lines: 5, duration_ms: 1000 },
      ],
    });
    expect(getThinkingContentForChat("web:default", String(rowId))?.text).toBe("reasoning trace text");
  });

  test("IDOR: wrong chat_jid for a real message → returns null", () => {
    const rowId = seedScenario({ chatJid: "web:default" });
    // Attacker guesses the rowid but supplies the wrong chat
    const result = getThinkingContentForChat("web:branch-x", String(rowId));
    expect(result).toBeNull();
  });

  test("non-bot message (user message with same rowid) → returns null", () => {
    // is_bot_message = 0 prong
    const rowId = seedScenario({ chatJid: "web:default", isBotMessage: false });
    const result = getThinkingContentForChat("web:default", String(rowId));
    expect(result).toBeNull();
  });

  test("bot message without thinking_ref block → returns null", () => {
    // content_blocks does not contain thinking_ref prong
    const rowId = seedScenario({
      chatJid: "web:default",
      contentBlocks: [{ type: "outcome_marker", title: "ok" }],
    });
    const result = getThinkingContentForChat("web:default", String(rowId));
    expect(result).toBeNull();
  });

  test("bot message with null content_blocks → returns null", () => {
    const rowId = seedScenario({ chatJid: "web:default", contentBlocks: null });
    const result = getThinkingContentForChat("web:default", String(rowId));
    expect(result).toBeNull();
  });

  test("bot message with thinking_ref but no thinking_content row → returns null", () => {
    // The orphan-ref case (e.g. data was purged but block remained)
    const rowId = seedScenario({ chatJid: "web:default", withThinkingContent: false });
    const result = getThinkingContentForChat("web:default", String(rowId));
    expect(result).toBeNull();
  });

  test("nonexistent message_id → returns null", () => {
    seedScenario({ chatJid: "web:default" });
    const result = getThinkingContentForChat("web:default", "999999");
    expect(result).toBeNull();
  });

  test("nonexistent chat_jid for a real message → returns null", () => {
    const rowId = seedScenario({ chatJid: "web:default" });
    const result = getThinkingContentForChat("not-a-chat-at-all", String(rowId));
    expect(result).toBeNull();
  });

  test("non-numeric message_id is handled safely (no SQL injection)", () => {
    seedScenario({ chatJid: "web:default" });
    // Should not throw, should return null
    expect(() => getThinkingContentForChat("web:default", "abc'; DROP TABLE messages;--")).not.toThrow();
    const result = getThinkingContentForChat("web:default", "abc'; DROP TABLE messages;--");
    expect(result).toBeNull();
    // Confirm messages table still exists
    const db = getDb();
    const cnt = db.prepare("SELECT COUNT(*) as n FROM messages").get() as { n: number };
    expect(cnt.n).toBe(1);
  });

  test("two prongs missing (wrong chat + non-bot) still returns null (no oracle leak)", () => {
    const rowId = seedScenario({ chatJid: "web:default", isBotMessage: false });
    const result = getThinkingContentForChat("web:other", String(rowId));
    expect(result).toBeNull();
  });

  describe("regression: every prong is enforced (no single-check bypass)", () => {
    beforeEach(() => {
      const db = getDb();
      db.exec("DELETE FROM thinking_content");
      db.exec("DELETE FROM messages");
      db.exec("DELETE FROM chats");
    });

    // A truth table: for each combination of (correct chat, is bot, has thinking_ref,
    // has thinking_content), confirm 200 only when ALL 4 are true.
    const cases: Array<{
      label: string;
      correctChat: boolean;
      isBot: boolean;
      hasRefBlock: boolean;
      hasThinking: boolean;
      expectNull: boolean;
    }> = [
      { label: "all four ok", correctChat: true, isBot: true, hasRefBlock: true, hasThinking: true, expectNull: false },
      { label: "wrong chat", correctChat: false, isBot: true, hasRefBlock: true, hasThinking: true, expectNull: true },
      { label: "user msg", correctChat: true, isBot: false, hasRefBlock: true, hasThinking: true, expectNull: true },
      { label: "no ref block", correctChat: true, isBot: true, hasRefBlock: false, hasThinking: true, expectNull: true },
      { label: "no thinking row", correctChat: true, isBot: true, hasRefBlock: true, hasThinking: false, expectNull: true },
      { label: "only chat correct", correctChat: true, isBot: false, hasRefBlock: false, hasThinking: false, expectNull: true },
    ];

    for (const c of cases) {
      test(`truth-table: ${c.label} → ${c.expectNull ? "null" : "row"}`, () => {
        const blocks = c.hasRefBlock
          ? [{ type: "thinking_ref", lines: 1, duration_ms: 1 }]
          : [{ type: "outcome_marker", title: "x" }];
        const rowId = seedScenario({
          chatJid: "web:owner",
          isBotMessage: c.isBot,
          contentBlocks: blocks,
          withThinkingContent: c.hasThinking,
        });
        const queryChat = c.correctChat ? "web:owner" : "web:attacker";
        const result = getThinkingContentForChat(queryChat, String(rowId));
        if (c.expectNull) expect(result).toBeNull();
        else expect(result).not.toBeNull();
      });
    }
  });
});
