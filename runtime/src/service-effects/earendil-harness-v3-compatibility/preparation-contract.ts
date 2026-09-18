import type {
  AgentHarness,
  AgentHarnessTool,
  AgentHarnessToolInvocation,
  AgentHarnessToolUpdateCallback,
  AgentToolResult,
  ExecutionEnv,
  ExecutionError,
  FileError,
  FileInfo,
  FileSystem,
  HarnessEvent,
  Result,
  Shell,
  ShellExecOptions,
  ShellExecResult,
  ShellOutputLimits,
  ShellOutputMetadata,
  ShellOutputRetention,
  ShellOutputUpdate,
  ShellOutputView,
} from "@earendil-works/pi-agent-core";
import type { Context, ContextKey } from "@earendil-works/pi-agent-core/harness/context";
import type {
  JsonlSessionRepoOptions,
  JsonValue,
  MemorySessionRepoOptions,
  SessionRepo,
  UsageRow,
} from "@earendil-works/pi-agent-core/harness/session";

import type { PiclawExecutionAuthority } from "../contracts/execution-context-resolver.js";

/** Inert aliases to the selected pi-agent-core 0.85.1 public Harness boundary. */
export type EarendilV3ContextKeyShape<T> = ContextKey<T>;
export type EarendilV3ContextShape = Context;
export type EarendilV3ResultShape<TValue, TError> = Result<TValue, TError>;
export type EarendilV3JsonValueShape = JsonValue;

export type EarendilV3ToolInvocationShape = AgentHarnessToolInvocation;
export type EarendilV3ToolResultShape<TDetails = unknown> = AgentToolResult<TDetails>;
export type EarendilV3ToolUpdateShape<TDetails = unknown> = AgentHarnessToolUpdateCallback<TDetails>;
export type EarendilV3ToolShape = AgentHarnessTool<EarendilV3PiclawToolContextShape>;
export type EarendilV3ToolExecuteShape = EarendilV3ToolShape["execute"];

export type EarendilV3ShellOutputRetentionShape = ShellOutputRetention;
export type EarendilV3ShellOutputLimitsShape = ShellOutputLimits;
export type EarendilV3ShellOutputMetadataShape = ShellOutputMetadata;
export type EarendilV3ShellOutputViewShape = ShellOutputView;
export type EarendilV3ShellOutputUpdateShape = ShellOutputUpdate;
export type EarendilV3ShellExecOptionsShape = ShellExecOptions;
export type EarendilV3ShellExecResultShape = ShellExecResult;
export type EarendilV3ShellShape = Shell;
export type EarendilV3FileInfoShape = FileInfo;
export type EarendilV3FileErrorShape = FileError;
export type EarendilV3ExecutionErrorShape = ExecutionError;
export type EarendilV3FileSystemShape = FileSystem;
export type EarendilV3ExecutionEnvShape = ExecutionEnv;

export interface EarendilV3PiclawToolContextShape extends PiclawExecutionAuthority {
  readonly env: EarendilV3ExecutionEnvShape;
  readonly localEnv: EarendilV3ExecutionEnvShape;
}

export type EarendilV3UsageRowShape = UsageRow;
export type EarendilV3UsageShape = EarendilV3UsageRowShape["usage"];
export type EarendilV3UsageEventShape = Extract<HarnessEvent, { type: "usage" }>;

/** Piclaw owns this deliberately narrow projection input, not the Harness package. */
export type EarendilV3ProjectionInputShape =
  | EarendilV3UsageEventShape
  | Readonly<{ type: "message_update"; runId: string; message: unknown; frame?: unknown }>
  | Readonly<{ type: "tool_start"; runId: string; turnId: string; toolCallId: string; toolName: string; args: unknown }>
  | Readonly<{ type: "tool_update"; runId: string; turnId: string; toolCallId: string; toolName: string; partialResult: EarendilV3ToolResultShape }>
  | Readonly<{ type: "tool_end"; runId: string; turnId: string; toolCallId: string; toolName: string; result: EarendilV3ToolResultShape; isError: boolean; terminate: boolean }>
  | Readonly<{ type: "operation_abort"; operationId: string }>;

/** Piclaw authority and generation fencing remain application-owned. */
export interface PiclawV3ProjectionEnvelopeShape extends PiclawExecutionAuthority {
  readonly harnessOperationId: string;
  readonly watchGeneration: number;
  readonly receiptSeq: number;
  readonly event: EarendilV3ProjectionInputShape;
}

export type EarendilV3MemorySessionRepoOptionsShape = MemorySessionRepoOptions;
export type EarendilV3JsonlSessionRepoOptionsShape = JsonlSessionRepoOptions;
export type EarendilV3SessionRepoShape = SessionRepo;

export type EarendilV3PublicWatchSessionShape = AgentHarness["watchSession"];
export type EarendilV3RuntimeWatchSessionStubShape = (context: EarendilV3ContextShape) => Promise<never>;

/** The public watch contract exists, but the selected runtime implementation is still a stub. */
export interface EarendilV3HarnessActivationBlockShape {
  readonly publicContract: EarendilV3PublicWatchSessionShape;
  readonly selectedRuntimeStub: EarendilV3RuntimeWatchSessionStubShape;
}

/** Historical rejection record; it is not a second accepted Harness dialect. */
export interface EarendilV3Historical0850AssessmentShape {
  readonly assessedVersion: "0.85.0";
  readonly assessedReleaseCommit: "107d79f11072bbc8a3a757ed7fd69596bee7d68c";
  readonly disposition: "rejected";
  readonly sourceOnlyExperimentalExports: "not_admitted";
  readonly directPiServerWorkaround: "forbidden";
}

export interface EarendilV3SelectionGateShape {
  readonly productionVersion: "0.84.4";
  readonly selectedVersion: "0.85.1";
  readonly selectedReleaseCommit: "d981de1229ef899957bbe968bc8dcda02a21f477";
  readonly selectionScope: "candidate_branch_only";
  readonly liveDeploymentRequiresApproval: true;
  readonly packageClosure: "fresh_supported_coding_agent_root_imports_in_bun_and_supported_node_without_workarounds";
  readonly watchSession: "public_contract_present_selected_runtime_stub_unsupported";
  readonly harnessActivation: "blocked";
  readonly productionImporter: "forbidden";
}
