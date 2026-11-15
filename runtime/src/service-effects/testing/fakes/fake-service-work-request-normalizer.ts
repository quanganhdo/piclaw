import {
  hashCanonicalRequest,
  type CanonicalJsonValue,
  type EffectIdentity,
} from "../../contracts/common.js";
import type {
  AcceptCancellationRequest,
  AcceptSourceRequest,
  AppendOperationIntentRequest,
  BindHarnessRequest,
  ClaimNextSourceRequest,
  ListOpenOperationsRequest,
  RecordQueuedInputRequest,
} from "../../contracts/service-work-store.js";

export type NormalisedFakeMutationRequest =
  | AcceptSourceRequest
  | ClaimNextSourceRequest
  | AppendOperationIntentRequest
  | AcceptCancellationRequest
  | BindHarnessRequest
  | RecordQueuedInputRequest;

export type FakeMutationMethod =
  | "acceptSource"
  | "claimNext"
  | "appendIntent"
  | "acceptCancellation"
  | "bindHarness"
  | "recordQueuedInput";

const HASH = /^[0-9a-f]{64}$/;
const SOURCE_KINDS = new Set([
  "message",
  "steer",
  "follow_up",
  "continuation",
  "control",
  "cancellation",
  "scheduled_agent",
  "internal",
]);
const INTENT_KINDS = new Set([
  "open_harness",
  "prompt",
  "queue_input",
  "abort",
  "resume",
  "settle",
  "maintenance",
]);
const QUEUE_KINDS = new Set(["steer", "follow_up", "next_run"]);
const QUEUE_STATES = new Set(["accepted", "queued", "consumed", "disposed"]);

export function normaliseFakeMutationRequest(
  method: FakeMutationMethod,
  input: unknown,
): NormalisedFakeMutationRequest | null {
  try {
    const request = record(input);
    if (!request || !isBoundedTree(input)) return null;
    const effect = normaliseEffect(request.effect);
    if (!effect) return null;

    const normalised = parseMutation(method, request, effect);
    if (!normalised) return null;
    const expectedHash = hashCanonicalRequest(
      normalised as unknown as CanonicalJsonValue,
    );
    if (effect.requestHash !== expectedHash) return null;
    return deepFreeze(normalised);
  } catch (caught) {
    void caught;
    return null;
  }
}

function parseMutation(
  method: FakeMutationMethod,
  request: Record<string, unknown>,
  effect: EffectIdentity,
): NormalisedFakeMutationRequest | null {
  switch (method) {
    case "acceptSource":
      return parseAcceptSource(request, effect);
    case "claimNext":
      return parseClaim(request, effect);
    case "appendIntent":
      return parseIntent(request, effect);
    case "acceptCancellation":
      return parseCancellation(request, effect);
    case "bindHarness":
      return parseHarness(request, effect);
    case "recordQueuedInput":
      return parseQueue(request, effect);
  }
}

function parseAcceptSource(
  value: Record<string, unknown>,
  effect: EffectIdentity,
): AcceptSourceRequest | null {
  if (
    !exactKeys(value, [
      "effect",
      "chatJid",
      "sourceId",
      "kind",
      "payloadRef",
      "targetOperationId",
      "parentSourceSeq",
      "acceptedAt",
      "createWakeIntent",
    ])
  )
    return null;
  const kind = enumValue(value.kind, SOURCE_KINDS);
  if (!kind) return null;
  return {
    effect,
    chatJid: requiredText(value.chatJid),
    sourceId: requiredText(value.sourceId),
    kind: kind as AcceptSourceRequest["kind"],
    payloadRef: requiredText(value.payloadRef),
    targetOperationId: requiredNullableText(value.targetOperationId),
    parentSourceSeq: requiredNullableSafeInteger(value.parentSourceSeq, 1),
    acceptedAt: requiredInstant(value.acceptedAt),
    createWakeIntent: requiredBoolean(value.createWakeIntent),
  };
}

function parseClaim(
  value: Record<string, unknown>,
  effect: EffectIdentity,
): ClaimNextSourceRequest | null {
  if (
    !exactKeys(value, [
      "effect",
      "chatJid",
      "expectedFrontier",
      "newOperationId",
      "claimedAt",
    ])
  )
    return null;
  return {
    effect,
    chatJid: requiredText(value.chatJid),
    expectedFrontier: requiredSafeInteger(value.expectedFrontier, 0),
    newOperationId: requiredText(value.newOperationId),
    claimedAt: requiredInstant(value.claimedAt),
  };
}

