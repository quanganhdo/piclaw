/**
 * test/agent-pool/agent-pool.test.ts – Tests for agent pool initialisation and session management.
 *
 * Verifies createAgentPool(), session creation, AGENTS.md loading,
 * config persistence, and workspace directory setup.
 */

import { expect, test, afterEach } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getAttachmentRegistry } from "../../src/agent-pool/attachments.js";
import { createTempWorkspace, getTestWorkspace, importFresh, setEnv } from "../helpers.js";
import { createLegacyCapturePoolOptions,createAgentPoolModelOptions } from "../model-services-fixture.js";

let restoreEnv: (() => void) | null = null;

function findAgentLogFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return findAgentLogFiles(path);
    if (entry.isFile() && entry.name.startsWith("agent-") && entry.name.endsWith(".log")) return [path];
    return [];
  });
}

function createRuntime(session: any, overrides: Partial<AgentSessionRuntime> = {}): AgentSessionRuntime {
  return {
    session,
    cwd: "/workspace",
    diagnostics: [],
    services: {} as any,
    modelFallbackMessage: undefined,
    newSession: async (options?: any) => ({
      cancelled: typeof session.newSession === "function" ? !(await session.newSession(options)) : false,
    }),
    switchSession: async (path: string) => ({
      cancelled: typeof session.switchSession === "function" ? !(await session.switchSession(path)) : false,
    }),
    fork: async (entryId: string) => (
      typeof session.fork === "function"
        ? await session.fork(entryId)
        : { cancelled: false }
    ),
    importFromJsonl: async () => ({ cancelled: false }),
    dispose: async () => {
      session.dispose?.();
    },
    ...overrides,
  } as any;
}

afterEach(async () => {
  restoreEnv?.();
  restoreEnv = null;
  try {
    const sshCore = await import("../../src/extensions/ssh-core.js");
    sshCore.setSshConnectionResolverForTests(null);
    await sshCore.unregisterLiveChatSshSession("web:default");
  } catch (_error) {
    void _error;
  }
});

test("agent pool exposes the shared model registry and active scoped models to standalone add-ons", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const { AgentPool } = await importFresh<typeof import("../src/agent-pool.js")>("../src/agent-pool.js");
  const model = { provider: "free", id: "zero", cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const options = createLegacyCapturePoolOptions([model]);
  const physicalStream = { marker: "physical-stream" };
  (options.modelRuntime as any).streamSimple = (streamModel: unknown, context: unknown, streamOptions: unknown) => {
    expect(streamModel).toBe(model);
    expect(context).toEqual({ messages: [] });
    expect(streamOptions).toEqual({ maxTokens: 123 });
    return physicalStream;
  };
  const session = {
    sessionId: "session-cheapskate",
    scopedModels: [{ model, thinkingLevel: "low" }],
    subscribe: () => () => {},
    prompt: async () => {},
    abort: async () => {},
    dispose() {},
  };
  const pool = new AgentPool({
    ...options,
    createSession: async () => { throw new Error("unused"); },
  });
  (pool as any).pool.set("web:cheapskate", { runtime: createRuntime(session), lastUsed: Date.now() });

  const interop = (globalThis as any).__piclawRuntimeInterop;
  expect(interop.getModelRegistry()).toBe((pool as any).modelRegistry);
  expect(interop.hasKnownModelCost("free", "zero")).toBe(true);
  expect(interop.streamSimple(model, { messages: [] }, { maxTokens: 123 })).toBe(physicalStream);
  expect(interop.getSessionId("web:cheapskate")).toBe("session-cheapskate");
  expect(interop.getSessionId("web:missing")).toBeNull();
  expect(interop.getScopedModels("web:cheapskate")).toEqual(session.scopedModels);
  expect(interop.getScopedModels("web:missing")).toEqual([]);

  await pool.shutdown();
});

