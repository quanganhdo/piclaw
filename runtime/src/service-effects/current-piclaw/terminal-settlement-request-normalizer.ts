import {
  hashCanonicalRequest,
  type CanonicalJsonValue,
  type EffectIdentity,
} from "../contracts/common.js";
import type { EnqueueOutboxRequest } from "../contracts/service-outbox-store.js";
import type {
  HarnessCorrelation,
  PiclawDisposition,
} from "../contracts/service-work-store.js";
import type {
  CommitTerminalRequest,
  SourceDisposition,
  TerminalTimelineWrite,
} from "../contracts/terminal-settlement-store.js";
import { normaliseOutboxMutation } from "./service-outbox-request-normalizer.js";

const HASH = /^[0-9a-f]{64}$/;
const REDACTIONS = new Set(["public", "private", "secret"]);
const HARNESS_STATES = new Set([
  "not_started",
  "running",
  "suspended",
  "aborting",
  "finished",
]);
const DISPOSITIONS = new Set([
  "completed",
  "cancelled",
  "failed",
  "skipped",
  "superseded",
]);

export function normaliseCommitTerminalRequest(
  input: unknown,
): CommitTerminalRequest | null {
  try {
    const value = record(snapshot(input));
    if (
      !value ||
      !exact(value, [
        "effect",
        "expectedChatJid",
        "expectedVersion",
        "expectedHarness",
        "disposition",
        "errorCode",
        "terminalAuthorityRef",
        "timeline",
        "sourceDispositions",
        "outboxIntents",
        "committedAt",
      ])
    ) {
      return null;
    }
    const effect = normaliseEffect(value.effect);
    const expectedHarness = normaliseHarness(value.expectedHarness);
    const disposition = enumText(value.disposition, DISPOSITIONS) as
      | PiclawDisposition
      | null;
    const timeline = normaliseTimeline(value.timeline);
    const sourceDispositions = normaliseSources(value.sourceDispositions);
    const outboxIntents = normaliseOutbox(value.outboxIntents);
    if (!effect || !disposition || !timeline) return null;
    const request: CommitTerminalRequest = {
      effect: effect as EffectIdentity & { readonly operationId: string },
      expectedChatJid: boundedText(value.expectedChatJid, 512),
      expectedVersion: integer(value.expectedVersion, 1),
      expectedHarness,
      disposition,
      errorCode: nullableDiagnostic(value.errorCode),
      terminalAuthorityRef: nullableBoundedText(
        value.terminalAuthorityRef,
        2048,
      ),
      timeline,
      sourceDispositions,
      outboxIntents,
      committedAt: instant(value.committedAt),
    };
    if (
      request.expectedVersion >= Number.MAX_SAFE_INTEGER ||
      request.outboxIntents.some((intent) => intent.enqueuedAt !== request.committedAt) ||
      !validDispositionFields(request)
    ) {
      return null;
    }
    if (
      hashCanonicalRequest(request as unknown as CanonicalJsonValue) !==
      request.effect.requestHash
    ) {
      return null;
    }
    return deepFreeze(request);
  } catch (error) {
    void error;
    return null;
  }
}

export function normaliseTerminalLookupId(input: unknown): string | null {
  try {
    return boundedText(input, 512);
  } catch (error) {
    void error;
    return null;
  }
}

function normaliseEffect(input: unknown): EffectIdentity | null {
  const value = record(input);
  if (
    !value ||
    !exact(value, [
      "idempotencyKey",
      "requestHash",
      "operationId",
      "sourceSeq",
      "provenanceRef",
      "redactionClass",
    ])
  ) {
    return null;
  }
  const requestHash =
    typeof value.requestHash === "string" && HASH.test(value.requestHash)
      ? value.requestHash
      : null;
  const redactionClass = enumText(value.redactionClass, REDACTIONS);
  if (!requestHash || !redactionClass) return null;
  return {
    idempotencyKey: boundedText(value.idempotencyKey, 512),
    requestHash,
    operationId: boundedText(value.operationId, 512),
    sourceSeq: nullableInteger(value.sourceSeq, 0),
    provenanceRef: boundedText(value.provenanceRef, 2048),
    redactionClass: redactionClass as EffectIdentity["redactionClass"],
  };
}

