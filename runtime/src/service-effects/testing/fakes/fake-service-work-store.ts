import {
  Result,
  type Result as ResultValue,
} from "../../contracts/result.js";

import type { NormalisedTraceInput } from "../../contracts/common.js";
import type {
  AcceptCancellationRequest,
  AcceptedSourceSnapshot,
  AcceptSourceRequest,
  AppendOperationIntentRequest,
  BindHarnessRequest,
  ChatFrontierSnapshot,
  ClaimedOperation,
  ClaimNextSourceRequest,
  ListOpenOperationsRequest,
  OperationSnapshot,
  RecordQueuedInputRequest,
  ServiceWorkError,
  ServiceWorkErrorTag,
  ServiceWorkStore,
} from "../../contracts/service-work-store.js";
import type { ContractTestContext } from "../contract-suite.js";
import { EffectTraceRecorder } from "../trace-recorder.js";
import {
  normaliseFakeListRequest,
  normaliseFakeMutationRequest,
  normaliseFakeReadIdentifier,
  fakeSemanticIntentHash,
  fakeSemanticSourceHash,
  type FakeMutationMethod,
  type NormalisedFakeMutationRequest,
} from "./fake-service-work-request-normalizer.js";

interface FakeMutationRequests {
  acceptSource: AcceptSourceRequest;
  claimNext: ClaimNextSourceRequest;
  appendIntent: AppendOperationIntentRequest;
  acceptCancellation: AcceptCancellationRequest;
  bindHarness: BindHarnessRequest;
  recordQueuedInput: RecordQueuedInputRequest;
}

interface FakeState {
  sources: AcceptedSourceSnapshot[];
  sourceHashes: Record<string, string>;
  intentHashes: Record<string, string>;
  operations: OperationSnapshot[];
  nextByChat: Record<string, number>;
  activeByChat: Record<string, string | null>;
  decisions: Record<
    string,
    { method: FakeMutationMethod; hash: string; value: unknown }
  >;
  intents: Array<{
    operationId: string;
    intentId: string;
    kind: string;
    payloadRef: string;
    createdAt: string;
  }>;
  queues: Array<{
    operationId: string;
    sourceSeq: number;
    queueKind: string;
    harnessEntryId: string | null;
    state: string;
  }>;
  wakes: string[];
}

