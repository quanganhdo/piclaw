import type { CredentialStore, Models } from "@earendil-works/pi-ai";
import type {
  AgentHarness,
  AgentHarnessResources,
  AgentHarnessTool,
  AgentHarnessToolInvocation,
  AgentLane,
  Closed,
  Events,
  ExecutionEnv,
  Hooks,
  InMemoryTelemetryContext,
  LaneSnapshot,
  PromptTemplate,
  Resources,
  Result,
  Session,
  SessionSnapshot,
  SessionReader,
  Skill,
  TelemetryContext,
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-agent-core";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Context } from "@earendil-works/pi-agent-core/harness/context";

import type { FileCredentialStore } from "../../agent-pool/credential-store.js";
import type { PiclawToolContext } from "../contracts/execution-context-resolver.js";
import type { PiclawExecutionEnv } from "../current-piclaw/execution-env-adapter.js";

type Assignable<Expected, Actual extends Expected> = [Actual] extends [Expected] ? true : never;

export type EarendilDirectAssignments = Readonly<{
  models: Assignable<Models, ModelRuntime>;
  credentials: Assignable<CredentialStore, FileCredentialStore>;
  executionEnvironment: Assignable<ExecutionEnv, PiclawExecutionEnv>;
  contextualTool: Assignable<AgentHarnessTool<PiclawToolContext>, AgentHarnessTool<PiclawToolContext>>;
  sixArgumentExecution: Assignable<
    [string, unknown, unknown, PiclawToolContext, AgentHarnessToolInvocation, Context],
    Parameters<AgentHarnessTool<PiclawToolContext>["execute"]>
  >;
  readTool: Assignable<AgentHarnessTool<PiclawToolContext>, ReturnType<typeof createReadTool<PiclawToolContext>>>;
  writeTool: Assignable<AgentHarnessTool<PiclawToolContext>, ReturnType<typeof createWriteTool<PiclawToolContext>>>;
  editTool: Assignable<AgentHarnessTool<PiclawToolContext>, ReturnType<typeof createEditTool<PiclawToolContext>>>;
  bashTool: Assignable<AgentHarnessTool<PiclawToolContext>, ReturnType<typeof createBashTool<PiclawToolContext>>>;
  resources: Assignable<AgentHarnessResources<Skill, PromptTemplate>, Resources>;
  harnessLane: Assignable<Promise<AgentLane>, ReturnType<AgentHarness["lane"]>>;
  sessionReader: Assignable<SessionReader, Session>;
  laneSnapshot: Assignable<LaneSnapshot, LaneSnapshot>;
  sessionSnapshot: Assignable<SessionSnapshot, SessionSnapshot>;
  hooks: Assignable<Hooks, Hooks>;
  events: Assignable<Events, Events>;
  telemetry: Assignable<TelemetryContext, InMemoryTelemetryContext>;
  resultAndError: Assignable<Result<void, Closed>, Result<void, Closed>>;
}>;
