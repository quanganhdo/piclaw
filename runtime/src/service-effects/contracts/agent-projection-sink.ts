import type { Result } from "./result.js";

import type { PiclawEffectError } from "./common.js";

export interface ProjectionOwner {
  readonly chatJid: string;
  readonly operationId: string;
  readonly harnessOperationId: string | null;
}

export interface ProjectionIdentity extends ProjectionOwner {
  readonly watchGeneration: number;
  readonly receiptSeq: number;
}

export interface PublicAgentSnapshot extends ProjectionIdentity {
  readonly type: "agent_snapshot";
  readonly phase: "idle" | "accepted" | "running" | "waiting" | "suspended" | "cancelling";
  readonly modelLabel: string | null;
  readonly activeToolNames: readonly string[];
  readonly cancellationRequested: boolean;
}

export type PublicAgentEvent =
  | (ProjectionIdentity & { readonly type: "phase_changed"; readonly phase: PublicAgentSnapshot["phase"] })
  | (ProjectionIdentity & { readonly type: "assistant_delta"; readonly textDelta: string })
  | (ProjectionIdentity & { readonly type: "tool_started"; readonly toolCallId: string; readonly toolName: string })
  | (ProjectionIdentity & { readonly type: "tool_updated"; readonly toolCallId: string; readonly publicSummary: string | null })
  | (ProjectionIdentity & { readonly type: "tool_finished"; readonly toolCallId: string; readonly outcome: "completed" | "failed" | "cancelled" })
  | (ProjectionIdentity & { readonly type: "usage_updated"; readonly inputTokens: number; readonly outputTokens: number });

export type PiclawDisposition = "completed" | "cancelled" | "failed" | "skipped" | "superseded";

export interface PublicTerminalProjection extends ProjectionIdentity {
  readonly type: "agent_terminal";
  readonly terminalCommitRef: string;
  readonly disposition: PiclawDisposition;
  readonly messageRowId: number | null;
  readonly errorCode: string | null;
}

export type PublicAgentProjection = PublicAgentSnapshot | PublicAgentEvent | PublicTerminalProjection;

export type ProjectionSinkErrorTag =
  | "stale_generation"
  | "stale_sequence"
  | "owner_conflict"
  | "generation_closed"
  | "terminal_not_committed"
  | "protected_payload"
  | "transport_unavailable";

export interface ProjectionSinkError extends PiclawEffectError<ProjectionSinkErrorTag> {
  readonly _tag: ProjectionSinkErrorTag;
}

export interface AgentProjectionSink {
  publishSnapshot(snapshot: PublicAgentSnapshot): Promise<Result<void, ProjectionSinkError>>;
  publishEvent(event: PublicAgentEvent): Promise<Result<void, ProjectionSinkError>>;
  publishTerminal(terminal: PublicTerminalProjection): Promise<Result<void, ProjectionSinkError>>;
}

export interface ProjectionAuthority {
  isCurrentOwner(owner: ProjectionOwner): boolean;
  isCommittedTerminalRef(owner: ProjectionOwner, terminalCommitRef: string): boolean;
}

export interface ProjectionTransport {
  /** Existing SSE broadcast is synchronous; cursor decisions rely on that boundary. */
  publish(projection: PublicAgentProjection): void;
}