function normaliseHarness(input: unknown): HarnessCorrelation | null {
  if (input === null) return null;
  const value = record(input);
  if (
    !value ||
    !exact(value, [
      "sessionId",
      "lane",
      "harnessOperationId",
      "state",
      "watchGeneration",
    ])
  ) {
    throw new TypeError();
  }
  const state = enumText(value.state, HARNESS_STATES);
  if (!state) throw new TypeError();
  return {
    sessionId: boundedText(value.sessionId, 512),
    lane: boundedText(value.lane, 512),
    harnessOperationId: nullableBoundedText(value.harnessOperationId, 512),
    state: state as HarnessCorrelation["state"],
    watchGeneration: integer(value.watchGeneration, 0),
  };
}

function normaliseTimeline(input: unknown): TerminalTimelineWrite | null {
  const value = record(input);
  if (
    !value ||
    !exact(value, [
      "mode",
      "placeholderRowId",
      "chatJid",
      "contentRef",
      "threadId",
      "mediaIds",
      "contentBlocksRef",
    ])
  ) {
    return null;
  }
  const chatJid = boundedText(value.chatJid, 512);
  if (value.mode === "none") {
    if (
      value.placeholderRowId !== null ||
      value.contentRef !== null ||
      value.threadId !== null ||
      value.contentBlocksRef !== null ||
      !Array.isArray(value.mediaIds) ||
      value.mediaIds.length !== 0 ||
      Object.keys(value.mediaIds).length !== 0
    ) {
      return null;
    }
    return {
      mode: "none",
      placeholderRowId: null,
      chatJid,
      contentRef: null,
      threadId: null,
      mediaIds: Object.freeze([]),
      contentBlocksRef: null,
    };
  }
  if (value.mode !== "insert" && value.mode !== "replace_placeholder") {
    return null;
  }
  const mediaIds = positiveUniqueIntegers(value.mediaIds, 100);
  const common = {
    chatJid,
    contentRef: boundedText(value.contentRef, 2048),
    threadId: nullableInteger(value.threadId, 1),
    mediaIds,
    contentBlocksRef: nullableBoundedText(value.contentBlocksRef, 2048),
  };
  if (value.mode === "insert") {
    if (value.placeholderRowId !== null) return null;
    return { mode: "insert", placeholderRowId: null, ...common };
  }
  return {
    mode: "replace_placeholder",
    placeholderRowId: integer(value.placeholderRowId, 1),
    ...common,
  };
}

function normaliseSources(input: unknown): readonly SourceDisposition[] {
  if (
    !Array.isArray(input) ||
    input.length === 0 ||
    input.length > 1000 ||
    Object.keys(input).length !== input.length
  ) {
    throw new TypeError();
  }
  const output: SourceDisposition[] = [];
  let previous = 0;
  for (const entry of input) {
    const value = record(entry);
    if (!value || !exact(value, ["sourceSeq", "state", "reason"])) {
      throw new TypeError();
    }
    const sourceSeq = integer(value.sourceSeq, 1);
    if (sourceSeq <= previous) throw new TypeError();
    previous = sourceSeq;
    if (value.state !== "consumed" && value.state !== "disposed") {
      throw new TypeError();
    }
    output.push({
      sourceSeq,
      state: value.state,
      reason: boundedText(value.reason, 512),
    });
  }
  return Object.freeze(output);
}