test("model-cost provenance requires explicit cost metadata on models.json definitions", async () => {
  const ws = createTempWorkspace("piclaw-model-cost-provenance-");
  const agentDir = join(ws.workspace, ".pi", "agent");
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, "models.json"), `{
    // comments and trailing commas are valid in models.json
    "providers": {
      "custom": {
        "models": [
          { "id": "unknown" },
          { "id": "free", "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }, },
          { "id": "paid", "cost": { "input": 1, "output": 0, "cacheRead": 0, "cacheWrite": 0 } }
        ]
      }
    }
  }`);
  const { createKnownModelCostResolver } = await importFresh<typeof import("../src/agent-pool.js")>("../src/agent-pool.js");
  const known = createKnownModelCostResolver(agentDir);
  expect(known("custom", "unknown")).toBe(false);
  expect(known("custom", "free")).toBe(true);
  expect(known("custom", "paid")).toBe(true);
  expect(known("builtin", "catalogued")).toBe(true);

  writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: { custom: { models: [{ id: "unknown", cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
  expect(known("custom", "unknown")).toBe(true);
  writeFileSync(join(agentDir, "models.json"), "{ invalid");
  expect(known("custom", "unknown")).toBe(false);
  expect(known("builtin", "catalogued")).toBe(false);
  ws.cleanup();
});

test("agent pool aggregates content-free session resource counts", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const { AgentPool } = await importFresh<typeof import("../src/agent-pool.js")>("../src/agent-pool.js");
  const pool = new AgentPool({
    ...createLegacyCapturePoolOptions(),
    createSession: async () => { throw new Error("unused"); },
  });
  const sessionFile = join(ws.data, "instrumentation-session.jsonl");
  writeFileSync(sessionFile, "1234567890");
  const makeSession = (entries: number, messages: number, skills: number, extensions: number, tools: number) => ({
    sessionFile,
    sessionManager: { getEntries: () => Array.from({ length: entries }, () => ({})) },
    state: { messages: Array.from({ length: messages }, () => ({})) },
    resourceLoader: {
      getSkills: () => ({ skills: Array.from({ length: skills }, () => ({})) }),
      getExtensions: () => ({ extensions: Array.from({ length: extensions }, () => ({})) }),
    },
    extensionRunner: { getAllRegisteredTools: () => Array.from({ length: tools }, () => ({})) },
  });
  (pool as any).pool.set("web:memory-instrumentation-main", { runtime: createRuntime(makeSession(2, 3, 4, 5, 6)), lastUsed: Date.now() });
  // This unit test targets only resident resource aggregation; avoid registering
  // synthetic chat IDs through the branch-manager activity query.
  (pool as any).branchManager.listActiveChats = () => [];

  expect(pool.getMemoryInstrumentationSnapshot().sessionResources).toEqual({
    sessionEntries: 2,
    activeMessages: 3,
    persistedSessionBytes: 10,
    loadedSkills: 4,
    loadedExtensions: 5,
    registeredTools: 6,
  });

  await pool.shutdown();
});

test("agent pool stores SSH config for future sessions when no live SSH session exists", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const { initDatabase, getSshConfig, storeChatMetadata } = await importFresh<typeof import("../src/db.js")>("../src/db.js");
  initDatabase();
  storeChatMetadata("web:other", "2026-10-23T00:00:00.000Z", "SSH target fixture");
  const { AgentPool } = await importFresh<typeof import("../src/agent-pool.js")>("../src/agent-pool.js");

  let pool: any;
  let createCalls = 0;
  let disposed = 0;

  class StubSession {
    private listeners: Array<(event: any) => void> = [];
    isStreaming = false;
    isBashRunning = false;
    isCompacting = false;
    subscribe(listener: (event: any) => void) {
      this.listeners.push(listener);
      return () => {};
    }
    async prompt() { throw Error("No legacy prompt"); }
    async abort() {}
    dispose() {
      disposed += 1;
    }
  }

  pool = new AgentPool({
    ...createLegacyCapturePoolOptions(),
    createSession: async () => {
      createCalls += 1;
      return createRuntime(new StubSession()) as any;
    },
  });

  await pool.getSessionForIntrospection("web:default");
  const result = await pool.setSshConfig("web:other", { ssh_target: "agent@example.com:/srv/project", ssh_port: 22, private_key_keychain: "ssh-prod", known_hosts_keychain: null, strict_host_key_checking: "yes" });
  expect(result.apply_timing).toBe("next_session");
  expect(getSshConfig("web:other")?.ssh_target).toBe("agent@example.com:/srv/project");
  expect(disposed).toBe(0);
  expect((pool as any).pool.has("web:default")).toBe(true);

  await pool.getSessionForIntrospection("web:default");
  expect(createCalls).toBe(1);

  await pool.shutdown();
});

