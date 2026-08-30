import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

import { importFresh } from "./helpers.js";

afterEach(() => {
  // no-op: test uses whichever workspace path the current config module has cached
});

const acceptModelChange = async () => ({ status: "success", message: "ok" } as const);

test("runDreamAgentTurn applies an explicit Dream model override to the temporary dream chat", async () => {
  const config = await import("../src/core/config.js");
  rmSync(join(config.WORKSPACE_DIR, "notes"), { recursive: true, force: true });
  rmSync(join(config.DATA_DIR, "dream-backups"), { recursive: true, force: true });
  rmSync(join(config.DATA_DIR, "workspace-search"), { recursive: true, force: true });

  const db = await import("../src/db.js");
  db.initDatabase();

  const fixedNow = Date.parse("2026-01-02T03:04:05.000Z");
  const expectedDreamChatJid = `dream:manual:web_default:${fixedNow}`;
  const applied: Array<{ chatJid: string; raw: string | undefined }> = [];
  const runChats: string[] = [];

  const realNow = Date.now;
  Date.now = () => fixedNow;
  try {
    const dream = await importFresh<typeof import("../src/dream.js")>("../src/dream.js");
    const result = await dream.runDreamAgentTurn({
      chatJid: "web:default",
      days: 2,
      mode: "manual",
      model: "openai-compatible/glm-5.1",
      agentPool: {
        applyControlCommand: async (chatJid: string, command: { raw?: string }) => {
          applied.push({ chatJid, raw: command.raw });
          return { status: "success", message: "ok" };
        },
        runAgent: async (_prompt: string, chatJid: string) => {
          runChats.push(chatJid);
          return { status: "success", result: "Dream complete." };
        },
        disposeChatSession: async () => {},
      } as any,
    });

    expect(result.skipped).toBe(false);
    expect(applied).toEqual([{ chatJid: expectedDreamChatJid, raw: "/model openai-compatible/glm-5.1" }]);
    expect(runChats).toEqual([expectedDreamChatJid]);
  } finally {
    Date.now = realNow;
  }
});