export class FakeServiceWorkStore implements ServiceWorkStore {
  readonly trace = new EffectTraceRecorder();
  #state: FakeState = {
    sources: [],
    sourceHashes: {},
    intentHashes: {},
    operations: [],
    nextByChat: {},
    activeByChat: {},
    decisions: {},
    intents: [],
    queues: [],
    wakes: [],
  };
  #serial: Promise<void> = Promise.resolve();
  #faults = new Map<string, Set<number>>();
  #faultCounts = new Map<string, number>();
  readonly #runtimeFault: (
    point: "before_effect" | "effect_then_lost_acknowledgement",
  ) => unknown;
  readonly #traceObserver: (input: NormalisedTraceInput) => void;
  constructor(
    private readonly context: ContractTestContext,
    runtimeFault?: (
      point: "before_effect" | "effect_then_lost_acknowledgement",
    ) => unknown,
    traceObserver: (input: NormalisedTraceInput) => void = () => undefined,
  ) {
    this.#runtimeFault = runtimeFault ?? ((point) => context.faults.hit(point));
    this.#traceObserver = traceObserver;
  }

  planFault(
    method: string,
    point: "before_effect" | "effect_then_lost_acknowledgement",
    occurrence: number,
  ): void {
    const key = `${method}:${point}`;
    const current = this.#faultCounts.get(key) ?? 0;
    this.#faults.set(key, new Set([current + occurrence]));
  }

  snapshot(): FakeState {
    return structuredClone(this.#state);
  }
  restore(snapshot: FakeState): void {
    this.#state = structuredClone(snapshot);
    this.#faults.clear();
    this.#faultCounts.clear();
  }
  inspectState(): Readonly<FakeState> {
    return structuredClone(this.#state);
  }

  acceptSource(input: AcceptSourceRequest) {
    return this.mutate<AcceptedSourceSnapshot, "acceptSource">(
      "acceptSource",
      input,
      (request) => {
        const known = this.#state.sources.find(
          (s) =>
            s.chatJid === request.chatJid && s.sourceId === request.sourceId,
        );
        if (known)
          return this.#state.sourceHashes[
            sourceKey(request.chatJid, request.sourceId)
          ] === fakeSemanticSourceHash(request)
            ? this.apply(known, true)
            : this.reject("idempotency_conflict");
        if (
          request.parentSourceSeq !== null &&
          !this.source(request.chatJid, request.parentSourceSeq)
        )
          return this.reject("not_found");
        if (request.targetOperationId !== null) {
          const target = this.operation(request.targetOperationId);
          if (
            !target ||
            target.chatJid !== request.chatJid ||
            target.phase === "terminal"
          ) {
            return this.reject("owner_conflict", {
              conflictingOperationId: request.targetOperationId,
            });
          }
        }
        const sourceSeq = this.#state.nextByChat[request.chatJid] ?? 1;
        this.#state.nextByChat[request.chatJid] = sourceSeq + 1;
        const source = freezeSource({
          chatJid: request.chatJid,
          sourceSeq,
          sourceId: request.sourceId,
          kind: request.kind,
          state: "pending",
          payloadRef: request.payloadRef,
          targetOperationId: request.targetOperationId,
          parentSourceSeq: request.parentSourceSeq,
          acceptedAt: request.acceptedAt,
          dispositionReason: null,
          provenanceRef: request.effect.provenanceRef,
        });
        this.#state.sources.push(source);
        this.#state.sourceHashes[sourceKey(request.chatJid, request.sourceId)] =
          fakeSemanticSourceHash(request);
        if (request.createWakeIntent)
          this.#state.wakes.push(`${request.chatJid}:${sourceSeq}`);
        return this.apply(source);
      },
    );
  }
  claimNext(input: ClaimNextSourceRequest) {
    return this.mutate<ClaimedOperation | null, "claimNext">(
      "claimNext",
      input,
      (request) => {
        if (request.expectedFrontier !== 0)
          return this.reject("frontier_mismatch", { observedFrontier: 0 });
        const active = this.#state.activeByChat[request.chatJid];
        if (active)
          return this.reject("owner_conflict", {
            conflictingOperationId: active,
          });
        const source = this.#state.sources
          .filter(
            (s) =>
              s.chatJid === request.chatJid &&
              s.state === "pending" &&
              s.sourceSeq > request.expectedFrontier,
          )
          .sort((a, b) => a.sourceSeq - b.sourceSeq)[0];
        if (!source) return this.apply(null);
        if (this.operation(request.newOperationId))
          return this.reject("owner_conflict", {
            conflictingOperationId: request.newOperationId,
          });
        const claimed = freezeSource({ ...source, state: "claimed" });
        this.replaceSource(claimed);
        const operation = freezeOperation({
          operationId: request.newOperationId,
          chatJid: request.chatJid,
          version: 1,
          phase: "claimed",
          primarySourceSeq: source.sourceSeq,
          claimedSourceSeqs: [source.sourceSeq],
          cancellation: null,
          harness: null,
          terminal: null,
        });
        this.#state.operations.push(operation);
        this.#state.activeByChat[request.chatJid] = operation.operationId;
        return this.apply(Object.freeze({ source: claimed, operation }));
      },
    );
  }
  appendIntent(input: AppendOperationIntentRequest) {
    return this.mutate<OperationSnapshot, "appendIntent">(
      "appendIntent",
      input,
      (request) => {
        const existing = this.operation(request.effect.operationId);
        if (!existing) return this.reject("not_found");
        if (existing.phase === "terminal")
          return this.reject("owner_conflict", {
            conflictingOperationId: existing.operationId,
          });
        const key = `${existing.operationId}\0${request.intentId}`;
        if (
          this.#state.intents.some(
            (i) =>
              i.operationId === existing.operationId &&
              i.intentId === request.intentId,
          )
        )
          return this.#state.intentHashes[key] ===
            fakeSemanticIntentHash(request)
            ? this.apply(existing, true)
            : this.reject("idempotency_conflict");
        if (existing.version !== request.expectedVersion)
          return this.reject("version_mismatch", {
            observedVersion: existing.version,
          });
        this.#state.intents.push({
          operationId: existing.operationId,
          intentId: request.intentId,
          kind: request.kind,
          payloadRef: request.payloadRef,
          createdAt: request.createdAt,
        });
        this.#state.intentHashes[key] = fakeSemanticIntentHash(request);
        return this.apply(
          this.update(existing, { version: existing.version + 1 }),
        );
      },
    );
  }
  acceptCancellation(input: AcceptCancellationRequest) {
    return this.mutate<OperationSnapshot, "acceptCancellation">(
      "acceptCancellation",
      input,
      (request) => {
        const existing = this.operation(request.effect.operationId);
        if (!existing) return this.reject("not_found");
        if (existing.phase === "terminal")
          return this.reject("owner_conflict", {
            conflictingOperationId: existing.operationId,
          });
        if (existing.cancellation)
          return existing.cancellation.sourceSeq === request.sourceSeq &&
            existing.cancellation.cause === request.cause &&
            existing.cancellation.requestedAt === request.requestedAt &&
            this.source(existing.chatJid, request.sourceSeq)?.sourceId ===
              request.sourceId
            ? this.apply(existing, true)
            : this.reject("owner_conflict", {
                conflictingOperationId: existing.operationId,
              });
        const op = this.version(
          request.effect.operationId,
          request.expectedVersion,
        );
        if (!op.ok) return op;
        const source = this.source(op.value.chatJid, request.sourceSeq);
        if (
          !source ||
          source.sourceId !== request.sourceId ||
          source.targetOperationId !== op.value.operationId
        )
          return this.reject("owner_conflict", {
            conflictingOperationId: op.value.operationId,
          });
        return this.apply(
          this.update(op.value, {
            version: op.value.version + 1,
            phase: "cancelling",
            cancellation: Object.freeze({
              sourceSeq: request.sourceSeq,
              cause: request.cause,
              requestedAt: request.requestedAt,
            }),
          }),
        );
      },
    );
  }
  bindHarness(input: BindHarnessRequest) {
    return this.mutate<OperationSnapshot, "bindHarness">(
      "bindHarness",
      input,
      (request) => {
        const existing = this.operation(request.effect.operationId);
        if (!existing) return this.reject("not_found");
        if (existing.phase === "terminal")
          return this.reject("owner_conflict", {
            conflictingOperationId: existing.operationId,
          });
        if (existing.harness)
          return existing.harness.sessionId === request.sessionId &&
            existing.harness.lane === request.lane &&
            existing.harness.harnessOperationId ===
              request.harnessOperationId &&
            existing.harness.state === request.state &&
            existing.harness.watchGeneration === request.watchGeneration
            ? this.apply(existing, true)
            : this.reject("owner_conflict", {
                conflictingOperationId: existing.operationId,
              });
        const op = this.version(
          request.effect.operationId,
          request.expectedVersion,
        );
        if (!op.ok) return op;
        return this.apply(
          this.update(op.value, {
            version: op.value.version + 1,
            phase:
              request.state === "running"
                ? "executing"
                : request.state === "suspended"
                  ? "suspended"
                  : request.state === "aborting"
                    ? "cancelling"
                    : request.state === "finished"
                      ? "settling"
                      : "starting_harness",
            harness: Object.freeze({
              sessionId: request.sessionId,
              lane: request.lane,
              harnessOperationId: request.harnessOperationId,
              state: request.state,
              watchGeneration: request.watchGeneration,
            }),
          }),
        );
      },
    );
  }
  recordQueuedInput(input: RecordQueuedInputRequest) {
    return this.mutate<OperationSnapshot, "recordQueuedInput">(
      "recordQueuedInput",
      input,
      (request) => {
        const op = this.version(
          request.effect.operationId,
          request.expectedVersion,
        );
        if (!op.ok) return op;
        const source = this.source(op.value.chatJid, request.sourceSeq);
        if (!source) return this.reject("not_found");
        const known = this.#state.queues.find(
          (q) =>
            q.operationId === op.value.operationId &&
            q.sourceSeq === request.sourceSeq,
        );
        if (!known) {
          if (
            request.state !== "accepted" ||
            request.harnessEntryId !== null ||
            source.state !== "pending" ||
            (source.targetOperationId !== op.value.operationId &&
              source.sourceSeq !== op.value.primarySourceSeq)
          )
            return this.reject("invalid_transition");
          this.#state.queues.push({
            operationId: op.value.operationId,
            sourceSeq: request.sourceSeq,
            queueKind: request.queueKind,
            harnessEntryId: request.harnessEntryId,
            state: request.state,
          });
          this.replaceSource(freezeSource({ ...source, state: "claimed" }));
        } else {
          if (
            known.queueKind !== request.queueKind ||
            !validEntryTransition(
              known.state,
              known.harnessEntryId,
              request.state,
              request.harnessEntryId,
            ) ||
            !transition(known.state, request.state)
          )
            return this.reject("invalid_transition");
          known.state = request.state;
          known.harnessEntryId = request.harnessEntryId;
          if (request.state !== "accepted")
            this.replaceSource(
              freezeSource({ ...source, state: request.state }),
            );
        }
        return this.apply(
          this.update(op.value, {
            version: op.value.version + 1,
            claimedSourceSeqs: op.value.claimedSourceSeqs.includes(
              source.sourceSeq,
            )
              ? op.value.claimedSourceSeqs
              : [...op.value.claimedSourceSeqs, source.sourceSeq],
          }),
        );
      },
    );
  }
  async getOperation(
    id: string,
  ): Promise<ResultValue<OperationSnapshot | null, ServiceWorkError>> {
    const value = normaliseFakeReadIdentifier(id);
    return value === null
      ? Result.err(error("invalid_transition"))
      : Result.ok(this.operation(value) ?? null);
  }
  async getChatFrontier(
    chatJid: string,
  ): Promise<ResultValue<ChatFrontierSnapshot, ServiceWorkError>> {
    const id = normaliseFakeReadIdentifier(chatJid);
    if (id === null) return Result.err(error("invalid_transition"));
    const next =
      this.#state.sources
        .filter((s) => s.chatJid === id && s.state === "pending")
        .sort((a, b) => a.sourceSeq - b.sourceSeq)[0]?.sourceSeq ?? null;
    return Result.ok(
      Object.freeze({
        chatJid: id,
        consumedThroughSourceSeq: 0,
        activeOperationId: this.#state.activeByChat[id] ?? null,
        nextPendingSourceSeq: next,
      }),
    );
  }
  async listOpenOperations(
    input: ListOpenOperationsRequest = {},
  ): Promise<ResultValue<readonly OperationSnapshot[], ServiceWorkError>> {
    const request = normaliseFakeListRequest(input);
    if (!request) return Result.err(error("invalid_transition"));
    const values = this.#state.operations
      .filter(
        (op) =>
          op.phase !== "terminal" &&
          (!request.chatJid || op.chatJid === request.chatJid) &&
          op.operationId > (request.afterOperationId ?? ""),
      )
      .sort((a, b) => a.operationId.localeCompare(b.operationId))
      .slice(0, request.limit ?? 100);
    return Result.ok(Object.freeze(values));
  }

  private async mutate<T, TMethod extends FakeMutationMethod>(
    method: TMethod,
    input: unknown,
    apply: (request: FakeMutationRequests[TMethod]) => Outcome<T>,
  ): Promise<ResultValue<T, ServiceWorkError>> {
    // The method discriminator and closed normalizer branch define this type.
    const request = normaliseFakeMutationRequest(method, input) as
      FakeMutationRequests[TMethod] | null;
    const previous = this.#serial;
    let release!: () => void;
    this.#serial = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      this.recordTrace({
        contract: "EF-S01",
        method,
        effectId: request?.effect?.idempotencyKey ?? "invalid",
        operationId: request?.effect?.operationId ?? null,
        sourceSeq: request?.effect?.sourceSeq ?? null,
      });
      if (!request?.effect)
        return this.finish(method, request, this.reject("invalid_transition"));
      const beforeFault = this.hitFault(method, "before_effect");
      if (!beforeFault.ok || beforeFault.injected)
        return this.finish(
          method,
          request,
          this.reject("storage_unavailable", {}, "not_applied", true),
        );
      const key = request.effect.idempotencyKey;
      const known = this.#state.decisions[key];
      if (known) {
        if (
          known.method !== method ||
          known.hash !== request.effect.requestHash
        )
          return this.finish(
            method,
            request,
            this.reject("idempotency_conflict"),
          );
        const replay = structuredClone(known.value) as Outcome<T>;
        return this.finish(
          method,
          request,
          replay.ok ? this.apply(replay.value, true) : replay,
        );
      }
      const before = structuredClone(this.#state);
      const outcome = apply(request);
      if (!outcome.ok) {
        this.#state = before;
        return this.finish(method, request, outcome);
      }
      const transactionFault = this.hitFault(method, "before_effect");
      if (!transactionFault.ok || transactionFault.injected) {
        this.#state = before;
        return this.finish(
          method,
          request,
          this.reject("storage_unavailable", {}, "not_applied", true),
        );
      }
      this.#state.decisions[key] = {
        method,
        hash: request.effect.requestHash,
        value: structuredClone(outcome),
      };
      const acknowledgementFault = this.hitFault(
        method,
        "effect_then_lost_acknowledgement",
      );
      if (acknowledgementFault.ok && acknowledgementFault.injected)
        return this.finish(
          method,
          request,
          this.reject("storage_unavailable", {}, "unknown", true),
        );
      // An invalid observational callback cannot make a known commit uncertain.
      return this.finish(method, request, outcome);
    } catch (caught) {
      void caught;
      return this.finish(
        method,
        request,
        this.reject("storage_unavailable", {}, "not_applied", true),
      );
    } finally {
      release();
    }
  }
  private hitFault(
    method: string,
    point: "before_effect" | "effect_then_lost_acknowledgement",
  ):
    { readonly ok: true; readonly injected: boolean } | { readonly ok: false } {
    const key = `${method}:${point}`;
    const planned = this.#faults.get(key);
    if (planned) {
      const occurrence = (this.#faultCounts.get(key) ?? 0) + 1;
      this.#faultCounts.set(key, occurrence);
      return { ok: true, injected: planned.has(occurrence) };
    }
    try {
      const value: unknown = this.#runtimeFault(point);
      return value === true || value === false
        ? { ok: true, injected: value }
        : { ok: false };
    } catch (caught) {
      void caught;
      return { ok: false };
    }
  }
  private finish<T>(
    method: string,
    request: NormalisedFakeMutationRequest | null,
    outcome: Outcome<T>,
  ): ResultValue<T, ServiceWorkError> {
    if (outcome.ok) {
      this.recordTrace({
        contract: "EF-S01",
        method,
        effectId: request?.effect.idempotencyKey ?? "invalid",
        operationId: request?.effect.operationId ?? null,
        sourceSeq: request?.effect.sourceSeq ?? null,
        certainty: "applied",
        resultTag: outcome.duplicate ? "duplicate" : "ok",
      });
      return Result.ok(outcome.value);
    }
    this.recordTrace({
      contract: "EF-S01",
      method,
      effectId: request?.effect?.idempotencyKey ?? "invalid",
      operationId: request?.effect?.operationId ?? null,
      sourceSeq: request?.effect?.sourceSeq ?? null,
      certainty: outcome.error.certainty,
      resultTag: outcome.error._tag,
    });
    return Result.err(outcome.error);
  }
  private recordTrace(input: NormalisedTraceInput): void {
    try {
      if (input.resultTag === undefined || input.resultTag === "call")
        this.trace.recordCall(input);
      else this.trace.recordResult(input);
    } catch (caught) {
      void caught;
      // Internal trace inspection is observational.
    }
    try {
      this.#traceObserver(input);
    } catch (caught) {
      void caught;
      // Injected trace observers cannot alter fake durable semantics.
    }
  }

  private source(chat: string, seq: number) {
    return this.#state.sources.find(
      (s) => s.chatJid === chat && s.sourceSeq === seq,
    );
  }
  private operation(id: string) {
    return this.#state.operations.find((o) => o.operationId === id);
  }
  private replaceSource(source: AcceptedSourceSnapshot) {
    const index = this.#state.sources.findIndex(
      (s) => s.chatJid === source.chatJid && s.sourceSeq === source.sourceSeq,
    );
    this.#state.sources[index] = source;
  }
  private update(
    operation: OperationSnapshot,
    update: Partial<OperationSnapshot>,
  ): OperationSnapshot {
    const next = freezeOperation({ ...operation, ...update });
    this.#state.operations[
      this.#state.operations.findIndex(
        (o) => o.operationId === operation.operationId,
      )
    ] = next;
    return next;
  }
  private version(
    id: string,
    version: number,
  ):
    | { ok: true; value: OperationSnapshot }
    | { ok: false; error: ServiceWorkError } {
    const op = this.operation(id);
    return !op
      ? this.reject("not_found")
      : op.phase === "terminal"
        ? this.reject("owner_conflict", {
            conflictingOperationId: op.operationId,
          })
        : op.version !== version
          ? this.reject("version_mismatch", { observedVersion: op.version })
          : { ok: true, value: op };
  }
  private apply<T>(value: T, duplicate = false): Outcome<T> {
    return { ok: true, value: deepFreeze(value), duplicate };
  }
  private reject(
    tag: ServiceWorkErrorTag,
    details: Partial<ServiceWorkError> = {},
    certainty: ServiceWorkError["certainty"] = "not_applied",
    retryable = false,
  ): { ok: false; error: ServiceWorkError } {
    return { ok: false, error: error(tag, certainty, retryable, details) };
  }
}