test("agent pool evicts idle sessions and recreates them", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({
    PICLAW_WORKSPACE: ws.workspace,
    PICLAW_STORE: ws.store,
    PICLAW_DATA: ws.data,
    PICLAW_TURN_AUTO_RECOVERY_ENABLED: "0",
  });

  const { AgentPool } = await importFresh<typeof import("../src/agent-pool.js")>("../src/agent-pool.js");

  let createCalls = 0;
  let disposed = 0;

  class StubSession {
    subscribe(_listener: (event: any) => void) {
      return () => {};
    }
    async prompt(_prompt: string) {}
    async abort() {}
    dispose() {
      disposed += 1;
    }
  }

  const pool = new AgentPool({
    ...createLegacyCapturePoolOptions(),
    createSession: async () => {
      createCalls += 1;
      return createRuntime(new StubSession()) as any;
    },
  });

  await pool.getSessionForIntrospection("web:default");
  expect(createCalls).toBe(1);

  const entry = (pool as any).pool.get("web:default");
  entry.lastUsed = Date.now() - 16 * 60 * 1000;
  (pool as any).evictIdle();

  await Bun.sleep(0); // Disposal is registered before its callback executes.
  expect(disposed).toBe(1);
  expect((pool as any).pool.has("web:default")).toBe(false);

  await pool.getSessionForIntrospection("web:default");
  expect(createCalls).toBe(2);

  await pool.shutdown();
});

test("agent pool cleanup timer applies the shorter memory-pressure idle TTL", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({
    PICLAW_WORKSPACE: ws.workspace,
    PICLAW_STORE: ws.store,
    PICLAW_DATA: ws.data,
    PICLAW_MAIN_SESSION_PRESSURE_RSS_BYTES: "1",
    PICLAW_MAIN_SESSION_PRESSURE_IDLE_TTL_MS: "1",
    PICLAW_MAIN_SESSION_PRESSURE_POOL_MAX_SIZE: "2",
  });

  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  let cleanupCallback: (() => void) | null = null;

  (globalThis as any).setInterval = ((handler: TimerHandler) => {
    cleanupCallback = handler as () => void;
    return 1 as any;
  }) as typeof setInterval;
  (globalThis as any).clearInterval = (() => {}) as typeof clearInterval;

  try {
    const { AgentPool } = await importFresh<typeof import("../src/agent-pool.js")>("../src/agent-pool.js");

    let disposed = 0;
    class StubSession {
      subscribe(_listener: (event: any) => void) {
        return () => {};
      }
      async prompt(_prompt: string) {}
      async abort() {}
      dispose() {
        disposed += 1;
      }
    }

    const pool = new AgentPool({
    ...createLegacyCapturePoolOptions(),
      createSession: async () => createRuntime(new StubSession()) as any,
    });

    expect(cleanupCallback).not.toBeNull();

    (pool as any).pool.set("web:one", { runtime: createRuntime(new StubSession()) as any, lastUsed: Date.now() - 10 });
    (pool as any).pool.set("web:two", { runtime: createRuntime(new StubSession()) as any, lastUsed: Date.now() });

    cleanupCallback?.();
    await Bun.sleep(0);

    expect((pool as any).pool.has("web:one")).toBe(false);
    expect((pool as any).pool.has("web:two")).toBe(true);
    expect(pool.getMemoryInstrumentationSnapshot().cachedMainSessions).toBe(1);
    expect(disposed).toBe(1);

    await pool.shutdown();
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

test("agent pool coalesces forced GC and defers it until protected work is idle", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data, PICLAW_MAIN_SESSION_PRESSURE_RSS_BYTES: "1" });
  const { AgentPool } = await importFresh<typeof import("../src/agent-pool.js")>("../src/agent-pool.js");
  const pool = new AgentPool({ ...createLegacyCapturePoolOptions(), createSession: async () => { throw Error("unused"); } });
  const originalGc = Bun.gc;
  let collections = 0;
  Bun.gc = (() => { collections++; return 0; }) as typeof Bun.gc;
  const release = (pool as any).sessionManager.acquireEvictionProtection("web:busy");
  try {
    (pool as any).evictIdle();
    expect(collections).toBe(0);
    release();
    (pool as any).evictIdle();
    expect(collections).toBe(1);
    (pool as any).evictIdle();
    (pool as any).evictIdle();
    expect(collections).toBe(1);
  } finally { Bun.gc = originalGc; release(); await pool.shutdown(); }
});

