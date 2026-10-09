import { Result, type Result as ResultValue } from "../contracts/result.js";

import type { EffectPayloadResolver, ResolvedEffectPayload } from "../contracts/payload-resolver.js";
import type {
  DeliveryAttempt,
  DeliveryBoundary,
  DeliveryDriver,
  DeliveryDriverError,
  DeliveryKind,
  DeliveryOutcome,
  DeliveryPayloadValidator,
  DeliveryProviderDetail,
  WebPushDeliveryCounts,
} from "../contracts/delivery-driver.js";
import { resolveVerifiedPayload } from "../payloads.js";
import type { CurrentPiclawAdapterRuntime } from "./adapter-runtime.js";

export class CurrentPiclawDeliveryDriver implements DeliveryDriver {
  constructor(
    readonly kind: DeliveryKind,
    private readonly payloads: EffectPayloadResolver,
    private readonly validatePayload: DeliveryPayloadValidator,
    private readonly boundary: DeliveryBoundary,
    private readonly runtime: CurrentPiclawAdapterRuntime,
  ) {}

  async deliver(candidate: unknown): Promise<ResultValue<DeliveryOutcome, DeliveryDriverError>> {
    const request = normaliseRequest(candidate);
    if (!request) return this.invalid("invalid-outbox", "invalid_payload");
    this.call(request);
    const initiallyAborted = safeAborted(request.signal);
    if (initiallyAborted === null) return this.fail(request, "invalid_payload", "not_applied", false);
    if (initiallyAborted) return this.fail(request, "aborted", "not_applied", false);
    if (!request.destinationRef?.trim()) return this.fail(request, "destination_missing", "not_applied", false);

    let payload: ResolvedEffectPayload | null;
    try {
      payload = await resolveVerifiedPayload(this.payloads, request.payloadRef);
    } catch {
      return this.fail(request, "invalid_payload", "not_applied", false);
    }
    if (!payload) return this.fail(request, "invalid_payload", "not_applied", false);
    const immutablePayload = snapshotPayload(payload);
    try {
      if (this.validatePayload(this.kind, request, immutablePayload) !== true) {
        return this.fail(request, "invalid_payload", "not_applied", false);
      }
    } catch {
      return this.fail(request, "invalid_payload", "not_applied", false);
    }
    const abortedAfterResolution = safeAborted(request.signal);
    if (abortedAfterResolution === null) return this.fail(request, "invalid_payload", "not_applied", false);
    if (abortedAfterResolution) return this.fail(request, "aborted", "not_applied", false);
    if (this.runtime.hitFault("before_effect")) return this.fail(request, "transport_unavailable", "not_applied", true);

    try {
      const success = await this.boundary.attempt({ request, payload: immutablePayload });
      if (!validBoundarySuccess(this.kind, request, success)) return this.fail(request, "transport_unavailable", "unknown", true);
      const certainty = certaintyFor(success.detail);
      const outcome = Object.freeze({
        certainty,
        acceptedAt: success.acceptedAt,
        receiptRef: success.receiptRef,
        detail: freezeDetail(success.detail),
      });
      this.runtime.recordTrace({ contract: "EF-S06", method: "deliver", effectId: request.outboxId, certainty, resultTag: success.detail.kind });
      return Result.ok(outcome);
    } catch (error) {
      let classified: DeliveryDriverError | null | undefined;
      try { classified = this.boundary.classifyError?.(error); } catch { classified = null; }
      return validClassifiedError(classified)
        ? this.fail(request, classified._tag, classified.certainty, classified.retryable, classified.retryAfter)
        : this.fail(request, "transport_unavailable", "unknown", true);
    }
  }

  private invalid(effectId: string, tag: DeliveryDriverError["_tag"]): ResultValue<never, DeliveryDriverError> {
    this.runtime.recordTrace({ contract: "EF-S06", method: "deliver", effectId, certainty: null, resultTag: "call" });
    this.runtime.recordTrace({ contract: "EF-S06", method: "deliver", effectId, certainty: "not_applied", resultTag: tag });
    return Result.err(Object.freeze({ _tag: tag, certainty: "not_applied", retryable: false }));
  }

  private call(request: DeliveryAttempt): void {
    this.runtime.recordTrace({ contract: "EF-S06", method: "deliver", effectId: request.outboxId, certainty: null, resultTag: "call" });
  }

  private fail(
    request: DeliveryAttempt,
    tag: DeliveryDriverError["_tag"],
    certainty: DeliveryDriverError["certainty"],
    retryable: boolean,
    retryAfter?: string,
  ): ResultValue<never, DeliveryDriverError> {
    this.runtime.recordTrace({ contract: "EF-S06", method: "deliver", effectId: request.outboxId, certainty, resultTag: tag });
    return Result.err(Object.freeze({ _tag: tag, certainty, retryable, ...(retryAfter ? { retryAfter } : {}) }));
  }
}