function parseIntent(
  value: Record<string, unknown>,
  effect: EffectIdentity,
): AppendOperationIntentRequest | null {
  const kind = enumValue(value.kind, INTENT_KINDS);
  if (
    !effect.operationId ||
    !kind ||
    !exactKeys(value, [
      "effect",
      "expectedVersion",
      "intentId",
      "kind",
      "payloadRef",
      "createdAt",
    ])
  )
    return null;
  return {
    effect: { ...effect, operationId: effect.operationId },
    expectedVersion: requiredSafeInteger(value.expectedVersion, 1),
    intentId: requiredText(value.intentId),
    kind: kind as AppendOperationIntentRequest["kind"],
    payloadRef: requiredText(value.payloadRef),
    createdAt: requiredInstant(value.createdAt),
  };
}

function parseCancellation(
  value: Record<string, unknown>,
  effect: EffectIdentity,
): AcceptCancellationRequest | null {
  if (
    !effect.operationId ||
    !exactKeys(value, [
      "effect",
      "expectedVersion",
      "sourceId",
      "sourceSeq",
      "cause",
      "requestedAt",
    ])
  )
    return null;
  return {
    effect: { ...effect, operationId: effect.operationId },
    expectedVersion: requiredSafeInteger(value.expectedVersion, 1),
    sourceId: requiredText(value.sourceId),
    sourceSeq: requiredSafeInteger(value.sourceSeq, 1),
    cause: requiredText(value.cause),
    requestedAt: requiredInstant(value.requestedAt),
  };
}

function parseHarness(
  value: Record<string, unknown>,
  effect: EffectIdentity,
): BindHarnessRequest | null {
  if (
    !effect.operationId ||
    !exactKeys(value, [
      "effect",
      "expectedVersion",
      "sessionId",
      "harnessOperationId",
    ])
  )
    return null;
  return {
    effect: { ...effect, operationId: effect.operationId },
    expectedVersion: requiredSafeInteger(value.expectedVersion, 1),
    sessionId: requiredText(value.sessionId),
    harnessOperationId: requiredText(value.harnessOperationId),
  };
}

function parseQueue(
  value: Record<string, unknown>,
  effect: EffectIdentity,
): RecordQueuedInputRequest | null {
  const queueKind = enumValue(value.queueKind, QUEUE_KINDS);
  const state = enumValue(value.state, QUEUE_STATES);
  if (
    !effect.operationId ||
    !queueKind ||
    !state ||
    !exactKeys(value, [
      "effect",
      "expectedVersion",
      "sourceSeq",
      "queueKind",
      "harnessEntryId",
      "state",
    ])
  )
    return null;
  return {
    effect: { ...effect, operationId: effect.operationId },
    expectedVersion: requiredSafeInteger(value.expectedVersion, 1),
    sourceSeq: requiredSafeInteger(value.sourceSeq, 1),
    queueKind: queueKind as RecordQueuedInputRequest["queueKind"],
    harnessEntryId: requiredNullableText(value.harnessEntryId),
    state: state as RecordQueuedInputRequest["state"],
  };
}

export function normaliseFakeListRequest(
  input: unknown,
): Readonly<ListOpenOperationsRequest> | null {
  try {
    if (input === undefined) return Object.freeze({});
    const value = record(input);
    if (
      !value ||
      !exactKeys(value, ["chatJid", "limit", "afterOperationId"], true)
    )
      return null;
    const chatJid =
      value.chatJid === undefined ? undefined : text(value.chatJid);
    const afterOperationId =
      value.afterOperationId === undefined
        ? undefined
        : text(value.afterOperationId);
    const limit =
      value.limit === undefined ? undefined : safeInteger(value.limit, 1);
    if (
      chatJid === null ||
      afterOperationId === null ||
      limit === null ||
      (limit !== undefined && limit > 100)
    )
      return null;
    return Object.freeze({
      ...(chatJid ? { chatJid } : {}),
      ...(afterOperationId ? { afterOperationId } : {}),
      ...(limit ? { limit } : {}),
    });
  } catch (caught) {
    void caught;
    return null;
  }
}

export function normaliseFakeReadIdentifier(input: unknown): string | null {
  try {
    return text(input);
  } catch (caught) {
    void caught;
    return null;
  }
}

export function fakeSemanticSourceHash(request: AcceptSourceRequest): string {
  return hashCanonicalRequest({
    chatJid: request.chatJid,
    sourceId: request.sourceId,
    kind: request.kind,
    payloadRef: request.payloadRef,
    targetOperationId: request.targetOperationId,
    parentSourceSeq: request.parentSourceSeq,
    acceptedAt: request.acceptedAt,
    createWakeIntent: request.createWakeIntent,
    provenanceRef: request.effect.provenanceRef,
    redactionClass: request.effect.redactionClass,
  });
}

