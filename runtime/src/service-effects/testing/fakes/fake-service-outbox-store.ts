import { createHash } from "node:crypto";
import {
  Result,
  type Result as ResultValue,
} from "../../contracts/result.js";

import type {
  EffectCertainty,
  NormalisedTraceInput,
} from "../../contracts/common.js";
import type {
  ClaimOutboxRequest,
  CleanupTerminalOutboxRequest,
  CompleteOutboxRequest,
  EnqueueOutboxRequest,
  FailOutboxRequest,
  ListUnknownOutboxRequest,
  ListUnknownOutboxResult,
  MarkOutboxUnknownRequest,
  OutboxClaimDecision,
  OutboxCleanupDecision,
  OutboxEnqueueDecision,
  OutboxLease,
  OutboxMutationDecision,
  OutboxRecord,
  OutboxStoreError,
  OutboxStoreErrorTag,
  ReclaimOutboxRequest,
  ResolveUnknownOutboxRequest,
  ServiceOutboxStore,
} from "../../contracts/service-outbox-store.js";
import type { ContractTestContext } from "../contract-suite.js";
import { EffectTraceRecorder } from "../trace-recorder.js";
import {
  type FakeOutboxMutationMethod,
  hashFakeOutboxRequest,
  normaliseFakeOutboxId,
  normaliseFakeOutboxList,
  normaliseFakeOutboxMutation,
} from "./fake-service-outbox-request-normalizer.js";

type DecisionOutcome = "applied" | "stale" | "empty";
interface Decision {
  readonly method: FakeOutboxMutationMethod;
  readonly hash: string;
  readonly outcome: DecisionOutcome;
  readonly outboxId: string | null;
  readonly attempt: number | null;
  readonly tokenHash: string | null;
  readonly cleanupResult: OutboxCleanupDecision["result"] | null;
}
interface LeaseAuthority {
  readonly method: "claimNext" | "reclaim";
  readonly requestHash: string;
  readonly outboxId: string;
  readonly attempt: number;
  readonly workerId: string;
  readonly claimedAt: string;
  readonly leaseExpiresAt: string;
  readonly reconciliationRef: string | null;
}
interface OutcomeAuthority {
  readonly method: "complete" | "fail" | "markUnknown";
  readonly requestHash: string;
  readonly outboxId: string;
  readonly attempt: number;
  readonly state: "completed" | "failed" | "unknown";
  readonly certainty: EffectCertainty;
  readonly resultAt: string;
  readonly receiptRef: string | null;
  readonly errorTag: string | null;
  readonly retryAt: string | null;
  readonly reconciliationRef: string | null;
}
interface ResolutionAuthority {
  readonly requestHash: string;
  readonly outboxId: string;
  readonly attempt: number;
  readonly state: "completed" | "failed" | "cancelled";
  readonly certainty: "applied" | "not_applied";
  readonly reconciledAt: string;
  readonly reconciliationRef: string;
  readonly receiptRef: string | null;
  readonly errorTag: string | null;
  readonly retryAt: string | null;
  readonly reasonTag: string | null;
}
interface State {
  records: Record<string, OutboxRecord>;
  decisions: Record<string, Decision>;
  leases: Record<string, LeaseAuthority>;
  outcomes: Record<string, OutcomeAuthority>;
  resolutions: Record<string, ResolutionAuthority>;
}
type PlannedPoint = "before_effect" | "effect_then_lost_acknowledgement";
type FaultValue = boolean | "in_transaction" | unknown;

export class FakeServiceOutboxStore implements ServiceOutboxStore {
  readonly trace = new EffectTraceRecorder();
  #state: State = emptyState();
  #serial: Promise<void> = Promise.resolve();
  #faults = new Map<string, Set<number>>();
  #faultValues = new Map<string, unknown>();
  #counts = new Map<string, number>();

  constructor(
    private readonly context: ContractTestContext,
    private readonly observer: (input: NormalisedTraceInput) => void = () =>
      undefined,
  ) {}

  planFault(method: string, point: PlannedPoint, occurrence = 1): void {
    const key = `${method}:${point}`;
    const consumed = this.#counts.get(key) ?? 0;
    this.#faults.set(key, new Set([consumed + occurrence]));
    this.#faultValues.set(key, true);
  }

  planFaultValue(
    method: string,
    point: PlannedPoint,
    value: unknown,
    occurrence = 1,
  ): void {
    const key = `${method}:${point}`;
    const consumed = this.#counts.get(key) ?? 0;
    this.#faults.set(key, new Set([consumed + occurrence]));
    this.#faultValues.set(key, value);
  }

  planFaultThrow(method: string, point: PlannedPoint, occurrence = 1): void {
    this.planFaultValue(method, point, throwFault, occurrence);
  }