type Outcome<T> =
  | { ok: true; value: T; duplicate: boolean }
  | { ok: false; error: ServiceWorkError };
function error(
  tag: ServiceWorkErrorTag,
  certainty: ServiceWorkError["certainty"] = "not_applied",
  retryable = false,
  details: Partial<ServiceWorkError> = {},
): ServiceWorkError {
  return Object.freeze({
    _tag: tag,
    certainty,
    retryable,
    ...(details.observedVersion !== undefined
      ? { observedVersion: details.observedVersion }
      : {}),
    ...(details.observedFrontier !== undefined
      ? { observedFrontier: details.observedFrontier }
      : {}),
    ...(details.conflictingOperationId
      ? { conflictingOperationId: details.conflictingOperationId }
      : {}),
  });
}
function freezeSource(value: AcceptedSourceSnapshot): AcceptedSourceSnapshot {
  return Object.freeze({ ...value });
}
function freezeOperation(value: OperationSnapshot): OperationSnapshot {
  return Object.freeze({
    ...value,
    claimedSourceSeqs: Object.freeze([...value.claimedSourceSeqs]),
  });
}
function transition(from: string, to: string): boolean {
  return (
    (from === "accepted" && (to === "queued" || to === "disposed")) ||
    (from === "queued" && (to === "consumed" || to === "disposed"))
  );
}
function validEntryTransition(
  from: string,
  previous: string | null,
  to: string,
  next: string | null,
): boolean {
  if (from === "accepted" && to === "queued")
    return previous === null && typeof next === "string" && next.length > 0;
  return previous === next;
}
function sourceKey(chatJid: string, sourceId: string): string {
  return JSON.stringify([chatJid, sourceId]);
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}