test("agent pool applies the pressure pool cap immediately after acquiring a second session", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({
    PICLAW_WORKSPACE: ws.workspace,
    PICLAW_STORE: ws.store,
    PICLAW_DATA: ws.data,
    PICLAW_MAIN_SESSION_PRESSURE_RSS_BYTES: "1",
    PICLAW_MAIN_SESSION_PRESSURE_POOL_MAX_SIZE: "1",
    PICLAW_TURN_AUTO_RECOVERY_ENABLED: "0",
  });

  const { AgentPool } = await importFresh<typeof import("../src/agent-pool.js")>("../src/agent-pool.js");

  let disposed = 0;
  class StubSession {
    subscribe(_listener: (event: any) => void) {
      return () => {};
    }
    async prompt(_prompt: string) {}
    async abort() {}
    dispose() {
      disposed += 1;
    }
  }

  const pool = new AgentPool({
    ...createLegacyCapturePoolOptions(),
    createSession: async () => createRuntime(new StubSession()) as any,
  });

  await pool.getSessionForIntrospection("web:one");
  expect((pool as any).pool.has("web:one")).toBe(true);

  await pool.getSessionForIntrospection("web:two");

  expect((pool as any).pool.has("web:one")).toBe(false);
  expect((pool as any).pool.has("web:two")).toBe(true);
  expect(pool.getMemoryInstrumentationSnapshot().cachedMainSessions).toBe(1);
  expect(disposed).toBe(1);

  await pool.shutdown();
});

test("agent pool enables the default pressure trim path at the 512MB threshold", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({
    PICLAW_WORKSPACE: ws.workspace,
    PICLAW_STORE: ws.store,
    PICLAW_DATA: ws.data,
    PICLAW_MAIN_SESSION_PRESSURE_RSS_BYTES: undefined,
    PICLAW_MAIN_SESSION_PRESSURE_POOL_MAX_SIZE: undefined,
    PICLAW_MAIN_SESSION_POOL_MAX_SIZE: undefined,
    PICLAW_SESSION_POOL_MAX_SIZE: undefined,
  });

  const originalMemoryUsageRss = process.memoryUsage.rss;
  (process.memoryUsage as typeof process.memoryUsage & { rss: () => number }).rss = () => 520 * 1024 * 1024;

  try {
    const { AgentPool } = await importFresh<typeof import("../src/agent-pool.js")>("../src/agent-pool.js");

    let disposed = 0;
    class StubSession {
      subscribe(_listener: (event: any) => void) {
        return () => {};
      }
      async prompt(_prompt: string) {}
      async abort() {}
      dispose() {
        disposed += 1;
      }
    }

    const pool = new AgentPool({
    ...createLegacyCapturePoolOptions(),
      createSession: async () => createRuntime(new StubSession()) as any,
    });

    (pool as any).pool.set("web:one", { runtime: createRuntime(new StubSession()) as any, lastUsed: Date.now() - 5_000 });
    (pool as any).pool.set("web:two", { runtime: createRuntime(new StubSession()) as any, lastUsed: Date.now() });

    (pool as any).evictIdle();
    await Bun.sleep(0);

    expect((pool as any).pool.has("web:one")).toBe(false);
    expect((pool as any).pool.has("web:two")).toBe(true);
    expect(pool.getMemoryInstrumentationSnapshot().cachedMainSessions).toBe(1);
    expect(disposed).toBe(1);

    await pool.shutdown();
  } finally {
    (process.memoryUsage as typeof process.memoryUsage & { rss: typeof originalMemoryUsageRss }).rss = originalMemoryUsageRss;
  }
});

test("agent pool trims cached main sessions more aggressively when RSS crosses the pressure threshold", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({
    PICLAW_WORKSPACE: ws.workspace,
    PICLAW_STORE: ws.store,
    PICLAW_DATA: ws.data,
    PICLAW_MAIN_SESSION_PRESSURE_RSS_BYTES: "1",
    PICLAW_MAIN_SESSION_PRESSURE_POOL_MAX_SIZE: "1",
  });

  const { AgentPool } = await importFresh<typeof import("../src/agent-pool.js")>("../src/agent-pool.js");

  let disposed = 0;
  class StubSession {
    subscribe(_listener: (event: any) => void) {
      return () => {};
    }
    async prompt(_prompt: string) {}
    async abort() {}
    dispose() {
      disposed += 1;
    }
  }

  const pool = new AgentPool({
    ...createLegacyCapturePoolOptions(),
    createSession: async () => createRuntime(new StubSession()) as any,
  });

  (pool as any).pool.set("web:one", { runtime: createRuntime(new StubSession()) as any, lastUsed: Date.now() - 5_000 });
  (pool as any).pool.set("web:two", { runtime: createRuntime(new StubSession()) as any, lastUsed: Date.now() });

  (pool as any).evictIdle();
  await Bun.sleep(0);

  expect((pool as any).pool.has("web:one")).toBe(false);
  expect((pool as any).pool.has("web:two")).toBe(true);
  expect(pool.getMemoryInstrumentationSnapshot().cachedMainSessions).toBe(1);
  expect(disposed).toBe(1);

  await pool.shutdown();
});

