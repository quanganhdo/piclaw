import { describe, expect, test } from "bun:test";
import {
  bootstrapRuntime,
  createDefaultRuntimeBootstrapDeps,
  type RuntimeBootstrapAgentPool,
  type RuntimeBootstrapDeps,
  type RuntimeBootstrapPushover,
  type RuntimeBootstrapQueue,
  type RuntimeBootstrapState,
  type RuntimeBootstrapWeb,
  type RuntimeBootstrapDefaultBaseServices,
} from "../../src/runtime/bootstrap.js";
import type { RuntimeSenders } from "../../src/runtime/wiring.js";

function bootstrapDepsForFailure(overrides: Partial<RuntimeBootstrapDeps> = {}): RuntimeBootstrapDeps {
  const queue = { shutdown: async () => {} } as RuntimeBootstrapQueue;
  const agentPool = { shutdown: async () => {}, resolveModelInput: () => null } as RuntimeBootstrapAgentPool;
  const web = { stop: async () => {} } as RuntimeBootstrapWeb;
  return {
    base: { queue, state: {} as RuntimeBootstrapState },
    assistantName: "Pi",
    triggerPattern: /@pi/i,
    pollIntervalMs: 1,
    signalRegistrar: { on: () => {} },
    initializeRuntimeEnvironment: () => {},
    hydrateMcpCredentials: async () => [{ serverName: "mcp", envName: "PICLAW_MCP_SECRET", keychainName: "mcp/test" }],
    clearMcpCredentials: () => {},
    createAgentPool: async () => agentPool,
    startWebChannel: async () => web,
    startBackgroundModelRefresh: () => {},
    startOptionalPushoverChannel: async () => null,
    createShutdownHandler: () => async () => {},
    registerRuntimeShutdownSignals: () => {},
    createRuntimeSenders: () => ({ sendMessage: async () => {}, sendNudge: async () => {} }),
    startRuntimeWorkers: () => {},
    queueStartupResumePendingIpc: () => {},
    startRuntimeLoop: async () => {},
    log: () => {},
    stopIpcWatcher: async () => {},
    stopSchedulerLoop: () => {},
    stopOptionalProviders: () => {},
    ...overrides,
  };
}

