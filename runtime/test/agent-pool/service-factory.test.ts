import { expect, test } from "bun:test";

import { ModelRegistry, ModelRuntime, SettingsManager, type AgentSessionRuntime } from "@earendil-works/pi-coding-agent";

import { createAgentPoolServices } from "../../src/agent-pool/service-factory.js";
import { createTempWorkspace, waitFor } from "../helpers.js";
import { FileCredentialStore } from '../../src/agent-pool/credential-store.js';

async function createFactoryModelServices(agentDir: string) {
  const credentialStore = new FileCredentialStore(`${agentDir}/auth.json`);
  // These tests exercise collaborator wiring and attachment isolation, not
  // provider catalogue/auth discovery (covered by model-runtime fixtures).
  const modelRuntime = await ModelRuntime.create({ credentials: credentialStore, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  return { credentialStore, modelRuntime, modelRegistry: new ModelRegistry(modelRuntime) };
}

function createServicesOptions(modelServices: Awaited<ReturnType<typeof createFactoryModelServices>>, workspaceDir: string) {
  return {
    authStorage: modelServices.credentialStore,
    modelRuntime: modelServices.modelRuntime,
    modelRegistry: modelServices.modelRegistry,
    settingsManager: SettingsManager.inMemory(),
    workspaceDir,
  };
}

test("createAgentPoolServices wires the extracted helper services together", async () => {
  const workspace = createTempWorkspace("service-factory-");
  try {
    const modelServices = await createFactoryModelServices(workspace.base);
    const services = createAgentPoolServices({
      pool: new Map(),
      sidePool: new Map(),
      activeForkBaseLeafByChat: new Map(),
      ...createServicesOptions(modelServices, workspace.workspace),
    });

    expect(services.attachments).toBeDefined();
    expect(services.sessionBinder).toBeDefined();
    expect(services.toolFactory).toBeDefined();
    expect(services.turnCoordinator).toBeDefined();
    expect(services.sessionManager).toBeDefined();
    expect(services.runtimeFacade).toBeDefined();
    expect(services.branchManager).toBeDefined();
    expect(services.runtimeFacade.isStreaming("web:default")).toBe(false);
  } finally {
    workspace.cleanup();
  }
});

test("createAgentPoolServices scopes attachment registries per pool", async () => {
  const workspace = createTempWorkspace("service-factory-scope-");
  try {
    const modelServices = await createFactoryModelServices(workspace.base);
    const options = createServicesOptions(modelServices, workspace.workspace);
    const first = createAgentPoolServices({
      pool: new Map(), sidePool: new Map(), activeForkBaseLeafByChat: new Map(), ...options,
    });
    const second = createAgentPoolServices({
      pool: new Map(), sidePool: new Map(), activeForkBaseLeafByChat: new Map(), ...options,
    });

    first.attachments.register("web:default", {
      id: 1,
      name: "report.txt",
      contentType: "text/plain",
      size: 6,
      kind: "file",
      sourcePath: "/tmp/report.txt",
    });

    expect(first.attachments.take("web:default")).toHaveLength(1);
    expect(second.attachments.take("web:default")).toHaveLength(0);
  } finally {
    workspace.cleanup();
  }
});

for (const fails of [false, true]) {
  test(`service factory wires command eviction protection through ${fails ? "failure" : "completion"}`, async () => {
    const workspace = createTempWorkspace("service-factory-command-protection-");
    const modelServices = await createFactoryModelServices(workspace.base);
    const pool = new Map<string, { runtime: AgentSessionRuntime; lastUsed: number }>();
    const services = createAgentPoolServices({
      pool, sidePool: new Map(), activeForkBaseLeafByChat: new Map(),
      mainSessionMaxSize: 1,
      ...createServicesOptions(modelServices, workspace.workspace),
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    let disposed = 0;
    const runtime = {
      session: { sessionId: "factory-command", isStreaming: false, isBashRunning: false, isCompacting: false },
      newSession: async () => {
        entered();
        await held;
        if (fails) throw new Error("factory command failed");
        return { cancelled: false };
      },
      dispose: async () => { disposed += 1; },
    } as unknown as AgentSessionRuntime;
    pool.set("web:factory-held", { runtime, lastUsed: Date.now() });
    const pending = services.runtimeFacade.applyControlCommand("web:factory-held", { type: "new_session", raw: "/new-session" });
    const settled = pending.then(result => ({ result, error: null }), error => ({ result: null, error }));
    try {
      await started;
      expect(services.sessionManager.hasProtectedRun("web:factory-held")).toBe(true);
      pool.get("web:factory-held")!.lastUsed = Date.now() - 20_000;
      // First force pool-cap eviction without TTL expiry, then force TTL.
      pool.set("web:factory-other", {
        runtime: { session: { isStreaming: false }, dispose: async () => {} } as unknown as AgentSessionRuntime,
        lastUsed: Date.now() - 10_000,
      });
      services.sessionManager.evictIdle({ mainIdleTtlMs: 60_000, sideIdleTtlMs: 60_000 });
      expect(pool.get("web:factory-held")?.runtime).toBe(runtime);
      expect(pool.has("web:factory-other")).toBe(false);
      services.sessionManager.evictIdle({ mainIdleTtlMs: 1, sideIdleTtlMs: 1 });
      expect(pool.get("web:factory-held")?.runtime).toBe(runtime);
      expect(disposed).toBe(0);
      release();
      const outcome = await settled;
      if (fails) expect(outcome.error?.message).toBe("factory command failed");
      else expect(outcome.result?.status).toBe("success");
      expect(services.sessionManager.hasProtectedRun("web:factory-held")).toBe(false);
      services.sessionManager.evictIdle({ mainIdleTtlMs: 1, sideIdleTtlMs: 1 });
      expect(pool.has("web:factory-held")).toBe(false);
      await waitFor(() => disposed === 1);
    } finally {
      release();
      await settled;
      await services.sessionManager.shutdown();
      workspace.cleanup();
    }
  });
}