function normaliseOutbox(input: unknown): readonly EnqueueOutboxRequest[] {
  if (
    !Array.isArray(input) ||
    input.length > 100 ||
    Object.keys(input).length !== input.length
  ) {
    throw new TypeError();
  }
  const output: EnqueueOutboxRequest[] = [];
  const ids = new Set<string>();
  const scopedKeys = new Set<string>();
  for (const entry of input) {
    const normalised = normaliseOutboxMutation("enqueue", entry);
    if (!normalised) throw new TypeError();
    const request = normalised as EnqueueOutboxRequest;
    if (
      request.availableAt < request.enqueuedAt ||
      [
        request.effect.idempotencyKey,
        request.effect.operationId,
        request.effect.provenanceRef,
        request.outboxId,
        request.payloadRef,
        request.destinationRef,
      ].some(
        (value) =>
          value !== null && value !== value.normalize("NFC"),
      )
    ) {
      throw new TypeError();
    }
    const scoped = JSON.stringify([
      request.kind,
      request.effect.idempotencyKey,
    ]);
    if (ids.has(request.outboxId) || scopedKeys.has(scoped)) throw new TypeError();
    ids.add(request.outboxId);
    scopedKeys.add(scoped);
    output.push(request);
  }
  return Object.freeze(output);
}

function validDispositionFields(request: CommitTerminalRequest): boolean {
  const authorityRequired =
    request.disposition === "skipped" || request.disposition === "superseded";
  if (authorityRequired !== (request.terminalAuthorityRef !== null)) return false;
  if (request.disposition === "failed") return request.errorCode !== null;
  return request.errorCode === null;
}

function positiveUniqueIntegers(input: unknown, max: number): readonly number[] {
  if (
    !Array.isArray(input) ||
    input.length > max ||
    Object.keys(input).length !== input.length
  ) {
    throw new TypeError();
  }
  const values = input.map((entry) => integer(entry, 1));
  if (new Set(values).size !== values.length) throw new TypeError();
  return Object.freeze(values);
}

function record(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const output: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(input),
  )) {
    if (!("value" in descriptor) || !descriptor.enumerable) return null;
    output[key] = descriptor.value;
  }
  return output;
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function snapshot(
  input: unknown,
  depth = 0,
  seen = new Set<object>(),
): unknown {
  if (depth > 10) throw new TypeError();
  if (input === null || ["string", "boolean"].includes(typeof input)) {
    return input;
  }
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input !== "object" || seen.has(input)) throw new TypeError();
  seen.add(input);
  if (Array.isArray(input)) {
    if (Object.keys(input).length !== input.length) throw new TypeError();
    return input.map((entry) => snapshot(entry, depth + 1, seen));
  }
  const value = record(input);
  if (!value) throw new TypeError();
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = snapshot(entry, depth + 1, seen);
  }
  return output;
}

function text(input: unknown): string | null {
  return typeof input === "string" && input.length > 0 && input.trim().length > 0
    ? input
    : null;
}

function boundedText(input: unknown, maxLength: number): string {
  const value = text(input);
  if (!value || value.length > maxLength) throw new TypeError();
  return value.normalize("NFC");
}

function nullableBoundedText(input: unknown, maxLength: number): string | null {
  return input === null ? null : boundedText(input, maxLength);
}

function nullableDiagnostic(input: unknown): string | null {
  if (input === null) return null;
  const value = boundedText(input, 128);
  if (!/^[A-Za-z0-9_.:-]+$/.test(value)) throw new TypeError();
  return value;
}

function enumText(input: unknown, values: ReadonlySet<string>): string | null {
  return typeof input === "string" && values.has(input) ? input : null;
}

function integer(input: unknown, minimum: number): number {
  if (!Number.isSafeInteger(input) || (input as number) < minimum) {
    throw new TypeError();
  }
  return input as number;
}

function nullableInteger(input: unknown, minimum: number): number | null {
  return input === null ? null : integer(input, minimum);
}

function instant(input: unknown): string {
  if (typeof input !== "string") throw new TypeError();
  const milliseconds = Date.parse(input);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== input
  ) {
    throw new TypeError();
  }
  return input;
}

function deepFreeze<T>(input: T): T {
  if (input && typeof input === "object") {
    for (const value of Object.values(input)) deepFreeze(value);
    Object.freeze(input);
  }
  return input;
}
