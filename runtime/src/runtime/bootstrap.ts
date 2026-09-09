/**
 * runtime/bootstrap.ts – Runtime bootstrap orchestration and default dependency wiring.
 */

import { AgentPool } from "../agent-pool.js";
import { createRuntimeModelServices } from "../agent-pool/model-services.js";
import { installRuntimeModelExecutor } from "../extensions/model-execution-runtime.js";
import { registerGitHubCopilotDynamicModels } from "../extensions/github-copilot-dynamic-models.js";
import {
  getIdentityConfig,
  getRoutingConfig,
  getRuntimeTimingConfig,
  WORKSPACE_DIR,
} from "../core/config.js";
import { stopIpcWatcher } from "../ipc.js";
import {
  clearHydratedMcpCredentials,
  hydrateMcpKeychainCredentials,
  type HydratedMcpCredential,
} from "../secure/mcp-keychain.js";
import type { SchedulerDeps } from "../task-scheduler.js";
import { stopSchedulerLoop } from "../task-scheduler.js";
import { createLogger } from "../utils/logger.js";
import type { RuntimeSignalRegistrar } from "./composition.js";
import { registerRuntimeShutdownSignals } from "./composition.js";
import { startRuntimeLoop, type StartRuntimeLoopDeps } from "./coordinator.js";
import { ModelRefreshCoordinator, type ModelRefreshResult } from "./model-refresh.js";
import { registerOptionalProviders, stopOptionalProviders } from "./provider-bootstrap.js";
import { createShutdownHandler, type ShutdownDeps } from "./shutdown.js";
import { registerShutdownHandler } from "./shutdown-registry.js";
import {
  initializeRuntimeEnvironment,
  queueStartupResumePendingIpc,
  startOptionalPushoverChannel,
  startWebChannel,
} from "./startup.js";
import {
  createRuntimeSenders,
  startRuntimeWorkers,
  type RuntimeModelResolver,
  type RuntimePushoverWorkerChannel,
  type RuntimeSenders,
  type RuntimeWebWorkerChannel,
} from "./wiring.js";

const log = createLogger("runtime.bootstrap");

export type RuntimeBootstrapQueue =
  & StartRuntimeLoopDeps["queue"]
  & SchedulerDeps["queue"]
  & ShutdownDeps["queue"];

export type RuntimeBootstrapAgentPool =
  & StartRuntimeLoopDeps["agentPool"]
  & SchedulerDeps["agentPool"]
  & RuntimeModelResolver
  & ShutdownDeps["agentPool"];

export type RuntimeBootstrapState = StartRuntimeLoopDeps["state"];
export type RuntimeBootstrapWeb = RuntimeWebWorkerChannel & ShutdownDeps["web"];
export type RuntimeBootstrapPushover = RuntimePushoverWorkerChannel & NonNullable<ShutdownDeps["pushover"]>;

export interface RuntimeBootstrapBaseServices {
  queue: RuntimeBootstrapQueue;
  state: RuntimeBootstrapState;
}

export interface RuntimeBootstrapDefaultBaseServices extends RuntimeBootstrapBaseServices {
  queue: Parameters<typeof startWebChannel>[0];
}

export interface RuntimeBootstrapDeps {
  base: RuntimeBootstrapBaseServices;
  assistantName: string;
  triggerPattern: RegExp;
  pollIntervalMs: number;
  signalRegistrar: RuntimeSignalRegistrar;
  initializeRuntimeEnvironment(state: RuntimeBootstrapState): { effectiveMode: "single-user" | "family-shared" } | void;
  hydrateMcpCredentials(): Promise<HydratedMcpCredential[]>;
  clearMcpCredentials(entries: HydratedMcpCredential[]): void;
  createAgentPool(): Promise<RuntimeBootstrapAgentPool>;
  startWebChannel(queue: RuntimeBootstrapQueue, agentPool: RuntimeBootstrapAgentPool): Promise<RuntimeBootstrapWeb>;
  startBackgroundModelRefresh(agentPool: RuntimeBootstrapAgentPool): void;
  startOptionalPushoverChannel(): Promise<RuntimeBootstrapPushover | null>;
  createShutdownHandler(deps: ShutdownDeps): (signal: string) => Promise<void>;
  registerRuntimeShutdownSignals(
    registrar: RuntimeSignalRegistrar,
    shutdown: (signal: string) => Promise<void>
  ): void;
  createRuntimeSenders(
    web: RuntimeBootstrapWeb,
    pushover: RuntimeBootstrapPushover | null
  ): RuntimeSenders;
  startRuntimeWorkers(
    queue: RuntimeBootstrapQueue,
    agentPool: RuntimeBootstrapAgentPool,
    web: RuntimeBootstrapWeb,
    senders: RuntimeSenders
  ): void;
  queueStartupResumePendingIpc(): void;
  startRuntimeLoop(deps: StartRuntimeLoopDeps): Promise<void>;
  waitForFamilyShutdown?(): Promise<void>;
  log(message: string): void;
  stopIpcWatcher(): Promise<void>;
  stopSchedulerLoop(): void;
  stopOptionalProviders(): void;
}

