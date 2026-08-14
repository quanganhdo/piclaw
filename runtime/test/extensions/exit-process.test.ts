import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import "../helpers.js";
import { withChatContext } from "../../src/core/chat-context.js";
import { extensionKvClear, initDatabase } from "../../src/db.js";
import { exitProcess } from "../../src/extensions/exit-process.js";
import { setMessagesPostFn } from "../../src/extensions/messages-crud.js";
import {
  checkPendingShutdown,
  isPendingShutdown,
} from "../../src/runtime/shutdown-registry.js";
import {
  EXIT_PROCESS_HANDOFF_EXTENSION_ID,
  listRestartHandoffs,
} from "../../src/runtime/restart-handoff.js";
import { createFakeExtensionApi } from "./fake-extension-api.js";
import {
  clearSessionStatusForTests,
  removeSession,
  updateSessionStreaming,
} from "../../src/extensions/session-status.js";

type PostedMessage = {
  chatJid: string;
  content: string;
  isBot: boolean;
  mediaIds: number[];
  contentBlocks?: unknown[];
};

function getTool() {
  const fake = createFakeExtensionApi();
  exitProcess(fake.api);
  return toolOrThrow(fake.tools.get("exit_process"));
}

function toolOrThrow(tool: any) {
  if (!tool) throw new Error("exit_process was not registered");
  return tool;
}