  snapshot(): State {
    return structuredClone(this.#state);
  }

  restore(snapshot: State): void {
    this.#state = structuredClone(snapshot);
    this.#faults.clear();
    this.#faultValues.clear();
    this.#counts.clear();
  }

  inspectState(): State {
    return structuredClone(this.#state);
  }

  /** Test-layer corruption hook for public-path containment contracts only. */
  restoreMalformedForTesting(snapshot: unknown): void {
    this.#state = structuredClone(snapshot) as State;
    this.#faults.clear();
    this.#faultValues.clear();
    this.#counts.clear();
  }

  enqueue(
    input: EnqueueOutboxRequest,
  ): Promise<ResultValue<OutboxEnqueueDecision, OutboxStoreError>> {
    return this.mutate<OutboxEnqueueDecision>("enqueue", input, (candidate) => {
      const request = candidate as EnqueueOutboxRequest;
      const key = `enqueue:${request.kind}:${request.effect.idempotencyKey}`;
      const known = this.#state.decisions[key];
      if (known) {
        if (
          known.method !== "enqueue" ||
          known.hash !== request.effect.requestHash
        ) {
          return Result.err(errorOf("idempotency_conflict"));
        }
        const identity = this.identity(known.outboxId);
        return Result.ok(
          freeze({
            decision: "replayed" as const,
            record: pendingFrom(identity),
          }),
        );
      }
      if (this.#state.records[request.outboxId]) {
        return Result.err(errorOf("idempotency_conflict"));
      }
      const record = pendingRecord(request);
      this.#state.records[request.outboxId] = record;
      this.remember(
        key,
        "enqueue",
        request.effect.requestHash,
        "applied",
        request.outboxId,
        0,
        null,
        null,
      );
      return Result.ok(freeze({ decision: "applied" as const, record }));
    });
  }

  claimNext(
    input: ClaimOutboxRequest,
  ): Promise<ResultValue<OutboxClaimDecision, OutboxStoreError>> {
    return this.mutate<OutboxClaimDecision>("claimNext", input, (candidate) => {
      const request = candidate as ClaimOutboxRequest;
      const requestHash = hashFakeOutboxRequest(request);
      const tokenHash = hashToken(request.leaseToken);
      const key = `claim:${tokenHash}`;
      const known = this.#state.decisions[key];
      const authority = this.#state.leases[tokenHash];
      if (known) {
        if (known.method !== "claimNext" || known.hash !== requestHash) {
          return Result.err(errorOf("idempotency_conflict"));
        }
        if (known.outcome === "empty") {
          return Result.ok(
            freeze({ decision: "replayed" as const, lease: null }),
          );
        }
        if (
          !authority ||
          authority.method !== "claimNext" ||
          authority.requestHash !== requestHash
        ) {
          return Result.err(errorOf("corrupt_state"));
        }
        return Result.ok(
          freeze({
            decision: "replayed" as const,
            lease: leaseFrom(
              this.identity(authority.outboxId),
              authority,
              request.leaseToken,
            ),
          }),
        );
      }
      if (authority) {
        return Result.err(errorOf("idempotency_conflict"));
      }
      const record = Object.values(this.#state.records)
        .filter(
          (row) =>
            request.kinds.includes(row.kind) &&
            ((row.state === "pending" && row.availableAt <= request.now) ||
              (row.state === "failed" &&
                row.retryAt !== null &&
                row.retryAt <= request.now)),
        )
        .sort(
          (left, right) =>
            effectiveAt(left).localeCompare(effectiveAt(right)) ||
            left.outboxId.localeCompare(right.outboxId),
        )[0];
      if (!record) {
        this.remember(
          key,
          "claimNext",
          requestHash,
          "empty",
          null,
          null,
          tokenHash,
          null,
        );
        return Result.ok(freeze({ decision: "empty" as const, lease: null }));
      }
      const started = this.replace(record, {
        state: "started",
        stateChangedAt: request.now,
        attempt: record.attempt + 1,
        workerId: request.workerId,
        claimedAt: request.now,
        leaseToken: request.leaseToken,
        leaseExpiresAt: request.leaseExpiresAt,
        certainty: null,
        retryAt: null,
        receiptRef: null,
        lastErrorTag: null,
        resultAt: null,
        reconciledAt: null,
        cancellationReasonTag: null,
      });
      const leaseAuthority: LeaseAuthority = freeze({
        method: "claimNext",
        requestHash,
        outboxId: record.outboxId,
        attempt: started.attempt,
        workerId: request.workerId,
        claimedAt: request.now,
        leaseExpiresAt: request.leaseExpiresAt,
        reconciliationRef: started.reconciliationRef,
      });
      this.#state.leases[tokenHash] = leaseAuthority;
      this.remember(
        key,
        "claimNext",
        requestHash,
        "applied",
        record.outboxId,
        started.attempt,
        tokenHash,
        null,
      );
      return Result.ok(
        freeze({
          decision: "applied" as const,
          lease: leaseFrom(started, leaseAuthority, request.leaseToken),
        }),
      );
    });
  }

  reclaim(
    input: ReclaimOutboxRequest,
  ): Promise<ResultValue<OutboxMutationDecision, OutboxStoreError>> {
    return this.mutate("reclaim", input, (candidate) => {
      const request = candidate as ReclaimOutboxRequest;
      const requestHash = hashFakeOutboxRequest(request);
      const tokenHash = hashToken(request.leaseToken);
      const key = `reclaim:${request.outboxId}:${request.expectedAttempt}`;
      const known = this.#state.decisions[key];
      if (known) {
        if (known.method !== "reclaim" || known.hash !== requestHash) {
          return Result.err(errorOf("idempotency_conflict"));
        }
        if (known.outcome === "stale") return Result.ok(stale());
        const authority = this.#state.leases[tokenHash];
        if (!authority || authority.requestHash !== requestHash)
          return Result.err(errorOf("corrupt_state"));
        return Result.ok(
          freeze({
            decision: "replayed" as const,
            record: recordFromLease(
              this.identity(request.outboxId),
              authority,
              request.leaseToken,
            ),
          }),
        );
      }
      if (this.#state.leases[tokenHash])
        return Result.err(errorOf("idempotency_conflict"));
      const row = this.#state.records[request.outboxId];
      const permitted =
        row?.state === "started" &&
        row.attempt === request.expectedAttempt &&
        row.claimedAt !== null &&
        row.leaseExpiresAt !== null &&
        request.now >= row.claimedAt &&
        request.now >= row.leaseExpiresAt &&
        ((request.authority.kind === "repeatable" &&
          row.repeatability === "repeatable") ||
          request.authority.kind === "reconciled_absent");
      if (!row) return Result.err(errorOf("not_found"));
      if (!permitted) {
        this.remember(
          key,
          "reclaim",
          requestHash,
          "stale",
          request.outboxId,
          request.expectedAttempt,
          null,
          null,
        );
        return Result.ok(stale());
      }
      const reconciliationRef =
        request.authority.kind === "reconciled_absent"
          ? request.authority.reconciliationRef
          : row.reconciliationRef;
      const started = this.replace(row, {
        stateChangedAt: request.now,
        attempt: row.attempt + 1,
        workerId: request.workerId,
        claimedAt: request.now,
        leaseToken: request.leaseToken,
        leaseExpiresAt: request.leaseExpiresAt,
        reconciliationRef,
      });
      const authority: LeaseAuthority = freeze({
        method: "reclaim",
        requestHash,
        outboxId: row.outboxId,
        attempt: started.attempt,
        workerId: request.workerId,
        claimedAt: request.now,
        leaseExpiresAt: request.leaseExpiresAt,
        reconciliationRef,
      });
      this.#state.leases[tokenHash] = authority;
      this.remember(
        key,
        "reclaim",
        requestHash,
        "applied",
        row.outboxId,
        started.attempt,
        tokenHash,
        null,
      );
      return Result.ok(applied(started));
    });
  }

  complete(input: CompleteOutboxRequest) {
    return this.workerResult("complete", input, {
      state: "completed",
      certainty: "applied",
      resultAt: input.completedAt,
      receiptRef: input.receiptRef,
      errorTag: null,
      retryAt: null,
    });
  }

  fail(input: FailOutboxRequest) {
    return this.workerResult("fail", input, {
      state: "failed",
      certainty: "not_applied",
      resultAt: input.failedAt,
      receiptRef: null,
      errorTag: input.errorTag,
      retryAt: input.retryAt,
    });
  }

  markUnknown(input: MarkOutboxUnknownRequest) {
    return this.workerResult("markUnknown", input, {
      state: "unknown",
      certainty: "unknown",
      resultAt: input.observedAt,
      receiptRef: null,
      errorTag: input.errorTag,
      retryAt: null,
    });
  }

  resolveUnknown(
    input: ResolveUnknownOutboxRequest,
  ): Promise<ResultValue<OutboxMutationDecision, OutboxStoreError>> {
    return this.mutate("resolveUnknown", input, (candidate) => {
      const request = candidate as ResolveUnknownOutboxRequest;
      const requestHash = hashFakeOutboxRequest(request);
      const key = `resolve:${request.outboxId}:${request.expectedAttempt}`;
      const known = this.#state.decisions[key];
      if (known) {
        if (known.method !== "resolveUnknown" || known.hash !== requestHash)
          return Result.err(errorOf("idempotency_conflict"));
        if (known.outcome === "stale") return Result.ok(stale());
        const authority =
          this.#state.resolutions[
            outcomeKey(request.outboxId, request.expectedAttempt)
          ];
        if (!authority || authority.requestHash !== requestHash)
          return Result.err(errorOf("corrupt_state"));
        return Result.ok(
          freeze({
            decision: "replayed" as const,
            record: recordFromResolution(
              this.identity(request.outboxId),
              authority,
            ),
          }),
        );
      }
      const row = this.#state.records[request.outboxId];
      const validTime =
        row?.resultAt !== null &&
        row?.resultAt !== undefined &&
        request.reconciledAt >= row.resultAt &&
        (request.resolution.kind !== "not_applied" ||
          request.resolution.retryAt === null ||
          request.resolution.retryAt > request.reconciledAt);
      if (!row) return Result.err(errorOf("not_found"));
      if (
        row.state !== "unknown" ||
        row.attempt !== request.expectedAttempt ||
        !validTime
      ) {
        this.remember(
          key,
          "resolveUnknown",
          requestHash,
          "stale",
          request.outboxId,
          request.expectedAttempt,
          null,
          null,
        );
        return Result.ok(stale());
      }
      const resolution = resolutionAuthority(request);
      this.#state.resolutions[
        outcomeKey(request.outboxId, request.expectedAttempt)
      ] = resolution;
      const record = recordFromResolution(row, resolution);
      this.#state.records[row.outboxId] = record;
      this.remember(
        key,
        "resolveUnknown",
        requestHash,
        "applied",
        row.outboxId,
        row.attempt,
        null,
        null,
      );
      return Result.ok(applied(record));
    });
  }

  async get(
    input: string,
  ): Promise<ResultValue<OutboxRecord | null, OutboxStoreError>> {
    const id = normaliseFakeOutboxId(input);
    if (!id) return Result.err(errorOf("invalid_request"));
    try {
      const record = this.#state.records[id];
      return Result.ok(record ? validateFakeRecord(record) : null);
    } catch (error) {
      void error;
      return Result.err(errorOf("corrupt_state"));
    }
  }

  async listUnknown(
    input: ListUnknownOutboxRequest,
  ): Promise<ResultValue<ListUnknownOutboxResult, OutboxStoreError>> {
    const request = normaliseFakeOutboxList(input);
    if (!request) return Result.err(errorOf("invalid_request"));
    try {
      const records = Object.values(this.#state.records)
        .map(validateFakeRecord)
        .filter(
          (row) =>
            row.state === "unknown" &&
            request.kinds.includes(row.kind) &&
            (!request.after ||
              row.stateChangedAt > request.after.stateChangedAt ||
              (row.stateChangedAt === request.after.stateChangedAt &&
                row.outboxId > request.after.outboxId)),
        )
        .sort(orderRecords)
        .slice(0, request.limit);
      const last =
        records.length === request.limit ? (records.at(-1) ?? null) : null;
      return Result.ok(
        freeze({
          records: Object.freeze(records),
          nextCursor: last
            ? { stateChangedAt: last.stateChangedAt, outboxId: last.outboxId }
            : null,
        }),
      );
    } catch (error) {
      void error;
      return Result.err(errorOf("corrupt_state"));
    }
  }

  cleanupTerminal(
    input: CleanupTerminalOutboxRequest,
  ): Promise<ResultValue<OutboxCleanupDecision, OutboxStoreError>> {
    return this.mutate<OutboxCleanupDecision>(
      "cleanupTerminal",
      input,
      (candidate) => {
        const request = candidate as CleanupTerminalOutboxRequest;
        const requestHash = hashFakeOutboxRequest(request);
        const key = `cleanup:${request.cleanupId}`;
        const known = this.#state.decisions[key];
        if (known) {
          validateFakeDecision(known);
          if (known.method !== "cleanupTerminal" || known.hash !== requestHash)
            return Result.err(errorOf("idempotency_conflict"));
          if (!known.cleanupResult) return Result.err(errorOf("corrupt_state"));
          return Result.ok(
            freeze({
              decision: "replayed" as const,
              result: validateFakeCleanupResult(known.cleanupResult),
            }),
          );
        }
        const rows = Object.values(this.#state.records)
          .filter(
            (row) =>
              row.stateChangedAt < request.before &&
              (row.state === "cancelled" ||
                (row.state === "failed" &&
                  row.certainty === "not_applied" &&
                  row.retryAt === null)) &&
              (!request.after ||
                row.stateChangedAt > request.after.stateChangedAt ||
                (row.stateChangedAt === request.after.stateChangedAt &&
                  row.outboxId > request.after.outboxId)),
          )
          .sort(orderRecords)
          .slice(0, request.limit);
        for (const row of rows) {
          delete this.#state.records[row.outboxId];
          delete this.#state.outcomes[outcomeKey(row.outboxId, row.attempt)];
          delete this.#state.resolutions[outcomeKey(row.outboxId, row.attempt)];
          for (const [decisionKey, decision] of Object.entries(
            this.#state.decisions,
          )) {
            if (decision.outboxId === row.outboxId)
              delete this.#state.decisions[decisionKey];
          }
        }
        const last =
          rows.length === request.limit ? (rows.at(-1) ?? null) : null;
        const result = freeze({
          deletedIds: Object.freeze(rows.map((row) => row.outboxId)),
          deletedCount: rows.length,
          nextCursor: last
            ? { stateChangedAt: last.stateChangedAt, outboxId: last.outboxId }
            : null,
        });
        this.remember(
          key,
          "cleanupTerminal",
          requestHash,
          "applied",
          null,
          null,
          null,
          result,
        );
        return Result.ok(freeze({ decision: "applied" as const, result }));
      },
    );
  }

  private workerResult<
    T extends
      | CompleteOutboxRequest
      | FailOutboxRequest
      | MarkOutboxUnknownRequest,
  >(
    method: "complete" | "fail" | "markUnknown",
    input: T,
    outcome: Omit<
      OutcomeAuthority,
      "method" | "requestHash" | "outboxId" | "attempt" | "reconciliationRef"
    >,
  ): Promise<ResultValue<OutboxMutationDecision, OutboxStoreError>> {
    return this.mutate(method, input, (candidate) => {
      const request = candidate as T;
      const requestHash = hashFakeOutboxRequest(request);
      const key = `outcome:${request.outboxId}:${request.expectedAttempt}`;
      const authorityKey = outcomeKey(
        request.outboxId,
        request.expectedAttempt,
      );
      const authority = this.#state.outcomes[authorityKey];
      if (authority) {
        if (
          authority.method === method &&
          authority.requestHash === requestHash
        ) {
          return Result.ok(
            freeze({
              decision: "replayed" as const,
              record: recordFromOutcome(
                this.identity(request.outboxId),
                authority,
              ),
            }),
          );
        }
        return Result.ok(stale());
      }
      const known = this.#state.decisions[key];
      if (known && known.outcome !== "stale") return Result.ok(stale());
      if (known && known.method === method && known.hash === requestHash)
        return Result.ok(stale());
      const row = this.#state.records[request.outboxId];
      const validTime =
        row?.claimedAt !== null &&
        row?.claimedAt !== undefined &&
        row.leaseExpiresAt !== null &&
        outcome.resultAt >= row.claimedAt &&
        outcome.resultAt < row.leaseExpiresAt &&
        (outcome.retryAt === null || outcome.retryAt > outcome.resultAt);
      const owns =
        row?.state === "started" &&
        row.workerId === request.workerId &&
        row.attempt === request.expectedAttempt &&
        row.leaseToken === request.leaseToken;
      if (!row) return Result.err(errorOf("not_found"));
      if (!owns || !validTime) return Result.ok(stale());
      const durable: OutcomeAuthority = freeze({
        ...outcome,
        method,
        requestHash,
        outboxId: request.outboxId,
        attempt: request.expectedAttempt,
        reconciliationRef: row.reconciliationRef,
      });
      this.#state.outcomes[authorityKey] = durable;
      const record = recordFromOutcome(row, durable);
      this.#state.records[row.outboxId] = record;
      this.remember(
        key,
        method,
        requestHash,
        "applied",
        row.outboxId,
        row.attempt,
        null,
        null,
      );
      return Result.ok(applied(record));
    });
  }

  private async mutate<T>(
    method: FakeOutboxMutationMethod,
    input: unknown,
    apply: (request: unknown) => ResultValue<T, OutboxStoreError>,
  ): Promise<ResultValue<T, OutboxStoreError>> {
    const request = normaliseFakeOutboxMutation(method, input);
    const previous = this.#serial;
    let release!: () => void;
    this.#serial = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    let snapshot: State | null = null;
    try {
      this.observe(method, request, "call", null);
      if (!request)
        return this.finish(
          method,
          request,
          Result.err(errorOf("invalid_request")),
        );
      const faultObservation = this.readBeforeEffectFault(method);
      if (
        !faultObservation.ok ||
        faultObservation.checkpoint === "pre_transaction"
      ) {
        return this.finish(
          method,
          request,
          Result.err(errorOf("storage_unavailable", "not_applied", true)),
        );
      }
      snapshot = structuredClone(this.#state);
      const value = apply(request);
      if (!value.ok) return this.finish(method, request, value);
      if (faultObservation.checkpoint === "in_transaction") {
        this.#state = snapshot;
        return this.finish(
          method,
          request,
          Result.err(errorOf("storage_unavailable", "not_applied", true)),
        );
      }
      if (this.exactLostAcknowledgement(method))
        return this.finish(
          method,
          request,
          Result.err(errorOf("storage_unavailable", "unknown", true)),
        );
      return this.finish(method, request, value);
    } catch (error) {
      void error;
      if (snapshot) this.#state = snapshot;
      return this.finish(method, request, Result.err(errorOf("corrupt_state")));
    } finally {
      release();
    }
  }

  private readBeforeEffectFault(method: FakeOutboxMutationMethod):
    | {
        readonly ok: true;
        readonly checkpoint: "pre_transaction" | "in_transaction" | null;
      }
    | { readonly ok: false } {
    const observation = this.hitFault(method, "before_effect");
    if (!observation.ok) return observation;
    if (observation.value === false) return { ok: true, checkpoint: null };
    if (observation.value === true) {
      return { ok: true, checkpoint: "pre_transaction" };
    }
    if (observation.value === "in_transaction") {
      return { ok: true, checkpoint: "in_transaction" };
    }
    return { ok: false };
  }

  private exactLostAcknowledgement(method: FakeOutboxMutationMethod): boolean {
    const observation = this.hitFault(
      method,
      "effect_then_lost_acknowledgement",
    );
    return observation.ok && observation.value === true;
  }

  private hitFault(
    method: FakeOutboxMutationMethod,
    point: PlannedPoint,
  ):
    | { readonly ok: true; readonly value: FaultValue }
    | { readonly ok: false } {
    try {
      const key = `${method}:${point}`;
      const occurrence = (this.#counts.get(key) ?? 0) + 1;
      this.#counts.set(key, occurrence);
      const planned = this.#faults.get(key);
      if (planned?.has(occurrence)) {
        const value = this.#faultValues.get(key);
        if (value === throwFault)
          throw new Error("planned fake fault observer failure");
        if (value === true && point === "before_effect" && occurrence > 1) {
          return { ok: true, value: "in_transaction" };
        }
        return { ok: true, value };
      }
      return { ok: true, value: this.context.faults.hit(point) };
    } catch (error) {
      void error;
      return { ok: false };
    }
  }

  private replace(
    record: OutboxRecord,
    patch: Partial<OutboxRecord>,
  ): OutboxRecord {
    const next = freeze({ ...record, ...patch });
    this.#state.records[record.outboxId] = next;
    return next;
  }

  private identity(outboxId: string | null): OutboxRecord {
    if (!outboxId) throw new TypeError("Missing fake outbox identity.");
    const record = this.#state.records[outboxId];
    if (!record) throw new TypeError("Missing fake outbox record.");
    return record;
  }

  private remember(
    key: string,
    method: FakeOutboxMutationMethod,
    hash: string,
    outcome: DecisionOutcome,
    outboxId: string | null,
    attempt: number | null,
    tokenHash: string | null,
    cleanupResult: OutboxCleanupDecision["result"] | null,
  ): void {
    this.#state.decisions[key] = freeze({
      method,
      hash,
      outcome,
      outboxId,
      attempt,
      tokenHash,
      cleanupResult,
    });
  }

  private observe(
    method: string,
    request: unknown,
    resultTag: string,
    certainty: EffectCertainty | null,
  ): void {
    try {
      const value = request as {
        outboxId?: string;
        effect?: { operationId?: string | null; sourceSeq?: number | null };
        expectedAttempt?: number;
      } | null;
      const trace: NormalisedTraceInput = {
        contract: "EF-S05",
        method,
        effectId: value?.outboxId ?? "invalid",
        operationId: value?.effect?.operationId ?? null,
        sourceSeq: value?.effect?.sourceSeq ?? null,
        version: value?.expectedAttempt ?? null,
        certainty,
        resultTag,
      };
      if (resultTag === "call") this.trace.recordCall(trace);
      else this.trace.recordResult(trace);
      this.observer(trace);
    } catch (error) {
      void error;
    }
  }

  private finish<T>(
    method: string,
    request: unknown,
    result: ResultValue<T, OutboxStoreError>,
  ): ResultValue<T, OutboxStoreError> {
    this.observe(
      method,
      request,
      result.ok ? decisionTag(result.value) : result.error._tag,
      result.ok ? decisionCertainty(result.value) : result.error.certainty,
    );
    return result;
  }
}

const throwFault = Symbol("throw-fault");

function emptyState(): State {
  return {
    records: {},
    decisions: {},
    leases: {},
    outcomes: {},
    resolutions: {},
  };
}
function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
function outcomeKey(outboxId: string, attempt: number): string {
  return `${outboxId}:${attempt}`;
}
function pendingRecord(request: EnqueueOutboxRequest): OutboxRecord {
  return freeze({
    outboxId: request.outboxId,
    kind: request.kind,
    state: "pending",
    idempotencyKey: request.effect.idempotencyKey,
    requestHash: request.effect.requestHash,
    operationId: request.effect.operationId,
    sourceSeq: request.effect.sourceSeq,
    provenanceRef: request.effect.provenanceRef,
    redactionClass: request.effect.redactionClass,
    payloadRef: request.payloadRef,
    destinationRef: request.destinationRef,
    availableAt: request.availableAt,
    enqueuedAt: request.enqueuedAt,
    stateChangedAt: request.enqueuedAt,
    repeatability: request.repeatability,
    attempt: 0,
    workerId: null,
    claimedAt: null,
    leaseToken: null,
    leaseExpiresAt: null,
    certainty: "not_applied",
    retryAt: null,
    receiptRef: null,
    lastErrorTag: null,
    resultAt: null,
    reconciliationRef: null,
    reconciledAt: null,
    cancellationReasonTag: null,
  });
}
function pendingFrom(identity: OutboxRecord): OutboxRecord {
  return freeze({
    ...identity,
    state: "pending",
    stateChangedAt: identity.enqueuedAt,
    attempt: 0,
    workerId: null,
    claimedAt: null,
    leaseToken: null,
    leaseExpiresAt: null,
    certainty: "not_applied",
    retryAt: null,
    receiptRef: null,
    lastErrorTag: null,
    resultAt: null,
    reconciliationRef: null,
    reconciledAt: null,
    cancellationReasonTag: null,
  });
}
function leaseFrom(
  identity: OutboxRecord,
  authority: LeaseAuthority,
  token: string,
): OutboxLease {
  const record = recordFromLease(
    identity,
    authority,
    token,
  ) as OutboxLease["record"];
  return freeze({ record, workerId: authority.workerId });
}
function recordFromLease(
  identity: OutboxRecord,
  authority: LeaseAuthority,
  token: string,
): OutboxRecord {
  return freeze({
    ...identity,
    state: "started",
    stateChangedAt: authority.claimedAt,
    attempt: authority.attempt,
    workerId: authority.workerId,
    claimedAt: authority.claimedAt,
    leaseToken: token,
    leaseExpiresAt: authority.leaseExpiresAt,
    certainty: null,
    retryAt: null,
    receiptRef: null,
    lastErrorTag: null,
    resultAt: null,
    reconciliationRef: authority.reconciliationRef,
    reconciledAt: null,
    cancellationReasonTag: null,
  });
}
function recordFromOutcome(
  identity: OutboxRecord,
  authority: OutcomeAuthority,
): OutboxRecord {
  return freeze({
    ...identity,
    state: authority.state,
    stateChangedAt: authority.resultAt,
    attempt: authority.attempt,
    workerId: null,
    claimedAt: null,
    leaseToken: null,
    leaseExpiresAt: null,
    certainty: authority.certainty,
    retryAt: authority.retryAt,
    receiptRef: authority.receiptRef,
    lastErrorTag: authority.errorTag,
    resultAt: authority.resultAt,
    reconciliationRef: authority.reconciliationRef,
    reconciledAt: null,
    cancellationReasonTag: null,
  });
}
function resolutionAuthority(
  request: ResolveUnknownOutboxRequest,
): ResolutionAuthority {
  const resolution = request.resolution;
  return freeze({
    requestHash: hashFakeOutboxRequest(request),
    outboxId: request.outboxId,
    attempt: request.expectedAttempt,
    state:
      resolution.kind === "applied"
        ? "completed"
        : resolution.kind === "not_applied"
          ? "failed"
          : "cancelled",
    certainty: resolution.kind === "applied" ? "applied" : "not_applied",
    reconciledAt: request.reconciledAt,
    reconciliationRef: request.reconciliationRef,
    receiptRef: resolution.kind === "applied" ? resolution.receiptRef : null,
    errorTag: resolution.kind === "not_applied" ? resolution.errorTag : null,
    retryAt: resolution.kind === "not_applied" ? resolution.retryAt : null,
    reasonTag: resolution.kind === "cancelled" ? resolution.reasonTag : null,
  });
}
function recordFromResolution(
  identity: OutboxRecord,
  authority: ResolutionAuthority,
): OutboxRecord {
  return freeze({
    ...identity,
    state: authority.state,
    stateChangedAt: authority.reconciledAt,
    attempt: authority.attempt,
    workerId: null,
    claimedAt: null,
    leaseToken: null,
    leaseExpiresAt: null,
    certainty: authority.certainty,
    retryAt: authority.retryAt,
    receiptRef: authority.receiptRef,
    lastErrorTag: authority.errorTag,
    resultAt: authority.reconciledAt,
    reconciliationRef: authority.reconciliationRef,
    reconciledAt: authority.reconciledAt,
    cancellationReasonTag: authority.reasonTag,
  });
}
function validateFakeDecision(decision: Decision): Decision {
  const methods = new Set([
    "enqueue",
    "claimNext",
    "reclaim",
    "complete",
    "fail",
    "markUnknown",
    "resolveUnknown",
    "cleanupTerminal",
  ]);
  if (
    !decision ||
    typeof decision !== "object" ||
    !methods.has(decision.method) ||
    !/^[0-9a-f]{64}$/.test(decision.hash) ||
    !new Set(["applied", "stale", "empty"]).has(decision.outcome)
  ) {
    throw new TypeError("Malformed fake decision.");
  }
  return decision;
}

function validateFakeCleanupResult(
  result: OutboxCleanupDecision["result"],
): OutboxCleanupDecision["result"] {
  if (
    !result ||
    typeof result !== "object" ||
    !Array.isArray(result.deletedIds) ||
    !result.deletedIds.every((id) => boundedText(id, 512)) ||
    !Number.isSafeInteger(result.deletedCount) ||
    result.deletedCount !== result.deletedIds.length ||
    (result.nextCursor !== null &&
      (!instant(result.nextCursor.stateChangedAt) ||
        !boundedText(result.nextCursor.outboxId, 512)))
  ) {
    throw new TypeError("Malformed fake cleanup result.");
  }
  return result;
}

function validateFakeRecord(record: OutboxRecord): OutboxRecord {
  const states = new Set([
    "pending",
    "started",
    "completed",
    "failed",
    "unknown",
    "cancelled",
  ]);
  const certainties = new Set(["not_applied", "applied", "unknown"]);
  if (
    !record ||
    typeof record !== "object" ||
    !states.has(record.state) ||
    !boundedText(record.outboxId, 512) ||
    !instant(record.stateChangedAt) ||
    !instant(record.availableAt) ||
    !instant(record.enqueuedAt) ||
    !/^[0-9a-f]{64}$/.test(record.requestHash)
  ) {
    throw new TypeError("Malformed fake outbox record.");
  }
  if (!Number.isSafeInteger(record.attempt) || record.attempt < 0) {
    throw new TypeError("Malformed fake outbox attempt.");
  }
  if (record.certainty !== null && !certainties.has(record.certainty)) {
    throw new TypeError("Malformed fake outbox certainty.");
  }
  const started = record.state === "started";
  const ownsLease =
    record.workerId !== null &&
    record.claimedAt !== null &&
    record.leaseToken !== null &&
    record.leaseExpiresAt !== null;
  if (started !== ownsLease)
    throw new TypeError("Malformed fake lease correlation.");
  const expected =
    record.state === "pending"
      ? "not_applied"
      : record.state === "completed"
        ? "applied"
        : record.state === "failed" || record.state === "cancelled"
          ? "not_applied"
          : record.state === "unknown"
            ? "unknown"
            : null;
  if (record.certainty !== expected)
    throw new TypeError("Malformed fake state certainty.");
  return record;
}

function boundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" && value.length >= 1 && value.length <= maximum
  );
}
function instant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function effectiveAt(record: OutboxRecord): string {
  if (record.state === "pending") return record.availableAt;
  if (record.state === "failed" && record.retryAt !== null)
    return record.retryAt;
  throw new TypeError("Ineligible fake outbox record.");
}
function orderRecords(left: OutboxRecord, right: OutboxRecord): number {
  return (
    left.stateChangedAt.localeCompare(right.stateChangedAt) ||
    left.outboxId.localeCompare(right.outboxId)
  );
}
function errorOf(
  _tag: OutboxStoreErrorTag,
  certainty: EffectCertainty = "not_applied",
  retryable = false,
): OutboxStoreError {
  return freeze({ _tag, certainty, retryable });
}
function applied(record: OutboxRecord): OutboxMutationDecision {
  return freeze({ decision: "applied", record });
}
function stale(): OutboxMutationDecision {
  return freeze({ decision: "stale", record: null });
}
function decisionTag(value: unknown): string {
  try {
    return typeof (value as { decision?: unknown })?.decision === "string"
      ? (value as { decision: string }).decision
      : "ok";
  } catch (error) {
    void error;
    return "ok";
  }
}
function decisionCertainty(value: unknown): EffectCertainty | null {
  try {
    const decision = value as { record?: OutboxRecord; lease?: OutboxLease };
    return (decision.record ?? decision.lease?.record)?.certainty ?? null;
  } catch (error) {
    void error;
    return null;
  }
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