function normaliseRequest(value: unknown): DeliveryAttempt | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const candidate = value as Record<string, unknown>;
    const outboxId = candidate.outboxId;
    const idempotencyKey = candidate.idempotencyKey;
    const payloadRef = candidate.payloadRef;
    const destinationRef = candidate.destinationRef;
    const deliveryIdentity = candidate.deliveryIdentity;
    const attempt = candidate.attempt;
    const signal = candidate.signal;
    if (candidate.outboxId !== outboxId || candidate.idempotencyKey !== idempotencyKey || candidate.payloadRef !== payloadRef || candidate.destinationRef !== destinationRef || candidate.deliveryIdentity !== deliveryIdentity || candidate.attempt !== attempt || candidate.signal !== signal) return null;
    if (!nonBlankString(outboxId) || !nonBlankString(idempotencyKey) || !nonBlankString(payloadRef) || !nonBlankString(destinationRef) || !nonBlankString(deliveryIdentity) || !Number.isSafeInteger(attempt) || (attempt as number) < 1 || !isAbortSignalCompatible(signal)) return null;
    return Object.freeze({ outboxId, idempotencyKey, payloadRef, destinationRef: destinationRef.trim(), deliveryIdentity, attempt: attempt as number, signal });
  } catch { return null; }
}
function isAbortSignalCompatible(value: unknown): value is AbortSignal {
  return Boolean(value && typeof value === "object" && typeof (value as AbortSignal).aborted === "boolean" && typeof (value as AbortSignal).addEventListener === "function" && typeof (value as AbortSignal).removeEventListener === "function");
}
function safeAborted(signal: AbortSignal): boolean | null { try { return typeof signal.aborted === "boolean" ? signal.aborted : null; } catch { return null; } }
function nonEmptyString(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function nonBlankString(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }

const ERROR_TAGS = new Set<DeliveryDriverError["_tag"]>(["invalid_payload", "destination_missing", "rejected", "rate_limited", "timeout", "transport_unavailable", "aborted"]);
function validClassifiedError(error: DeliveryDriverError | null | undefined): error is DeliveryDriverError {
  try {
    if (!error || !ERROR_TAGS.has(error._tag) || (error.certainty !== "not_applied" && error.certainty !== "unknown") || typeof error.retryable !== "boolean") return false;
    if (["aborted", "invalid_payload", "destination_missing", "rejected"].includes(error._tag) && (error.certainty !== "not_applied" || error.retryable)) return false;
    if (error._tag === "rate_limited") return error.certainty === "not_applied" && error.retryable && typeof error.retryAfter === "string" && nonEmptyInstant(error.retryAfter);
    return error.retryAfter === undefined;
  } catch { return false; }
}

function validBoundarySuccess(kind: DeliveryKind, request: DeliveryAttempt, success: { acceptedAt: string; receiptRef: string | null; detail: DeliveryProviderDetail }): boolean {
  try {
    if (!success || typeof success !== "object" || !nonEmptyInstant(success.acceptedAt) || (success.receiptRef !== null && !nonEmptyString(success.receiptRef)) || !success.detail || typeof success.detail !== "object") return false;
    if (success.detail.kind !== kind) return false;
    if (kind === "timeline_broadcast" && success.detail.kind === kind) return success.detail.providerMessageId === null && success.detail.eventId === request.deliveryIdentity;
    if (kind === "wake_chat" && success.detail.kind === kind) return success.detail.providerMessageId === null && success.detail.wakeId === request.deliveryIdentity;
    if (kind === "web_push" && success.detail.kind === kind) return success.detail.providerMessageId === null && validCounts(success.detail.counts);
    return (success.detail.kind === "channel_delivery" || success.detail.kind === "pushover") && (success.detail.providerMessageId === null || nonEmptyString(success.detail.providerMessageId));
  } catch { return false; }
}
function validCounts(counts: WebPushDeliveryCounts): boolean {
  const values = [counts.attempted, counts.sent, counts.removed, counts.failed];
  return values.every((value) => Number.isSafeInteger(value) && value >= 0) && counts.attempted === counts.sent + counts.removed + counts.failed;
}

function nonEmptyInstant(value: string): boolean { return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value)); }

function certaintyFor(detail: DeliveryProviderDetail): DeliveryOutcome["certainty"] {
  if (detail.kind !== "web_push") return "applied";
  if (detail.counts.attempted === 0) return "not_applied";
  return detail.counts.failed > 0 ? "unknown" : "applied";
}

function freezeDetail(detail: DeliveryProviderDetail): DeliveryProviderDetail {
  if (detail.kind === "web_push") return Object.freeze({ ...detail, counts: freezeCounts(detail.counts) });
  return Object.freeze({ ...detail });
}

function freezeCounts(counts: WebPushDeliveryCounts): WebPushDeliveryCounts {
  return Object.freeze({ attempted: counts.attempted, sent: counts.sent, removed: counts.removed, failed: counts.failed });
}

function snapshotPayload(payload: ResolvedEffectPayload): ResolvedEffectPayload {
  return Object.freeze({ ...payload, bytes: new Uint8Array(payload.bytes) });
}