test("agent pool forwards native side options without hydrating legacy sessions", async () => {
  const ws = createTempWorkspace("native-side-pool-");
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });
  const { AgentPool } = await importFresh<typeof import("../src/agent-pool.js")>("../src/agent-pool.js");
  const cleanup = ws.cleanup;
  try {
    const result = { status: "success" as const, result: "answer", thinking: "plan", model: "openai/gpt-test" };
    const options = { systemPrompt: "instructions", budgetWorkId: "retry", signal: new AbortController().signal };
    let calls = 0;
    const config = { ...createAgentPoolModelOptions(),
      createSession: async () => { throw Error("Legacy hydration forbidden"); },
      dispatchSidePrompt: async function(chat: string, prompt: string, received: unknown) {
        expect(this).toBe(config); expect(chat).toBe("web:default"); expect(prompt).toBe("question"); expect(received).toBe(options);
        calls++; return result;
      } };
    const pool = new AgentPool(config);
    config.dispatchSidePrompt = async () => { throw Error("Replacement must not run"); };
    expect(await pool.runSidePrompt("web:default", "question", options)).toBe(result);
    expect(calls).toBe(1); await pool.shutdown();
  } finally { cleanup(); }
});

test("agent pool sanitises native side dispatcher failures", async () => {
  const ws = createTempWorkspace("native-side-error-");
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });
  const { AgentPool } = await importFresh<typeof import("../src/agent-pool.js")>("../src/agent-pool.js");
  const cleanup = ws.cleanup;
  try {
    const pool = new AgentPool({ ...createAgentPoolModelOptions(),
      createSession: async () => { throw Error("Legacy hydration forbidden"); },
      dispatchSidePrompt: async () => { throw Error("private credential sentinel"); } });
    expect(await pool.runSidePrompt("web:default", "question")).toEqual({ status: "error", result: null, thinking: null, model: null, error: "Native side prompt unavailable or failed" });
    await pool.shutdown();
  } finally { cleanup(); }
});

test("agent pool refuses to prune an active branch session", async () => {
  const ws = createTempWorkspace("piclaw-active-prune-");
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await importFresh<typeof import("../src/db.js")>("../src/db.js");
  db.initDatabase();
  db.storeChatMetadata("web:default", new Date().toISOString(), "Default");
  const root = db.getChatBranchByChatJid("web:default");
  db.storeChatMetadata("web:default:branch:active", new Date().toISOString(), "Research");
  db.ensureChatBranch({
    chat_jid: "web:default:branch:active",
    root_chat_jid: "web:default",
    parent_branch_id: root?.branch_id ?? null,
    agent_name: "research",
  });

  const { AgentPool } = await importFresh<typeof import("../src/agent-pool.js")>("../src/agent-pool.js");

  class ActiveBranchSession {
    sessionName = "Research";
    sessionId = "branch-session";
    isStreaming = true;
    isCompacting = false;
    isRetrying = false;
    isBashRunning = false;
    subscribe(_listener: (event: any) => void) { return () => {}; }
    async prompt(_prompt: string) {}
    async abort() {}
    dispose() {}
  }

  const pool = new AgentPool({
    ...createLegacyCapturePoolOptions(),
    createSession: async () => createRuntime(new ActiveBranchSession()) as any,
  });

  await (pool as any).getOrCreate("web:default:branch:active");

  await expect((pool as any).pruneChatBranch("web:default:branch:active")).rejects.toThrow(
    "Cannot prune a branch while it is active."
  );
  expect(db.getChatBranchByChatJid("web:default:branch:active")?.archived_at).toBeNull();

  await pool.shutdown();
  ws.cleanup();
});

test("agent pool missing native side dispatcher fails closed without legacy hydration", async () => {
  const ws = createTempWorkspace("native-side-unavailable-");
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });
  const { AgentPool } = await importFresh<typeof import("../src/agent-pool.js")>("../src/agent-pool.js");
  const cleanup = ws.cleanup;
  try {
    let legacyCalls = 0;
    const pool = new AgentPool({ ...createAgentPoolModelOptions(),
      createSession: async () => { legacyCalls++; throw Error("Legacy hydration forbidden"); } });
    expect(await pool.runSidePrompt("web:default", "question")).toEqual({ status: "error", result: null, thinking: null, model: null, error: "Durable side prompt dispatcher unavailable" });
    expect(legacyCalls).toBe(0); await pool.shutdown();
  } finally { cleanup(); }
});
