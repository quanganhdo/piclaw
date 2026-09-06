import { expect, mock, spyOn } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const workspace = process.env.PICLAW_WORKSPACE!;
const data = process.env.PICLAW_DATA!;
const configPath = join(workspace, ".piclaw/config.json");
mkdirSync(join(workspace, ".piclaw"), { recursive: true });
type Mode = "single-user" | "family-shared" | "isolated-containers" | "invalid";
const denial = "Dream requires valid single-user configuration and context.";
function configure(mode: Mode) {
  writeFileSync(configPath, mode === "invalid" ? "{" : JSON.stringify({ domains: { access: {
    mode, ...(mode === "isolated-containers" ? { isolation: { component: "backend", backendId: "test", ownerUserId: "alice", gatewayUrl: "https://gateway.example", verificationKeyRef: "test-key" } } : {}),
  } } }));
}
configure("single-user");

let indexCalls = 0, duringIndex = () => {};
// Isolated child process: this mock cannot replace modules in other tests.
mock.module(new URL("../../src/workspace-search.js", import.meta.url).pathname, () => ({
  refreshWorkspaceIndex: async () => { indexCalls++; duringIndex(); return {}; },
  searchWorkspace: () => { throw Error("Unexpected workspace search"); },
  getWorkspaceIndexStatus: () => { throw Error("Unexpected workspace status"); },
  markWorkspaceIndexStale: () => { throw Error("Unexpected workspace mutation"); },
  requestBackgroundWorkspaceIndexRefresh: () => { throw Error("Unexpected background index"); },
  setBackgroundWorkspaceIndexRefreshRequesterForTests: () => { throw Error("Unexpected index configuration"); },
}));
const db = await import("../../src/db.js");
const dream = await import("../../src/dream.js");
const { initializeDreamWorkspaceAtStartup, startRuntimeWorkers } = await import("../../src/runtime/wiring.js");
const { createDreamAccessGuard } = await import("../../src/core/dream-access.js");
const { withExecutionIdentity } = await import("../../src/core/execution-context.js");
const { dreamMaintenance } = await import("../../src/extensions/dream-maintenance.js");

function reset() {
  configure("single-user"); db.closeDatabase(); db.initDatabase(); indexCalls = 0; duringIndex = () => {};
  for (const dir of [join(workspace, "notes"), join(data, "sessions"), join(data, "dream-backups"), join(data, "ipc")]) rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(workspace, "notes/memory"), { recursive: true });
  writeFileSync(join(workspace, "notes/memory/user-file.md"), "preserve shared note");
}
function files(root: string): unknown[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).filter((e) => e.name !== ".dream.lock").map((e) => [
    e.name, e.isDirectory() ? files(join(root, e.name)) : readFileSync(join(root, e.name)).toString("base64"),
  ]);
}
function snapshot() {
  const rows = ["chats", "messages", "chat_cursors", "chat_branches", "token_usage", "scheduled_tasks", "task_run_logs", "service_effect_s07_tasks"].map((name) => db.getDb().query(`SELECT * FROM ${name} ORDER BY rowid`).all());
  return JSON.stringify({ rows, notes: files(join(workspace, "notes")), sessions: files(join(data, "sessions")), backups: files(join(data, "dream-backups")), ipc: files(join(data, "ipc")) });
}
const lockPath = join(workspace, "notes/memory/.dream.lock");
function seedArtifact(jid = "dream:manual:retained:1") {
  db.getDb().query("INSERT OR REPLACE INTO chats(jid,name,last_message_time) VALUES (?, 'retained', ?)").run(jid, new Date().toISOString());
  const path = join(data, "sessions", jid.replace(/[^a-zA-Z0-9_-]/g, "_"));
  mkdirSync(path, { recursive: true }); writeFileSync(join(path, "session.json"), "retained session");
}
const identity = (mode: "family-shared" | "isolated-containers" | "single-user") => ({ mode, username: "alice", displayName: "Alice", role: "admin" as const, rootChatJid: "web:alice",
  provenance: { actorUserId: "alice", ownerUserId: "alice", chatJid: "web:alice", kind: "dream" as const },
});