function logBackgroundRefreshResult(result: ModelRefreshResult): void {
  const errors = [...result.errors.entries()].map(([provider, error]) => ({ provider, error: error.message }));
  const details = {
    operation: "model_runtime.background_refresh",
    status: result.status,
    providerErrors: errors,
    error: result.error?.message,
  };
  if (result.status === "completed" && errors.length === 0) log.info("Background model catalogs refreshed", details);
  else log.warn("Background model catalog refresh completed with diagnostics", details);
}

/** Build default runtime bootstrap dependencies from production modules. */
export function createDefaultRuntimeBootstrapDeps(base: RuntimeBootstrapDefaultBaseServices): RuntimeBootstrapDeps {
  let refreshCoordinator: ModelRefreshCoordinator | null = null;
  return {
    base,
    assistantName: getIdentityConfig().assistantName,
    triggerPattern: getRoutingConfig().triggerPattern,
    pollIntervalMs: getRuntimeTimingConfig().pollIntervalMs,
    signalRegistrar: process,
    initializeRuntimeEnvironment: () => initializeRuntimeEnvironment(base.state),
    hydrateMcpCredentials: () => hydrateMcpKeychainCredentials(WORKSPACE_DIR),
    clearMcpCredentials: clearHydratedMcpCredentials,
    createAgentPool: async () => {
      const modelServices = await createRuntimeModelServices();
      installRuntimeModelExecutor(modelServices.modelRuntime);
      registerGitHubCopilotDynamicModels(modelServices.modelRuntime);
      const agentPool = new AgentPool({
        credentialStore: modelServices.credentialStore,
        modelRuntime: modelServices.modelRuntime,
        modelRegistry: modelServices.modelRegistry,
      });
      refreshCoordinator = new ModelRefreshCoordinator({
        modelRuntime: modelServices.modelRuntime,
        onComplete: logBackgroundRefreshResult,
      });
      return agentPool;
    },
    startWebChannel: (queue, agentPool) => startWebChannel(queue as Parameters<typeof startWebChannel>[0], agentPool as Parameters<typeof startWebChannel>[1]),
    startBackgroundModelRefresh: (agentPool) => {
      void (async () => {
        await registerOptionalProviders(agentPool);
        await refreshCoordinator?.queue();
      })().catch((error) => {
        log.warn("Background provider/model bootstrap failed", {
          operation: "model_runtime.background_bootstrap",
          error: error instanceof Error ? error.message : String(error),
        });
      });
    },
    startOptionalPushoverChannel: () => startOptionalPushoverChannel(),
    createShutdownHandler,
    registerRuntimeShutdownSignals,
    createRuntimeSenders,
    startRuntimeWorkers,
    queueStartupResumePendingIpc,
    startRuntimeLoop,
    waitForFamilyShutdown: () => new Promise<void>(() => {}),
    log: (message) => log.info(message, { operation: "bootstrap.banner" }),
    stopIpcWatcher,
    stopSchedulerLoop,
    stopOptionalProviders,
  };
}

/** Bootstrap and run all runtime subsystems in production order. */
export async function bootstrapRuntime(deps: RuntimeBootstrapDeps): Promise<void> {
  const { queue, state } = deps.base;

  const access = deps.initializeRuntimeEnvironment(state);
  const familyMode = access?.effectiveMode === "family-shared";
  const hydratedMcpCredentials = familyMode ? [] : await deps.hydrateMcpCredentials();
  try {
    const agentPool = await deps.createAgentPool();
    deps.log("=== Piclaw - Pi Coding Agent Assistant ===");

    const web = await deps.startWebChannel(queue, agentPool);
    const pushover = familyMode ? null : await deps.startOptionalPushoverChannel();
    if (!familyMode) deps.startBackgroundModelRefresh(agentPool);

    const baseShutdown = deps.createShutdownHandler({
      queue,
      agentPool,
      web,
      pushover,
      stopIpcWatcher: deps.stopIpcWatcher,
      stopSchedulerLoop: deps.stopSchedulerLoop,
      stopOptionalProviders: deps.stopOptionalProviders,
    });
    const shutdown = async (signal: string): Promise<void> => {
      try {
        await baseShutdown(signal);
      } finally {
        deps.clearMcpCredentials(hydratedMcpCredentials);
      }
    };
    registerShutdownHandler(shutdown);
    deps.registerRuntimeShutdownSignals(deps.signalRegistrar, shutdown);

    const senders = deps.createRuntimeSenders(web, pushover);
    if (familyMode) {
      await (deps.waitForFamilyShutdown?.() ?? new Promise<void>(() => {}));
      return;
    }
    deps.startRuntimeWorkers(queue, agentPool, web, senders);

    await deps.startRuntimeLoop({
      queue,
      state,
      agentPool,
      assistantName: deps.assistantName,
      triggerPattern: deps.triggerPattern,
      pollIntervalMs: deps.pollIntervalMs,
    });
  } catch (error) {
    deps.clearMcpCredentials(hydratedMcpCredentials);
    throw error;
  }
}
