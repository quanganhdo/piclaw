import { createHash } from "node:crypto";
import { Result, type Result as ResultValue } from "../../contracts/result.js";

import type { NormalisedEffectTrace } from "../../contracts/common.js";
import type { DeliveryAttempt, DeliveryDriver, DeliveryDriverError, DeliveryKind, DeliveryOutcome, DeliveryPayloadValidator, WebPushDeliveryCounts } from "../../contracts/delivery-driver.js";
import type { EffectPayloadResolver } from "../../contracts/payload-resolver.js";
import { EffectTraceRecorder } from "../trace-recorder.js";

export type ScriptedDeliveryStep =
  | { readonly _tag: "outcome"; readonly outcome: DeliveryOutcome }
  | { readonly _tag: "error"; readonly error: DeliveryDriverError }
  | { readonly _tag: "delay"; readonly gate: Promise<void>; readonly next: ScriptedDeliveryStep };

export class FakeDeliveryDriver implements DeliveryDriver {
  readonly trace: EffectTraceRecorder;
  private readonly steps: ScriptedDeliveryStep[] = [];
  private attempts = 0;
  private observedPayload: Uint8Array | null = null;
  private classifierThrows = false;

  constructor(
    readonly kind: DeliveryKind,
    private readonly payloads: EffectPayloadResolver,
    private readonly validatePayload: DeliveryPayloadValidator,
    traceSnapshot: readonly NormalisedEffectTrace[] = [],
    private readonly observeExternalAttempt: () => void = () => {},
  ) { this.trace = EffectTraceRecorder.fromSnapshot(traceSnapshot); }

  script(...steps: readonly ScriptedDeliveryStep[]): void { this.steps.push(...steps); }
  countAttempts(): number { return this.attempts; }
  observedPayloadBytes(): Uint8Array | null { return this.observedPayload ? new Uint8Array(this.observedPayload) : null; }
  throwClassifierOnce(): void { this.classifierThrows = true; }

  async deliver(candidate: unknown): Promise<ResultValue<DeliveryOutcome, DeliveryDriverError>> {
    const request = normaliseRequest(candidate);
    const effectId = request?.outboxId ?? "invalid-outbox";
    this.trace.recordCall({ contract: "EF-S06", method: "deliver", effectId });
    if (!request) return this.fail(effectId, Object.freeze({ _tag: "invalid_payload", certainty: "not_applied", retryable: false }));
    const initiallyAborted = safeAborted(request.signal);
    if (initiallyAborted === null) return this.fail(effectId, Object.freeze({ _tag: "invalid_payload", certainty: "not_applied", retryable: false }));
    if (initiallyAborted) return this.fail(effectId, Object.freeze({ _tag: "aborted", certainty: "not_applied", retryable: false }));
    if (![request.outboxId, request.idempotencyKey, request.payloadRef, request.deliveryIdentity].every((value) => typeof value === "string" && value.length > 0) || !Number.isSafeInteger(request.attempt) || request.attempt < 1) {
      return this.fail(effectId, Object.freeze({ _tag: "invalid_payload", certainty: "not_applied", retryable: false }));
    }
    if (!request.destinationRef?.trim()) return this.fail(effectId, Object.freeze({ _tag: "destination_missing", certainty: "not_applied", retryable: false }));
    let payload;
    try { payload = await this.payloads.resolve(request.payloadRef); } catch { payload = null; }
    if (!payload || payload.ref !== request.payloadRef || payload.byteLength !== payload.bytes.byteLength || payload.sha256 !== createHash("sha256").update(payload.bytes).digest("hex")) {
      return this.fail(effectId, Object.freeze({ _tag: "invalid_payload", certainty: "not_applied", retryable: false }));
    }
    const immutablePayload = Object.freeze({ ...payload, bytes: new Uint8Array(payload.bytes) });
    try {
      if (this.validatePayload(this.kind, request, immutablePayload) !== true) return this.fail(effectId, Object.freeze({ _tag: "invalid_payload", certainty: "not_applied", retryable: false }));
    } catch {
      return this.fail(effectId, Object.freeze({ _tag: "invalid_payload", certainty: "not_applied", retryable: false }));
    }
    const abortedAfterResolution = safeAborted(request.signal);
    if (abortedAfterResolution === null) return this.fail(effectId, Object.freeze({ _tag: "invalid_payload", certainty: "not_applied", retryable: false }));
    if (abortedAfterResolution) return this.fail(effectId, Object.freeze({ _tag: "aborted", certainty: "not_applied", retryable: false }));
    this.observedPayload = new Uint8Array(immutablePayload.bytes);
    this.attempts += 1; this.observeExternalAttempt();
    let step = this.steps.shift() ?? { _tag: "error", error: Object.freeze({ _tag: "transport_unavailable", certainty: "not_applied", retryable: true }) } as const;
    while (step._tag === "delay") { await step.gate; step = step.next; }
    if (step._tag === "error") {
      if (this.classifierThrows) {
        this.classifierThrows = false;
        return this.fail(effectId, Object.freeze({ _tag: "transport_unavailable", certainty: "unknown", retryable: true }));
      }
      return validError(step.error)
        ? this.fail(effectId, step.error)
        : this.fail(effectId, Object.freeze({ _tag: "transport_unavailable", certainty: "unknown", retryable: true }));
    }
    if (!validOutcome(this.kind, request, step.outcome)) return this.fail(effectId, Object.freeze({ _tag: "transport_unavailable", certainty: "unknown", retryable: true }));
    const outcome = freezeOutcome(step.outcome);
    this.trace.recordResult({ contract: "EF-S06", method: "deliver", effectId, certainty: outcome.certainty, resultTag: outcome.detail.kind });
    return Result.ok(outcome);
  }