export function fakeSemanticIntentHash(
  request: AppendOperationIntentRequest,
): string {
  return hashCanonicalRequest({
    operationId: request.effect.operationId,
    intentId: request.intentId,
    kind: request.kind,
    payloadRef: request.payloadRef,
    createdAt: request.createdAt,
  });
}

function normaliseEffect(input: unknown): EffectIdentity | null {
  const value = record(input);
  if (
    !value ||
    !exactKeys(value, [
      "idempotencyKey",
      "requestHash",
      "operationId",
      "sourceSeq",
      "provenanceRef",
      "redactionClass",
    ])
  )
    return null;
  const redactionClass = enumValue(
    value.redactionClass,
    new Set(["public", "private", "secret"]),
  );
  const requestHash =
    typeof value.requestHash === "string" && HASH.test(value.requestHash)
      ? value.requestHash
      : null;
  const operationId = nullableText(value.operationId);
  const sourceSeq = nullableSafeInteger(value.sourceSeq, 0);
  if (
    !redactionClass ||
    !requestHash ||
    operationId === undefined ||
    sourceSeq === undefined
  )
    return null;
  return Object.freeze({
    idempotencyKey: requiredText(value.idempotencyKey),
    requestHash,
    operationId,
    sourceSeq,
    provenanceRef: requiredText(value.provenanceRef),
    redactionClass: redactionClass as EffectIdentity["redactionClass"],
  });
}

function isBoundedTree(
  input: unknown,
  depth = 0,
  seen = new Set<object>(),
): boolean {
  if (depth > 8) return false;
  if (input === null || typeof input === "string" || typeof input === "boolean")
    return true;
  if (typeof input === "number") return Number.isFinite(input);
  if (typeof input !== "object") return false;
  if (seen.has(input)) return false;
  seen.add(input);
  if (Array.isArray(input)) {
    if (Object.keys(input).length !== input.length) return false;
    return input.every((entry) => isBoundedTree(entry, depth + 1, seen));
  }
  const value = record(input);
  if (!value) return false;
  return Object.values(value).every((entry) =>
    isBoundedTree(entry, depth + 1, seen),
  );
}

function record(input: unknown): Record<string, unknown> | null {
  if (input === null || typeof input !== "object" || Array.isArray(input))
    return null;
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const output: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (
      !("value" in descriptor) ||
      descriptor.enumerable !== true ||
      typeof key !== "string"
    )
      return null;
    output[key] = descriptor.value;
  }
  return output;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  allowMissing = false,
): boolean {
  const keys = Object.keys(value).sort();
  const allowed = [...expected].sort();
  return allowMissing
    ? keys.every((key) => allowed.includes(key))
    : keys.length === allowed.length &&
        keys.every((key, index) => key === allowed[index]);
}
function text(value: unknown): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.trim().length > 0
    ? value
    : null;
}
function nullableText(value: unknown): string | null | undefined {
  return value === null ? null : (text(value) ?? undefined);
}
function safeInteger(value: unknown, minimum: number): number | null {
  return Number.isSafeInteger(value) && (value as number) >= minimum
    ? (value as number)
    : null;
}
function nullableSafeInteger(
  value: unknown,
  minimum: number,
): number | null | undefined {
  return value === null ? null : (safeInteger(value, minimum) ?? undefined);
}
function enumValue(
  value: unknown,
  allowed: ReadonlySet<string>,
): string | null {
  return typeof value === "string" && allowed.has(value) ? value : null;
}
function instant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
    ? value
    : null;
}
function requiredText(value: unknown): string {
  const result = text(value);
  if (result === null) throw new TypeError();
  return result;
}
function requiredNullableText(value: unknown): string | null {
  const result = nullableText(value);
  if (result === undefined) throw new TypeError();
  return result;
}
function requiredSafeInteger(value: unknown, minimum: number): number {
  const result = safeInteger(value, minimum);
  if (result === null) throw new TypeError();
  return result;
}
function requiredNullableSafeInteger(
  value: unknown,
  minimum: number,
): number | null {
  const result = nullableSafeInteger(value, minimum);
  if (result === undefined) throw new TypeError();
  return result;
}
function requiredInstant(value: unknown): string {
  const result = instant(value);
  if (result === null) throw new TypeError();
  return result;
}
function requiredBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new TypeError();
  return value;
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}