describe("exit_process extension", () => {
  beforeAll(() => {
    initDatabase();
  });

  beforeEach(() => {
    clearSessionStatusForTests();
  });

  afterEach(async () => {
    setMessagesPostFn(undefined);
    extensionKvClear(EXIT_PROCESS_HANDOFF_EXTENSION_ID);
    if (!isPendingShutdown()) return;

    await new Promise<void>((resolve) => {
      (globalThis as { __PICLAW_EXIT_SCHEDULER__?: () => void }).__PICLAW_EXIT_SCHEDULER__ = resolve;
      checkPendingShutdown();
    });
    delete (globalThis as { __PICLAW_EXIT_SCHEDULER__?: () => void }).__PICLAW_EXIT_SCHEDULER__;
  });

  test("requires a non-empty reason and exposes an optional non-empty resume message", () => {
    const tool = getTool();
    expect(tool.parameters.required).toEqual(["reason"]);
    expect(tool.parameters.properties.reason.minLength).toBe(1);
    expect(tool.parameters.properties.reason.pattern).toBe("\\S");
    expect(tool.parameters.properties.resume_message.minLength).toBe(1);
    expect(tool.parameters.properties.resume_message.pattern).toBe("\\S");
    expect(tool.description).toContain("non-empty reason is required");
    expect(tool.description).toContain("optional resume_message");
  });

  test("rejects missing or blank reasons without posting or scheduling shutdown", async () => {
    const tool = getTool();
    let postCalls = 0;
    setMessagesPostFn(() => {
      postCalls += 1;
      return 1;
    });

    for (const params of [{}, { reason: "  \n\t" }]) {
      const result = await withChatContext("web:exit-phase-1", "web", () => tool.execute("tool-exit", params));
      expect(result.details.scheduled).toBe(false);
      expect(result.details.error).toContain("non-empty reason");
      expect(result.terminate).toBeUndefined();
      expect(isPendingShutdown()).toBe(false);
    }

    expect(postCalls).toBe(0);
  });

  test("rejects a blank resume message without persisting, posting, or scheduling shutdown", async () => {
    const tool = getTool();
    let postCalls = 0;
    setMessagesPostFn(() => {
      postCalls += 1;
      return 1;
    });

    const result = await withChatContext("web:exit-phase-2", "web", () => tool.execute("tool-exit", {
      reason: "Load phase 2.",
      resume_message: "  \n\t",
    }));

    expect(result.details.scheduled).toBe(false);
    expect(result.details.error).toContain("resume_message");
    expect(result.terminate).toBeUndefined();
    expect(postCalls).toBe(0);
    expect(listRestartHandoffs()).toEqual([]);
    expect(isPendingShutdown()).toBe(false);
  });

  test("refuses shutdown while another session is active", async () => {
    const tool = getTool();
    let postCalls = 0;
    setMessagesPostFn(() => {
      postCalls += 1;
      return 1;
    });
    updateSessionStreaming("web:other-active", true);
    try {
      const result = await withChatContext("web:exit-phase-2", "web", () => tool.execute("tool-exit", {
        reason: "Load phase 2.",
        resume_message: "Continue after restart.",
      }));
      expect(result.details.scheduled).toBe(false);
      expect(result.details.error).toContain("other session(s) are active");
      expect(result.terminate).toBeUndefined();
      expect(postCalls).toBe(0);
      expect(listRestartHandoffs()).toEqual([]);
      expect(isPendingShutdown()).toBe(false);
    } finally {
      removeSession("web:other-active");
    }
  });

  test("does not post or schedule shutdown when the durable handoff cannot be stored", async () => {
    const tool = getTool();
    let postCalls = 0;
    setMessagesPostFn(() => {
      postCalls += 1;
      return 1;
    });

    const result = await withChatContext("web:exit-phase-2", "web", () => tool.execute("tool-exit", {
      reason: "Load phase 2.",
      resume_message: "x".repeat(70_000),
    }));

    expect(result.details.scheduled).toBe(false);
    expect(result.details.error).toContain("persist the restart handoff");
    expect(result.terminate).toBeUndefined();
    expect(postCalls).toBe(0);
    expect(listRestartHandoffs()).toEqual([]);
    expect(isPendingShutdown()).toBe(false);
  });

  test("does not schedule shutdown when the restart notice cannot be stored", async () => {
    const tool = getTool();
    setMessagesPostFn(() => null);

    const result = await withChatContext("web:exit-phase-1", "web", () => tool.execute("tool-exit", {
      reason: "Load the verified phase 1 build.",
    }));

    expect(result.details.scheduled).toBe(false);
    expect(result.details.error).toContain("restart notice");
    expect(result.terminate).toBeUndefined();
    expect(listRestartHandoffs()).toEqual([]);
    expect(isPendingShutdown()).toBe(false);
  });

  test("does not schedule shutdown without an active chat", async () => {
    const tool = getTool();
    let postCalls = 0;
    setMessagesPostFn(() => {
      postCalls += 1;
      return 1;
    });

    const result = await tool.execute("tool-exit", {
      reason: "Load the verified phase 1 build.",
    });

    expect(result.details.scheduled).toBe(false);
    expect(result.details.error).toContain("active chat");
    expect(result.terminate).toBeUndefined();
    expect(postCalls).toBe(0);
    expect(isPendingShutdown()).toBe(false);
  });

  test("persists a ready handoff and posts an agent-owned restart notice before scheduling shutdown", async () => {
    const tool = getTool();
    const posted: PostedMessage[] = [];
    let pendingAtPost = true;
    setMessagesPostFn((chatJid, content, isBot, mediaIds, contentBlocks) => {
      pendingAtPost = isPendingShutdown();
      posted.push({ chatJid, content, isBot, mediaIds, contentBlocks });
      return 4242;
    });

    const result = await withChatContext("web:exit-phase-2", "web", () => tool.execute("tool-exit", {
      reason: "  Load the verified phase 2 build.  ",
      resume_message: "  Continue the deployment verification.  ",
    }));

    expect(posted).toEqual([{
      chatJid: "web:exit-phase-2",
      content: "Restarting now — Reason: Load the verified phase 2 build.",
      isBot: true,
      mediaIds: [],
      contentBlocks: [{
        type: "restart_handoff",
        source: "exit_process",
        restart_id: expect.any(String),
        phase: "notice",
        reason: "Load the verified phase 2 build.",
      }],
    }]);
    expect(result.details).toMatchObject({
      tool: "exit_process",
      scheduled: true,
      reason: "Load the verified phase 2 build.",
      chat_jid: "web:exit-phase-2",
      resume_message: "Continue the deployment verification.",
      restart_message: "Restarting now — Reason: Load the verified phase 2 build.",
      restart_message_row_id: 4242,
      restart_message_broadcast: true,
    });
    expect(typeof result.details.restart_id).toBe("string");
    expect(posted[0]?.contentBlocks?.[0]).toMatchObject({ restart_id: result.details.restart_id });
    expect(pendingAtPost).toBe(false);
    expect(result.terminate).toBe(true);
    expect(isPendingShutdown()).toBe(true);
    expect(isPendingShutdown("web:exit-phase-2")).toBe(true);
    expect(isPendingShutdown("web:unrelated")).toBe(false);

    expect(listRestartHandoffs()).toEqual([{
      version: 1,
      restartId: result.details.restart_id,
      state: "ready",
      chatJid: "web:exit-phase-2",
      reason: "Load the verified phase 2 build.",
      resumeMessage: "Continue the deployment verification.",
      requestedAt: expect.any(String),
      restartMessageRowId: 4242,
      completionMessageRowId: null,
      resumeMessageRowId: null,
    }]);
  });
});
