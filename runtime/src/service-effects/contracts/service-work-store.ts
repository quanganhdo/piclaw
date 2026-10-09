import type { Result } from "./result.js";

import type { EffectIdentity, PiclawEffectError } from "./common.js";

export type AcceptedSourceKind = "message" | "steer" | "follow_up" | "continuation" | "control" | "cancellation" | "scheduled_agent" | "internal";
export type AcceptedSourceState = "pending" | "claimed" | "queued" | "consumed" | "disposed";
export type PiclawOperationPhase = "accepted" | "claimed" | "starting_harness" | "executing" | "suspended" | "cancelling" | "settling" | "terminal";
export type PiclawDisposition = "completed" | "cancelled" | "failed" | "skipped" | "superseded";
export type HarnessState = "not_started" | "running" | "suspended" | "aborting" | "finished";
export type OperationIntentKind = "open_harness" | "prompt" | "queue_input" | "abort" | "resume" | "settle" | "maintenance";
export type QueuedInputKind = "steer" | "follow_up" | "next_run";
export type QueuedInputState = "accepted" | "queued" | "consumed" | "disposed";

export interface AcceptedSourceSnapshot {
  readonly chatJid: string;
  readonly sourceSeq: number;
  readonly sourceId: string;
  readonly kind: AcceptedSourceKind;
  readonly state: AcceptedSourceState;
  readonly payloadRef: string;
  readonly targetOperationId: string | null;
  readonly parentSourceSeq: number | null;
  readonly acceptedAt: string;
  readonly dispositionReason: string | null;
  readonly provenanceRef: string;
}

export interface HarnessCorrelation {
  readonly sessionId: string;
  readonly lane: string;
  readonly harnessOperationId: string | null;
  readonly state: HarnessState;
  readonly watchGeneration: number;
}

export interface CancellationSnapshot { readonly sourceSeq: number; readonly cause: string; readonly requestedAt: string }
export interface TerminalSnapshot { readonly disposition: PiclawDisposition; readonly messageRowId: number | null; readonly errorCode: string | null; readonly committedAt: string }

export interface OperationSnapshot {
  readonly operationId: string;
  readonly chatJid: string;
  readonly version: number;
  readonly phase: PiclawOperationPhase;
  readonly primarySourceSeq: number;
  readonly claimedSourceSeqs: readonly number[];
  readonly cancellation: CancellationSnapshot | null;
  readonly harness: HarnessCorrelation | null;
  readonly terminal: TerminalSnapshot | null;
}

export interface ChatFrontierSnapshot { readonly chatJid: string; readonly consumedThroughSourceSeq: number; readonly activeOperationId: string | null; readonly nextPendingSourceSeq: number | null }
export interface ClaimedOperation { readonly source: AcceptedSourceSnapshot; readonly operation: OperationSnapshot }

export interface AcceptSourceRequest {
  readonly effect: EffectIdentity;
  readonly chatJid: string;
  readonly sourceId: string;
  readonly kind: AcceptedSourceKind;
  readonly payloadRef: string;
  readonly targetOperationId: string | null;
  readonly parentSourceSeq: number | null;
  readonly acceptedAt: string;
  readonly createWakeIntent: boolean;
}
export interface ClaimNextSourceRequest { readonly effect: EffectIdentity; readonly chatJid: string; readonly expectedFrontier: number; readonly newOperationId: string; readonly claimedAt: string }
export interface AppendOperationIntentRequest { readonly effect: EffectIdentity & { readonly operationId: string }; readonly expectedVersion: number; readonly intentId: string; readonly kind: OperationIntentKind; readonly payloadRef: string; readonly createdAt: string }
export interface AcceptCancellationRequest { readonly effect: EffectIdentity & { readonly operationId: string }; readonly expectedVersion: number; readonly sourceId: string; readonly sourceSeq: number; readonly cause: string; readonly requestedAt: string }
export interface BindHarnessRequest { readonly effect: EffectIdentity & { readonly operationId: string }; readonly expectedVersion: number; readonly sessionId: string; readonly lane: string; readonly harnessOperationId: string | null; readonly state: HarnessState; readonly watchGeneration: number }
export interface RecordQueuedInputRequest { readonly effect: EffectIdentity & { readonly operationId: string }; readonly expectedVersion: number; readonly sourceSeq: number; readonly queueKind: QueuedInputKind; readonly harnessEntryId: string | null; readonly state: QueuedInputState }
export interface ListOpenOperationsRequest { readonly chatJid?: string; readonly limit?: number; readonly afterOperationId?: string }

export type ServiceWorkErrorTag = "idempotency_conflict" | "frontier_mismatch" | "version_mismatch" | "owner_conflict" | "invalid_transition" | "not_found" | "corrupt_state" | "storage_unavailable";
export interface ServiceWorkError extends PiclawEffectError<ServiceWorkErrorTag> {
  readonly _tag: ServiceWorkErrorTag;
  readonly observedVersion?: number;
  readonly observedFrontier?: number;
  readonly conflictingOperationId?: string;
}

export interface ServiceWorkStore {
  acceptSource(request: AcceptSourceRequest): Promise<Result<AcceptedSourceSnapshot, ServiceWorkError>>;
  claimNext(request: ClaimNextSourceRequest): Promise<Result<ClaimedOperation | null, ServiceWorkError>>;
  appendIntent(request: AppendOperationIntentRequest): Promise<Result<OperationSnapshot, ServiceWorkError>>;
  acceptCancellation(request: AcceptCancellationRequest): Promise<Result<OperationSnapshot, ServiceWorkError>>;
  bindHarness(request: BindHarnessRequest): Promise<Result<OperationSnapshot, ServiceWorkError>>;
  recordQueuedInput(request: RecordQueuedInputRequest): Promise<Result<OperationSnapshot, ServiceWorkError>>;
  getOperation(operationId: string): Promise<Result<OperationSnapshot | null, ServiceWorkError>>;
  getChatFrontier(chatJid: string): Promise<Result<ChatFrontierSnapshot, ServiceWorkError>>;
  listOpenOperations(request?: ListOpenOperationsRequest): Promise<Result<readonly OperationSnapshot[], ServiceWorkError>>;
}