export async function runScenario(scenario: string) {
  reset();
  try {
    if (scenario === "entry") {
      seedArtifact(); dream.ensureDreamTask();
      db.getDb().query("UPDATE scheduled_tasks SET status='paused',prompt='preserve' WHERE id=?").run(dream.DREAM_TASK_ID);
      writeFileSync(lockPath, "999999\n");
      const lock = readFileSync(lockPath, "utf8"), before = snapshot();
      const commands = new Map<string, any>();
      dreamMaintenance({ registerCommand: (name: string, value: any) => commands.set(name, value) } as any);
      const forbidden = new Proxy({}, { get: () => { throw Error("Unexpected option or dependency access"); } });
      for (const mode of ["family-shared", "isolated-containers", "invalid", "single-user"] as const) {
        configure(mode);
        for (const context of mode === "single-user" ? [identity("family-shared"), identity("isolated-containers")] : [null, identity(mode === "invalid" ? "family-shared" : mode)]) {
          await withExecutionIdentity(context, async () => {
            await expect(dream.runDreamAgentTurn(forbidden as any)).rejects.toThrow(denial);
            await expect(dream.runDreamMaintenance(forbidden)).rejects.toThrow(denial);
            expect(() => dream.ensureDreamTask()).toThrow(denial);
            expect(() => initializeDreamWorkspaceAtStartup(forbidden as any, forbidden as any)).toThrow(denial);
            expect(() => startRuntimeWorkers(forbidden as any, forbidden as any, forbidden as any, forbidden as any)).toThrow(denial);
            await expect(commands.get("dream").handler("7")).rejects.toThrow(denial);
          });
        }
      }
      expect(snapshot()).toBe(before); expect(readFileSync(lockPath, "utf8")).toBe(lock); expect(indexCalls).toBe(0);
      configure("single-user"); const check = createDreamAccessGuard(); configure("family-shared");
      expect(check).toThrow(denial); configure("single-user"); expect(check).toThrow(denial);
    } else if (scenario === "backup") {
      for (const runner of ["agent", "maintenance"]) for (const mode of ["family-shared", "invalid"] as const) {
        reset();
        const pending = runner === "agent" ? dream.runDreamAgentTurn({ chatJid: "web:test", agentPool: {} as any }) : dream.runDreamMaintenance();
        // Both have reached the asynchronous archive-library load, holding their own lock.
        expect(existsSync(lockPath)).toBe(true); const before = snapshot(); configure(mode);
        await expect(pending).rejects.toThrow(denial);
        expect(snapshot()).toBe(before); expect(existsSync(lockPath)).toBe(false); expect(indexCalls).toBe(0);
      }
    } else if (scenario === "agent-stages") {
      for (const stage of ["switch", "agent", "dispose"]) for (const reject of [false, true]) {
        reset(); const calls: string[] = []; let before = "";
        const transition = (at: string, jid: string) => {
          calls.push(at); if (at !== stage) return;
          seedArtifact(jid); before = snapshot(); configure("family-shared"); if (reject) throw Error("stage failed");
        };
        const pending = dream.runDreamAgentTurn({ chatJid: "web:test", model: "test/model", agentPool: {
          applyControlCommand: async (jid: string) => { transition("switch", jid); return { status: "error", message: "model unavailable" }; },
          runAgent: async (_prompt: string, jid: string) => { transition("agent", jid); return { status: "error", error: "model failed" }; },
          disposeChatSession: async (jid: string) => { transition("dispose", jid); },
        } as any, ...(stage === "switch" ? {} : { model: "" }) });
        // Empty explicit model uses default config, which is empty in this fixture.
        await expect(pending).rejects.toThrow(denial);
        expect(before).not.toBe(""); expect(snapshot()).toBe(before); expect(existsSync(lockPath)).toBe(false);
        expect(calls).toEqual(stage === "switch" ? ["switch"] : stage === "agent" ? ["agent"] : ["agent", "dispose"]);
      }
    } else if (scenario === "index") {
      for (const runner of ["agent", "maintenance", "model-error"]) for (const reject of [false, true]) {
        reset(); let before = ""; const calls: string[] = [];
        duringIndex = () => { seedArtifact(); before = snapshot(); configure("isolated-containers"); if (reject) throw Error("index failed"); };
        const pending = runner === "maintenance" ? dream.runDreamMaintenance() : dream.runDreamAgentTurn({ chatJid: "web:test", model: runner === "model-error" ? "test/model" : "", agentPool: {
          applyControlCommand: async () => { calls.push("switch"); return { status: "error", message: "model unavailable" }; },
          runAgent: async () => { calls.push("agent"); return { status: "success", result: "must not escape" }; },
          disposeChatSession: async () => { calls.push("dispose"); },
        } as any });
        await expect(pending).rejects.toThrow(denial);
        expect(snapshot()).toBe(before); expect(existsSync(lockPath)).toBe(false); expect(calls).not.toContain("dispose");
      }
    } else if (scenario === "startup-queue") {
      const queued: (() => Promise<void>)[] = [];
      const queue = { enqueueTask: (_id: string, run: () => Promise<void>) => queued.push(run) };
      initializeDreamWorkspaceAtStartup(queue as any, {} as any);
      expect(queued).toHaveLength(1); const before = snapshot(); configure("family-shared");
      await expect(queued[0]()).rejects.toThrow(denial); expect(snapshot()).toBe(before); expect(existsSync(lockPath)).toBe(false);
    } else if (scenario === "runtime-queue") {
      const ipc = await import("../../src/ipc.js"), scheduler = await import("../../src/task-scheduler.js");
      let handlers: any;
      const ipcSpy = spyOn(ipc, "startIpcWatcher").mockImplementation((deps: any) => { handlers = deps; });
      const schedulerSpy = spyOn(scheduler, "startSchedulerLoop").mockImplementation(() => () => {});
      try {
        const queued: (() => Promise<void>)[] = [], sent: string[] = [];
        const queue = { enqueueTask: (_id: string, run: () => Promise<void>) => queued.push(run) };
        const pool = { runAgent: async () => ({ status: "success", result: "private summary" }), disposeChatSession: async () => { configure("family-shared"); } };
        startRuntimeWorkers(queue as any, pool as any, {} as any, { sendMessage: async (_jid: string, text: string) => { sent.push(text); } });
        queued.length = 0;
        configure("family-shared"); const before = snapshot();
        await expect(handlers.runDream(new Proxy({}, { get: () => { throw Error("Unexpected request read"); } }))).rejects.toThrow(denial);
        expect(queued).toHaveLength(0); expect(snapshot()).toBe(before);
        configure("single-user"); await handlers.runDream({ chatJid: "web:test", mode: "manual", days: 2 });
        expect(queued).toHaveLength(1); await expect(queued[0]()).rejects.toThrow(denial);
        expect(sent).toEqual([]); expect(existsSync(lockPath)).toBe(false);
      } finally { ipcSpy.mockRestore(); schedulerSpy.mockRestore(); }
    } else if (scenario === "cleanup-lock") {
      let nestedResult: any;
      await dream.runDreamAgentTurn({ chatJid: "web:test", model: "", agentPool: {
        runAgent: async () => ({ status: "success", result: "complete" }),
        disposeChatSession: async () => {
          expect(existsSync(lockPath)).toBe(true);
          nestedResult = await dream.runDreamMaintenance();
        },
      } as any });
      expect(nestedResult.skipped).toBe(true); expect(nestedResult.skip_reason).toContain("Dream already running");
      expect(existsSync(lockPath)).toBe(false);
    } else throw Error(`Unknown scenario: ${scenario}`);
  } finally { db.closeDatabase(); }
  console.log(`DREAM_BOUNDARY_OK:${scenario}`);
}