test("runDreamAgentTurn reaps a stale dream lock and materializes memory files after the model pass", { timeout: 15000 }, async () => {
  const config = await import("../src/core/config.js");
  rmSync(join(config.WORKSPACE_DIR, "notes"), { recursive: true, force: true });
  rmSync(join(config.DATA_DIR, "dream-backups"), { recursive: true, force: true });
  rmSync(join(config.DATA_DIR, "workspace-search"), { recursive: true, force: true });
  mkdirSync(join(config.DATA_DIR, "dream-backups"), { recursive: true });
  for (let i = 0; i < 12; i += 1) {
    writeFileSync(join(config.DATA_DIR, "dream-backups", `2026-01-01T00-00-${String(i).padStart(2, "0")}-000Z-auto-web_default.zip`), "old", "utf8");
  }
  mkdirSync(join(config.WORKSPACE_DIR, "notes", "memory"), { recursive: true });
  writeFileSync(join(config.WORKSPACE_DIR, "notes", "memory", ".dream.lock"), "999999\n", "utf8");

  const fixedNow = Date.parse("2026-01-02T03:04:05.000Z");
  const dreamChatJid = `dream:auto:web_default:${fixedNow}`;
  const dreamSessionDir = join(config.DATA_DIR, "sessions", `dream_auto_web_default_${fixedNow}`);

  const realNow = Date.now;
  Date.now = () => fixedNow;
  try {
    const db = await importFresh<typeof import("../src/db.js")>("../src/db.js");
    db.initDatabase();
    const rawDb = db.getDb();
    rawDb.prepare("INSERT OR REPLACE INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)").run(dreamChatJid, "dream", "2026-01-01T00:00:00.000Z");
    rawDb.prepare("INSERT OR REPLACE INTO chat_cursors (chat_jid, cursor_ts) VALUES (?, ?)").run(dreamChatJid, "2026-01-01T00:00:00.000Z");
    rawDb.prepare("INSERT OR REPLACE INTO chat_branches (branch_id, chat_jid, root_chat_jid, parent_branch_id, agent_name, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      "dream-branch-1",
      dreamChatJid,
      dreamChatJid,
      null,
      "dream-test-agent",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      null,
    );
    rawDb.prepare("INSERT INTO token_usage (chat_jid, run_at, input_tokens, output_tokens, total_tokens, turns) VALUES (?, ?, ?, ?, ?, ?)").run(
      dreamChatJid,
      "2026-01-01T00:00:00.000Z",
      10,
      20,
      30,
      1,
    );
    mkdirSync(dreamSessionDir, { recursive: true });
    writeFileSync(join(dreamSessionDir, "session.json"), "{}", "utf8");

    const dream = await importFresh<typeof import("../src/dream.js")>("../src/dream.js");
    const result = await dream.runDreamAgentTurn({
      chatJid: "web:default",
      days: 2,
      mode: "auto",
      agentPool: {
        applyControlCommand: acceptModelChange,
        runAgent: async () => ({ status: "success", result: "AutoDream complete." }),
        disposeChatSession: async () => {},
      } as any,
    });

    expect(result.skipped).toBe(false);
    expect(existsSync(join(config.WORKSPACE_DIR, "notes", "memory", "MEMORY.md"))).toBe(true);
    expect(existsSync(join(config.WORKSPACE_DIR, "notes", "memory", "current-state.md"))).toBe(true);
    expect(existsSync(join(config.WORKSPACE_DIR, "notes", "memory", "recent-context.md"))).toBe(true);
    expect(readFileSync(join(config.WORKSPACE_DIR, "notes", "memory", ".dream-state"), "utf8"))
      .toContain("recovery: complete");
    expect(result.result).toContain("Memory refreshed after Dream: yes");

    expect(rawDb.prepare("SELECT COUNT(*) AS count FROM chats WHERE jid = ?").get(dreamChatJid)).toEqual({ count: 0 });
    expect(rawDb.prepare("SELECT COUNT(*) AS count FROM chat_cursors WHERE chat_jid = ?").get(dreamChatJid)).toEqual({ count: 0 });
    expect(rawDb.prepare("SELECT COUNT(*) AS count FROM chat_branches WHERE chat_jid = ?").get(dreamChatJid)).toEqual({ count: 0 });
    expect(rawDb.prepare("SELECT COUNT(*) AS count FROM token_usage WHERE chat_jid = ?").get(dreamChatJid)).toEqual({ count: 0 });
    expect(existsSync(dreamSessionDir)).toBe(false);

    const backups = readdirSync(join(config.DATA_DIR, "dream-backups")).sort();
    expect(backups).toHaveLength(10);
    const latestBackup = join(config.DATA_DIR, "dream-backups", backups.at(-1)!);
    expect(latestBackup.endsWith(".zip")).toBe(true);
    const list = Bun.spawnSync(["unzip", "-Z1", latestBackup], { stdout: "pipe", stderr: "pipe" });
    expect(list.exitCode, list.stderr.toString()).toBe(0);
    const archived = list.stdout.toString("utf8");
    expect(archived).toContain("manifest.json");
    expect(archived).not.toContain("notes/memory/.dream.lock");
  } finally {
    Date.now = realNow;
  }
});

test("runDreamAgentTurn skips gracefully when another live Dream run holds the lock", async () => {
  const config = await import("../src/core/config.js");
  rmSync(join(config.WORKSPACE_DIR, "notes"), { recursive: true, force: true });
  mkdirSync(join(config.WORKSPACE_DIR, "notes", "memory"), { recursive: true });
  writeFileSync(join(config.WORKSPACE_DIR, "notes", "memory", ".dream.lock"), "424242\n", "utf8");

  const realKill = process.kill;
  try {
    process.kill = ((pid: number, signal?: number | NodeJS.Signals) => {
      expect(pid).toBe(424242);
      void signal;
      return true;
    }) as typeof process.kill;

    const dream = await importFresh<typeof import("../src/dream.js")>("../src/dream.js");
    const result = await dream.runDreamAgentTurn({
      chatJid: "web:default",
      days: 2,
      mode: "auto",
      agentPool: {
        runAgent: async () => ({ status: "success", result: "should not run" }),
        disposeChatSession: async () => {},
      } as any,
    });

    expect(result.skipped).toBe(true);
    expect(result.result).toContain("Dream already running");
    expect(readFileSync(join(config.WORKSPACE_DIR, "notes", "memory", ".dream.lock"), "utf8")).toContain("424242");
  } finally {
    process.kill = realKill;
  }
});