describe("runtime bootstrap", () => {
  test("applies environment before AgentPool creation and starts refresh after channels", async () => {
    const events: string[] = [];

    const queue = { shutdown: async () => {} } as RuntimeBootstrapQueue;
    const agentPool = { shutdown: async () => {}, resolveModelInput: () => null } as RuntimeBootstrapAgentPool;
    const state = {} as RuntimeBootstrapState;

    const web = {
      stop: async () => {},
      sendMessage: async () => {},
      resumeChat: () => {},
      resumePendingChats: () => {},
    } as RuntimeBootstrapWeb;

    const pushover = {
      stop: async () => {},
      sendMessage: async () => {},
    } as RuntimeBootstrapPushover;
    const senders = {
      sendMessage: async () => {},
      sendNudge: async () => {},
    } as RuntimeSenders;

    let capturedShutdownDeps: { stopIpcWatcher: () => void; stopSchedulerLoop: () => void; stopOptionalProviders: () => void } | null = null;

    const deps: RuntimeBootstrapDeps = {
      base: { queue, state },
      assistantName: "Pi",
      triggerPattern: /@pi/i,
      pollIntervalMs: 123,
      signalRegistrar: { on: () => {} },
      initializeRuntimeEnvironment: () => events.push("init-runtime-env"),
      hydrateMcpCredentials: async () => {
        events.push("hydrate-mcp-credentials");
        return [];
      },
      clearMcpCredentials: () => events.push("clear-mcp-credentials"),
      createAgentPool: async () => {
        events.push("create-agent-pool");
        return agentPool;
      },
      startWebChannel: async () => {
        events.push("start-web");
        return web;
      },
      startBackgroundModelRefresh: (received) => {
        expect(received).toBe(agentPool);
        events.push("start-model-refresh");
      },
      startOptionalPushoverChannel: async () => {
        events.push("start-pushover");
        return pushover;
      },
      createShutdownHandler: (shutdownDeps) => {
        events.push("create-shutdown");
        capturedShutdownDeps = {
          stopIpcWatcher: shutdownDeps.stopIpcWatcher,
          stopSchedulerLoop: shutdownDeps.stopSchedulerLoop,
          stopOptionalProviders: shutdownDeps.stopOptionalProviders,
        };
        return async () => {};
      },
      registerRuntimeShutdownSignals: () => events.push("register-shutdown-signals"),
      createRuntimeSenders: () => {
        events.push("create-senders");
        return senders;
      },
      startRuntimeWorkers: (_queue, _agentPool, _web, runtimeSenders) => {
        events.push("start-workers");
        expect(runtimeSenders).toBe(senders);
      },
      queueStartupResumePendingIpc: () => events.push("queue-startup-resume"),
      startRuntimeLoop: async (loopDeps) => {
        events.push("start-runtime-loop");
        expect(loopDeps.agentPool).toBe(agentPool);
        expect(loopDeps.assistantName).toBe("Pi");
        expect(loopDeps.pollIntervalMs).toBe(123);
      },
      log: () => events.push("log-banner"),
      stopIpcWatcher: async () => {},
      stopSchedulerLoop: () => {},
      stopOptionalProviders: () => {},
    };

    await bootstrapRuntime(deps);

    expect(capturedShutdownDeps).not.toBeNull();
    expect(events).toEqual([
      "init-runtime-env",
      "hydrate-mcp-credentials",
      "create-agent-pool",
      "log-banner",
      "start-web",
      "start-pushover",
      "start-model-refresh",
      "create-shutdown",
      "register-shutdown-signals",
      "create-senders",
      "start-workers",
      "start-runtime-loop",
    ]);
  });

  test("family mode starts only the web runtime and waits without legacy workers", async () => {
    const events: string[] = [];
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const deps = bootstrapDepsForFailure({
      initializeRuntimeEnvironment: () => ({ effectiveMode: "family-shared" }),
      hydrateMcpCredentials: async () => { events.push("mcp"); return []; },
      createAgentPool: async () => { events.push("agent-pool"); return { shutdown: async () => {}, resolveModelInput: () => null } as RuntimeBootstrapAgentPool; },
      startWebChannel: async () => { events.push("web"); return { stop: async () => {} } as RuntimeBootstrapWeb; },
      startOptionalPushoverChannel: async () => { events.push("pushover"); return null; },
      startBackgroundModelRefresh: () => events.push("model-refresh"),
      startRuntimeWorkers: () => events.push("workers"),
      startRuntimeLoop: async () => { events.push("loop"); },
      waitForFamilyShutdown: () => wait,
    });
    const running = bootstrapRuntime(deps); await Bun.sleep(1);
    expect(events).toEqual(["agent-pool", "web"]);
    release(); await running;
  });

  test("clears hydrated MCP credentials when AgentPool creation fails", async () => {
    const cleared: string[][] = [];
    const deps = bootstrapDepsForFailure({
      createAgentPool: async () => { throw new Error("agent pool failed"); },
      clearMcpCredentials: (entries) => cleared.push(entries.map((entry) => entry.envName)),
    });

    await expect(bootstrapRuntime(deps)).rejects.toThrow("agent pool failed");
    expect(cleared).toEqual([["PICLAW_MCP_SECRET"]]);
  });

  test("clears hydrated MCP credentials when web startup fails", async () => {
    const cleared: string[][] = [];
    const deps = bootstrapDepsForFailure({
      startWebChannel: async () => { throw new Error("web failed"); },
      clearMcpCredentials: (entries) => cleared.push(entries.map((entry) => entry.envName)),
    });

    await expect(bootstrapRuntime(deps)).rejects.toThrow("web failed");
    expect(cleared).toEqual([["PICLAW_MCP_SECRET"]]);
  });

  test("background refresh is queued and not awaited by bootstrap", async () => {
    const queue = { shutdown: async () => {} } as RuntimeBootstrapQueue;
    const agentPool = { shutdown: async () => {}, resolveModelInput: () => null } as RuntimeBootstrapAgentPool;
    const state = {} as RuntimeBootstrapState;
    let refreshFinished = false;

    const deps = {
      base: { queue, state },
      assistantName: "Pi",
      triggerPattern: /@pi/i,
      pollIntervalMs: 1,
      signalRegistrar: { on: () => {} },
      initializeRuntimeEnvironment: () => {},
      hydrateMcpCredentials: async () => [],
      clearMcpCredentials: () => {},
      createAgentPool: async () => agentPool,
      startWebChannel: async () => ({ stop: async () => {} } as RuntimeBootstrapWeb),
      startBackgroundModelRefresh: () => {
        void Bun.sleep(100).then(() => { refreshFinished = true; });
      },
      startOptionalPushoverChannel: async () => null,
      createShutdownHandler: () => async () => {},
      registerRuntimeShutdownSignals: () => {},
      createRuntimeSenders: () => ({ sendMessage: async () => {}, sendNudge: async () => {} }),
      startRuntimeWorkers: () => {},
      queueStartupResumePendingIpc: () => {},
      startRuntimeLoop: async () => {},
      log: () => {},
      stopIpcWatcher: async () => {},
      stopSchedulerLoop: () => {},
      stopOptionalProviders: () => {},
    } as RuntimeBootstrapDeps;

    await bootstrapRuntime(deps);
    expect(refreshFinished).toBe(false);
  });

  test("createDefaultRuntimeBootstrapDeps preserves provided runtime base", () => {
    const base = {
      queue: {} as RuntimeBootstrapDefaultBaseServices["queue"],
      state: {} as RuntimeBootstrapDefaultBaseServices["state"],
    };

    const deps = createDefaultRuntimeBootstrapDeps(base);

    expect(deps.base).toBe(base);
    expect(deps.assistantName.length).toBeGreaterThan(0);
    expect(typeof deps.pollIntervalMs).toBe("number");
    expect(deps.triggerPattern).toBeInstanceOf(RegExp);
    expect(typeof deps.hydrateMcpCredentials).toBe("function");
    expect(typeof deps.clearMcpCredentials).toBe("function");
    expect(typeof deps.createAgentPool).toBe("function");
    expect(typeof deps.startRuntimeLoop).toBe("function");
  });
});