  private fail(effectId: string, error: DeliveryDriverError): ResultValue<never, DeliveryDriverError> {
    this.trace.recordResult({ contract: "EF-S06", method: "deliver", effectId, certainty: error.certainty, resultTag: error._tag });
    return Result.err(Object.freeze({ ...error }));
  }
}

function normaliseRequest(value: unknown): DeliveryAttempt | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const candidate = value as Record<string, unknown>;
    const outboxId = candidate.outboxId; const idempotencyKey = candidate.idempotencyKey; const payloadRef = candidate.payloadRef;
    const destinationRef = candidate.destinationRef; const deliveryIdentity = candidate.deliveryIdentity; const attempt = candidate.attempt; const signal = candidate.signal;
    if (candidate.outboxId !== outboxId || candidate.idempotencyKey !== idempotencyKey || candidate.payloadRef !== payloadRef || candidate.destinationRef !== destinationRef || candidate.deliveryIdentity !== deliveryIdentity || candidate.attempt !== attempt || candidate.signal !== signal) return null;
    if (![outboxId, idempotencyKey, payloadRef, destinationRef, deliveryIdentity].every((entry) => typeof entry === "string" && entry.trim().length > 0) || !Number.isSafeInteger(attempt) || (attempt as number) < 1 || !isAbortSignalCompatible(signal)) return null;
    return Object.freeze({ outboxId: outboxId as string, idempotencyKey: idempotencyKey as string, payloadRef: payloadRef as string, destinationRef: (destinationRef as string).trim(), deliveryIdentity: deliveryIdentity as string, attempt: attempt as number, signal });
  } catch { return null; }
}
function isAbortSignalCompatible(value: unknown): value is AbortSignal { return Boolean(value && typeof value === "object" && typeof (value as AbortSignal).aborted === "boolean" && typeof (value as AbortSignal).addEventListener === "function" && typeof (value as AbortSignal).removeEventListener === "function"); }
function safeAborted(signal: AbortSignal): boolean | null { try { return typeof signal.aborted === "boolean" ? signal.aborted : null; } catch { return null; } }
const TAGS = new Set(["invalid_payload", "destination_missing", "rejected", "rate_limited", "timeout", "transport_unavailable", "aborted"]);
function validError(error: DeliveryDriverError): boolean {
  try {
    if (!error || !TAGS.has(error._tag) || (error.certainty !== "not_applied" && error.certainty !== "unknown") || typeof error.retryable !== "boolean") return false;
    if (["aborted", "invalid_payload", "destination_missing", "rejected"].includes(error._tag) && (error.certainty !== "not_applied" || error.retryable)) return false;
    if (error._tag === "rate_limited") return error.certainty === "not_applied" && error.retryable && typeof error.retryAfter === "string" && error.retryAfter.length > 0 && Number.isFinite(Date.parse(error.retryAfter));
    return error.retryAfter === undefined;
  } catch { return false; }
}
function validOutcome(kind: DeliveryKind, request: DeliveryAttempt, outcome: DeliveryOutcome): boolean {
  try {
    if (!outcome || typeof outcome !== "object" || typeof outcome.acceptedAt !== "string" || !Number.isFinite(Date.parse(outcome.acceptedAt)) || (outcome.receiptRef !== null && (typeof outcome.receiptRef !== "string" || outcome.receiptRef.length === 0)) || !outcome.detail || typeof outcome.detail !== "object" || outcome.detail.kind !== kind) return false;
    if (outcome.detail.kind === "timeline_broadcast") return outcome.detail.providerMessageId === null && outcome.detail.eventId === request.deliveryIdentity;
    if (outcome.detail.kind === "wake_chat") return outcome.detail.providerMessageId === null && outcome.detail.wakeId === request.deliveryIdentity;
    if (outcome.detail.kind === "web_push") return outcome.detail.providerMessageId === null && validCounts(outcome.detail.counts);
    return outcome.detail.providerMessageId === null || (typeof outcome.detail.providerMessageId === "string" && outcome.detail.providerMessageId.length > 0);
  } catch { return false; }
}
function validCounts(counts: WebPushDeliveryCounts): boolean {
  return [counts.attempted, counts.sent, counts.removed, counts.failed].every((value) => Number.isSafeInteger(value) && value >= 0) && counts.attempted === counts.sent + counts.removed + counts.failed;
}
function freezeOutcome(outcome: DeliveryOutcome): DeliveryOutcome {
  const detail = outcome.detail.kind === "web_push"
    ? Object.freeze({ ...outcome.detail, counts: Object.freeze({ ...outcome.detail.counts }) })
    : Object.freeze({ ...outcome.detail });
  const certainty = detail.kind === "web_push" ? (detail.counts.attempted === 0 ? "not_applied" : detail.counts.failed > 0 ? "unknown" : "applied") : "applied";
  return Object.freeze({ ...outcome, certainty, detail });
}