test("runDreamAgentTurn records recovery summaries when the model pass succeeds after recovery", async () => {
  const config = await import("../src/core/config.js");
  rmSync(join(config.WORKSPACE_DIR, "notes"), { recursive: true, force: true });
  rmSync(join(config.DATA_DIR, "dream-backups"), { recursive: true, force: true });
  rmSync(join(config.DATA_DIR, "workspace-search"), { recursive: true, force: true });

  const dream = await importFresh<typeof import("../src/dream.js")>("../src/dream.js");
  const result = await dream.runDreamAgentTurn({
    chatJid: "web:default",
    days: 2,
    mode: "auto",
    agentPool: {
      applyControlCommand: acceptModelChange,
      runAgent: async () => ({
        status: "success",
        result: "AutoDream complete.",
        recovery: {
          attemptsUsed: 1,
          totalElapsedMs: 1200,
          recovered: true,
          exhausted: false,
          lastClassifier: "context_pressure",
          strategyHistory: ["compact_then_retry"],
        },
      }),
      disposeChatSession: async () => {},
    } as any,
  });

  expect(result.skipped).toBe(false);
  expect(result.result).toContain("AutoDream complete.");
  expect(result.result).toContain("Automatic recovery succeeded after 1 attempt");
  expect(result.result).toContain("context_pressure");
});

test("scheduled Dream consumes deferred startup backfill state and clears it after successful consolidation", async () => {
  const config = await import("../src/core/config.js");
  rmSync(join(config.WORKSPACE_DIR, "notes"), { recursive: true, force: true });
  rmSync(join(config.DATA_DIR, "dream-backups"), { recursive: true, force: true });
  rmSync(join(config.DATA_DIR, "workspace-search"), { recursive: true, force: true });
  mkdirSync(join(config.WORKSPACE_DIR, "notes", "memory"), { recursive: true });
  writeFileSync(
    join(config.WORKSPACE_DIR, "notes", "memory", "current-state.md"),
    "# Current Dream state\n\nGenerated: 2026-01-02T03:04:05.000Z\n",
    "utf8",
  );

  const db = await importFresh<typeof import("../src/db.js")>("../src/db.js");
  db.initDatabase();
  const startupState = await importFresh<typeof import("../src/agent-memory/startup-state.js")>("../src/agent-memory/startup-state.js");
  startupState.writeDreamStartupMarker("backfill_required", config.WORKSPACE_DIR);
  const dream = await importFresh<typeof import("../src/dream.js")>("../src/dream.js");
  expect(dream.hasOutstandingDreamConsolidation(2)).toBe(true);

  let modelCalls = 0;
  const result = await dream.runDreamAgentTurn({
    chatJid: "web:default",
    days: 2,
    mode: "auto",
    agentPool: {
      applyControlCommand: acceptModelChange,
      runAgent: async () => {
        modelCalls += 1;
        return { status: "success", result: "Scheduled consolidation complete." };
      },
      disposeChatSession: async () => {},
    } as any,
  });

  expect(result.skipped).toBe(false);
  expect(modelCalls).toBe(1);
  expect(readFileSync(startupState.getDreamStartupMarkerPath(config.WORKSPACE_DIR), "utf8")).toContain("recovery: complete");
  expect(dream.hasOutstandingDreamConsolidation(2)).toBe(false);
});

test("runDreamAgentTurn falls back to deterministic refresh when the model pass errors", async () => {
  const config = await import("../src/core/config.js");
  rmSync(join(config.WORKSPACE_DIR, "notes"), { recursive: true, force: true });
  rmSync(join(config.DATA_DIR, "dream-backups"), { recursive: true, force: true });
  rmSync(join(config.DATA_DIR, "workspace-search"), { recursive: true, force: true });

  const dream = await importFresh<typeof import("../src/dream.js")>("../src/dream.js");
  let capturedTimeoutMs: number | undefined;
  const result = await dream.runDreamAgentTurn({
    chatJid: "web:default",
    days: 2,
    mode: "auto",
    agentPool: {
      applyControlCommand: acceptModelChange,
      runAgent: async (_prompt: string, _chatJid: string, options?: { timeoutMs?: number }) => {
        capturedTimeoutMs = options?.timeoutMs;
        return {
          status: "error",
          error: "Timed out after 3m",
          recovery: {
            attemptsUsed: 2,
            totalElapsedMs: 30000,
            recovered: false,
            exhausted: true,
            lastClassifier: "budget_exhausted",
            strategyHistory: ["retry", "compact_then_retry"],
          },
        };
      },
      disposeChatSession: async () => {},
    } as any,
  });

  expect(result.skipped).toBe(false);
  expect(result.result).toContain("model pass failed; deterministic refresh completed");
  expect(result.result).toContain("Timed out after 3m");
  expect(result.result).toContain("Memory refreshed after Dream: yes");
  expect(result.result).toContain("Automatic recovery exhausted after 2 attempt");
  expect(capturedTimeoutMs).toBeGreaterThan(0);
  expect(existsSync(join(config.WORKSPACE_DIR, "notes", "memory", "MEMORY.md"))).toBe(true);
  expect(existsSync(join(config.WORKSPACE_DIR, "notes", "memory", ".dream.lock"))).toBe(false);
});
