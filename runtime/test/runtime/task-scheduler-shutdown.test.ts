import { afterEach, expect, test } from "bun:test";
import { getTestWorkspace, setEnv } from "../helpers.js";
import {
  clearPendingShutdownForTests,
  isPendingShutdown,
  markPendingShutdown,
} from "../../src/runtime/shutdown-registry.js";

const testGlobals = globalThis as typeof globalThis & {
  __PICLAW_EXIT_SCHEDULER__?: () => void;
  __PICLAW_PENDING_SHUTDOWN_FAIL_SAFE_SCHEDULER__?: (callback: () => void, delayMs: number) => void;
};
let restoreEnv: (() => void) | null = null;

afterEach(() => {
  clearPendingShutdownForTests();
  delete testGlobals.__PICLAW_EXIT_SCHEDULER__;
  delete testGlobals.__PICLAW_PENDING_SHUTDOWN_FAIL_SAFE_SCHEDULER__;
  restoreEnv?.();
  restoreEnv = null;
});

test("scheduled agent finalization executes its own pending shutdown", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../src/db.js");
  db.initDatabase();
  const scheduler = await import("../../src/task-scheduler.js");

  const taskId = `task-shutdown-${Date.now()}`;
  const chatJid = "web:scheduled-shutdown-owner";
  db.createTask({
    id: taskId,
    chat_jid: chatJid,
    prompt: "deploy and restart",
    task_kind: "agent",
    schedule_type: "once",
    schedule_value: new Date().toISOString(),
    next_run: new Date(Date.now() - 1000).toISOString(),
    status: "active",
    created_at: new Date().toISOString(),
  });

  let resolveShutdown!: () => void;
  const shutdownRequested = new Promise<void>((resolve) => {
    resolveShutdown = resolve;
  });
  testGlobals.__PICLAW_EXIT_SCHEDULER__ = resolveShutdown;
  testGlobals.__PICLAW_PENDING_SHUTDOWN_FAIL_SAFE_SCHEDULER__ = () => {};

  const deps = {
    queue: {} as any,
    agentPool: {
      runAgent: async () => {
        markPendingShutdown("load deployment", chatJid, () => true);
        return { status: "success", result: null };
      },
      saveSessionPosition: async () => "leaf-shutdown",
      restoreSessionPosition: async () => {},
      getCurrentModelLabel: async () => null,
      applyControlCommand: async () => ({ status: "success", message: "" }),
    } as any,
    sendMessage: async () => {},
  };

  await scheduler.runScheduledTask(db.getTaskById(taskId)!, deps as any);

  expect(isPendingShutdown()).toBe(false);
  expect(db.getTaskRunLogs(taskId)).toHaveLength(1);
  await Promise.race([
    shutdownRequested,
    new Promise((_, reject) => setTimeout(() => reject(new Error("shutdown was not requested")), 2500)),
  ]);
});

test("an unrelated scheduled chat cannot finalize another chat's shutdown", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../src/db.js");
  db.initDatabase();
  const scheduler = await import("../../src/task-scheduler.js");

  const ownerChatJid = "web:shutdown-owner";
  const unrelatedChatJid = "web:daily-brief";
  markPendingShutdown("load deployment", ownerChatJid, () => true);
  testGlobals.__PICLAW_PENDING_SHUTDOWN_FAIL_SAFE_SCHEDULER__ = () => {};

  const taskId = `task-unrelated-${Date.now()}`;
  db.createTask({
    id: taskId,
    chat_jid: unrelatedChatJid,
    prompt: "send daily brief",
    task_kind: "agent",
    schedule_type: "once",
    schedule_value: new Date().toISOString(),
    next_run: new Date(Date.now() - 1000).toISOString(),
    status: "active",
    created_at: new Date().toISOString(),
  });

  let runCount = 0;
  await scheduler.runScheduledTask(db.getTaskById(taskId)!, {
    queue: {} as any,
    agentPool: {
      runAgent: async () => {
        runCount += 1;
        expect(isPendingShutdown(unrelatedChatJid)).toBe(false);
        return { status: "success", result: "Brief sent" };
      },
      saveSessionPosition: async () => "leaf-brief",
      restoreSessionPosition: async () => {},
      getCurrentModelLabel: async () => null,
      applyControlCommand: async () => ({ status: "success", message: "" }),
    } as any,
    sendMessage: async () => {},
  } as any);

  expect(runCount).toBe(1);
  expect(isPendingShutdown(ownerChatJid)).toBe(true);
});
