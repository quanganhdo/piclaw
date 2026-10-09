import type { Result } from "./result.js";

import type { EffectCertainty, PiclawEffectError } from "./common.js";
import type { ResolvedEffectPayload } from "./payload-resolver.js";

export type DeliveryKind =
  | "timeline_broadcast"
  | "channel_delivery"
  | "web_push"
  | "pushover"
  | "wake_chat";

export interface DeliveryAttempt {
  readonly outboxId: string;
  readonly idempotencyKey: string;
  readonly payloadRef: string;
  readonly destinationRef: string | null;
  /** Caller-owned stable identity for this external delivery attempt. */
  readonly deliveryIdentity: string;
  readonly attempt: number;
  readonly signal: AbortSignal;
}

export type DeliveryReconcileRequest = Omit<DeliveryAttempt, "signal">;

export interface WebPushDeliveryCounts {
  readonly attempted: number;
  readonly sent: number;
  readonly removed: number;
  readonly failed: number;
}

export type DeliveryProviderDetail =
  | { readonly kind: "timeline_broadcast"; readonly providerMessageId: null; readonly eventId: string }
  | { readonly kind: "channel_delivery"; readonly providerMessageId: string | null }
  | { readonly kind: "web_push"; readonly providerMessageId: null; readonly counts: WebPushDeliveryCounts }
  | { readonly kind: "pushover"; readonly providerMessageId: string | null }
  | { readonly kind: "wake_chat"; readonly providerMessageId: null; readonly wakeId: string };

export interface DeliveryOutcome {
  readonly certainty: EffectCertainty;
  readonly acceptedAt: string;
  readonly receiptRef: string | null;
  readonly detail: DeliveryProviderDetail;
}

export type DeliveryDriverErrorTag =
  | "invalid_payload"
  | "destination_missing"
  | "rejected"
  | "rate_limited"
  | "timeout"
  | "transport_unavailable"
  | "aborted";

export interface DeliveryDriverError extends PiclawEffectError<DeliveryDriverErrorTag> {
  readonly _tag: DeliveryDriverErrorTag;
  readonly retryAfter?: string;
}

export interface DeliveryDriver {
  readonly kind: DeliveryKind;
  deliver(request: DeliveryAttempt): Promise<Result<DeliveryOutcome, DeliveryDriverError>>;
  reconcile?(request: DeliveryReconcileRequest): Promise<Result<DeliveryOutcome | null, DeliveryDriverError>>;
}

export interface DeliveryBoundarySuccess {
  readonly acceptedAt: string;
  readonly receiptRef: string | null;
  readonly detail: DeliveryProviderDetail;
}

export interface DeliveryBoundaryAttempt {
  readonly request: DeliveryAttempt;
  readonly payload: ResolvedEffectPayload;
}

export interface DeliveryBoundary {
  attempt(input: DeliveryBoundaryAttempt): Promise<DeliveryBoundarySuccess>;
  classifyError?(error: unknown): DeliveryDriverError | null;
}

export type DeliveryPayloadValidator = (
  kind: DeliveryKind,
  request: DeliveryAttempt,
  payload: ResolvedEffectPayload,
) => boolean;
