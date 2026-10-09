import type { Result } from "./result.js";

import type {
  EffectCertainty,
  EffectIdentity,
  PiclawEffectError,
  RedactionClass,
} from "./common.js";

export const OUTBOX_KINDS = Object.freeze([
  "wake_chat",
  "timeline_broadcast",
  "channel_delivery",
  "notification",
  "scheduler_run_log",
  "maintenance",
] as const);
export type OutboxKind = (typeof OUTBOX_KINDS)[number];

export type OutboxState =
  | "pending"
  | "started"
  | "completed"
  | "failed"
  | "unknown"
  | "cancelled";
export type OutboxRepeatability = "repeatable" | "reconciliation_required";

export interface OutboxRecord {
  readonly outboxId: string;
  readonly kind: OutboxKind;
  readonly state: OutboxState;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly operationId: string | null;
  readonly sourceSeq: number | null;
  readonly provenanceRef: string;
  readonly redactionClass: RedactionClass;
  readonly payloadRef: string;
  readonly destinationRef: string | null;
  readonly availableAt: string;
  readonly enqueuedAt: string;
  readonly stateChangedAt: string;
  readonly repeatability: OutboxRepeatability;
  readonly attempt: number;
  readonly workerId: string | null;
  readonly claimedAt: string | null;
  readonly leaseToken: string | null;
  readonly leaseExpiresAt: string | null;
  readonly certainty: EffectCertainty | null;
  readonly retryAt: string | null;
  readonly receiptRef: string | null;
  readonly lastErrorTag: string | null;
  readonly resultAt: string | null;
  readonly reconciliationRef: string | null;
  readonly reconciledAt: string | null;
  readonly cancellationReasonTag: string | null;
}

export interface EnqueueOutboxRequest {
  readonly effect: EffectIdentity;
  readonly outboxId: string;
  readonly kind: OutboxKind;
  readonly payloadRef: string;
  readonly destinationRef: string | null;
  readonly availableAt: string;
  readonly enqueuedAt: string;
  readonly repeatability: OutboxRepeatability;
}

export interface ClaimOutboxRequest {
  readonly kinds: readonly OutboxKind[];
  readonly workerId: string;
  readonly leaseToken: string;
  readonly now: string;
  readonly leaseExpiresAt: string;
}

export interface OutboxLease {
  readonly record: OutboxRecord & {
    readonly state: "started";
    readonly workerId: string;
    readonly leaseToken: string;
  };
  readonly workerId: string;
}

export interface ReclaimOutboxRequest {
  readonly outboxId: string;
  readonly expectedAttempt: number;
  readonly workerId: string;
  readonly leaseToken: string;
  readonly now: string;
  readonly leaseExpiresAt: string;
  readonly authority:
    | { readonly kind: "repeatable" }
    | {
        readonly kind: "reconciled_absent";
        readonly reconciliationRef: string;
      };
}

interface WorkerResultRequest {
  readonly outboxId: string;
  readonly workerId: string;
  readonly expectedAttempt: number;
  readonly leaseToken: string;
}

export interface CompleteOutboxRequest extends WorkerResultRequest {
  readonly receiptRef: string | null;
  readonly completedAt: string;
}

export interface FailOutboxRequest extends WorkerResultRequest {
  readonly errorTag: string;
  readonly certainty: "not_applied";
  readonly retryAt: string | null;
  readonly failedAt: string;
}

export interface MarkOutboxUnknownRequest extends WorkerResultRequest {
  readonly errorTag: string;
  readonly certainty: "unknown";
  readonly observedAt: string;
}

export interface ResolveUnknownOutboxRequest {
  readonly outboxId: string;
  readonly expectedAttempt: number;
  readonly reconciliationRef: string;
  readonly reconciledAt: string;
  readonly resolution:
    | { readonly kind: "applied"; readonly receiptRef: string | null }
    | {
        readonly kind: "not_applied";
        readonly errorTag: string;
        readonly retryAt: string | null;
      }
    | { readonly kind: "cancelled"; readonly reasonTag: string };
}

export interface OutboxCursor {
  readonly stateChangedAt: string;
  readonly outboxId: string;
}

export interface ListUnknownOutboxRequest {
  readonly kinds: readonly OutboxKind[];
  readonly after: OutboxCursor | null;
  readonly limit: number;
}

export interface ListUnknownOutboxResult {
  readonly records: readonly OutboxRecord[];
  readonly nextCursor: OutboxCursor | null;
}

export interface CleanupTerminalOutboxRequest {
  readonly cleanupId: string;
  readonly before: string;
  readonly after: OutboxCursor | null;
  readonly limit: number;
}

export interface CleanupTerminalOutboxResult {
  readonly deletedIds: readonly string[];
  readonly deletedCount: number;
  readonly nextCursor: OutboxCursor | null;
}

export type OutboxAppliedDecision<T> = {
  readonly decision: "applied" | "replayed";
  readonly record: T;
};
export type OutboxStaleDecision = {
  readonly decision: "stale";
  readonly record: null;
};
export type OutboxMutationDecision<T = OutboxRecord> =
  | OutboxAppliedDecision<T>
  | OutboxStaleDecision;
export type OutboxEnqueueDecision = OutboxAppliedDecision<OutboxRecord>;
export type OutboxClaimDecision =
  | { readonly decision: "applied" | "replayed"; readonly lease: OutboxLease }
  | { readonly decision: "empty" | "replayed"; readonly lease: null };
export type OutboxCleanupDecision = {
  readonly decision: "applied" | "replayed";
  readonly result: CleanupTerminalOutboxResult;
};

export type OutboxStoreErrorTag =
  | "invalid_request"
  | "idempotency_conflict"
  | "not_found"
  | "invalid_transition"
  | "corrupt_state"
  | "storage_unavailable";
export interface OutboxStoreError extends PiclawEffectError<OutboxStoreErrorTag> {
  readonly _tag: OutboxStoreErrorTag;
}

export interface ServiceOutboxStore {
  enqueue(
    request: EnqueueOutboxRequest,
  ): Promise<Result<OutboxEnqueueDecision, OutboxStoreError>>;
  claimNext(
    request: ClaimOutboxRequest,
  ): Promise<Result<OutboxClaimDecision, OutboxStoreError>>;
  reclaim(
    request: ReclaimOutboxRequest,
  ): Promise<Result<OutboxMutationDecision, OutboxStoreError>>;
  complete(
    request: CompleteOutboxRequest,
  ): Promise<Result<OutboxMutationDecision, OutboxStoreError>>;
  fail(
    request: FailOutboxRequest,
  ): Promise<Result<OutboxMutationDecision, OutboxStoreError>>;
  markUnknown(
    request: MarkOutboxUnknownRequest,
  ): Promise<Result<OutboxMutationDecision, OutboxStoreError>>;
  resolveUnknown(
    request: ResolveUnknownOutboxRequest,
  ): Promise<Result<OutboxMutationDecision, OutboxStoreError>>;
  get(outboxId: string): Promise<Result<OutboxRecord | null, OutboxStoreError>>;
  listUnknown(
    request: ListUnknownOutboxRequest,
  ): Promise<Result<ListUnknownOutboxResult, OutboxStoreError>>;
  cleanupTerminal(
    request: CleanupTerminalOutboxRequest,
  ): Promise<Result<OutboxCleanupDecision, OutboxStoreError>>;
}

/** Synchronous insert surface for a transaction already owned by EF-S02/EF-S07. */
export interface ServiceOutboxEnqueueInserter {
  insert(
    request: EnqueueOutboxRequest,
  ): Result<OutboxEnqueueDecision, OutboxStoreError>;
}
