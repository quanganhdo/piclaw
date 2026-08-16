import {
  hashCanonicalRequest,
  type CanonicalJsonValue,
  type EffectIdentity,
} from "../../contracts/common.js";
import type { EnqueueOutboxRequest } from "../../contracts/service-outbox-store.js";
import type {
  HarnessCorrelation,
  PiclawDisposition,
} from "../../contracts/service-work-store.js";
import type {
  CommitTerminalRequest,
  SourceDisposition,
  TerminalTimelineWrite,
} from "../../contracts/terminal-settlement-store.js";

type Plain = Record<string, unknown>;
const HASH = /^[0-9a-f]{64}$/;
const EFFECT_FIELDS = [
  "idempotencyKey",
  "requestHash",
  "operationId",
  "sourceSeq",
  "provenanceRef",
  "redactionClass",
] as const;

/** Independent fake-side decoder. It intentionally imports no adapter code. */
export function decodeFakeTerminalRequest(
  input: unknown,
): CommitTerminalRequest | null {
  try {
    const raw = object(input, [
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
    ]);
    const disposition = member<PiclawDisposition>([
      "completed",
      "cancelled",
      "failed",
      "skipped",
      "superseded",
    ])(raw.disposition);
    const result: CommitTerminalRequest = {
      effect: effect(raw.effect, false) as EffectIdentity & {
        readonly operationId: string;
      },
      expectedChatJid: text(raw.expectedChatJid, 512),
      expectedVersion: integer(raw.expectedVersion, 1),
      expectedHarness: harness(raw.expectedHarness),
      disposition,
      errorCode: diagnostic(raw.errorCode),
      terminalAuthorityRef: nullableText(raw.terminalAuthorityRef, 2048),
      timeline: timeline(raw.timeline),
      sourceDispositions: sources(raw.sourceDispositions),
      outboxIntents: outbox(raw.outboxIntents),
      committedAt: instant(raw.committedAt),
    };
    if (
      result.expectedVersion >= Number.MAX_SAFE_INTEGER ||
      result.outboxIntents.some(
        (intent) => intent.enqueuedAt !== result.committedAt,
      )
    ) {
      throw new TypeError();
    }
    const authority =
      disposition === "skipped" || disposition === "superseded";
    if (authority !== (result.terminalAuthorityRef !== null)) throw new TypeError();
    if ((disposition === "failed") !== (result.errorCode !== null)) {
      throw new TypeError();
    }
    if (
      hashCanonicalRequest(result as unknown as CanonicalJsonValue) !==
      result.effect.requestHash
    ) {
      throw new TypeError();
    }
    return freeze(result);
  } catch (error) {
    void error;
    return null;
  }
}

export function decodeFakeTerminalLookup(input: unknown): string | null {
  try {
    return text(input, 512);
  } catch (error) {
    void error;
    return null;
  }
}

function effect(input: unknown, nullableOperation: boolean): EffectIdentity {
  const raw = object(input, EFFECT_FIELDS);
  if (typeof raw.requestHash !== "string" || !HASH.test(raw.requestHash)) {
    throw new TypeError();
  }
  const operationId =
    nullableOperation && raw.operationId === null
      ? null
      : text(raw.operationId, 512);
  return {
    idempotencyKey: text(raw.idempotencyKey, 512),
    requestHash: raw.requestHash,
    operationId,
    sourceSeq: raw.sourceSeq === null ? null : integer(raw.sourceSeq, 0),
    provenanceRef: text(raw.provenanceRef, 2048),
    redactionClass: member(["public", "private", "secret"])(
      raw.redactionClass,
    ),
  };
}

function harness(input: unknown): HarnessCorrelation | null {
  if (input === null) return null;
  const raw = object(input, [
    "sessionId",
    "lane",
    "harnessOperationId",
    "state",
    "watchGeneration",
  ]);
  return {
    sessionId: text(raw.sessionId, 512),
    lane: text(raw.lane, 512),
    harnessOperationId: nullableText(raw.harnessOperationId, 512),
    state: member([
      "not_started",
      "running",
      "suspended",
      "aborting",
      "finished",
    ])(raw.state),
    watchGeneration: integer(raw.watchGeneration, 0),
  };
}

function timeline(input: unknown): TerminalTimelineWrite {
  const raw = object(input, [
    "mode",
    "placeholderRowId",
    "chatJid",
    "contentRef",
    "threadId",
    "mediaIds",
    "contentBlocksRef",
  ]);
  const chatJid = text(raw.chatJid, 512);
  if (raw.mode === "none") {
    if (
      raw.placeholderRowId !== null ||
      raw.contentRef !== null ||
      raw.threadId !== null ||
      raw.contentBlocksRef !== null
    ) {
      throw new TypeError();
    }
    const mediaIds = array(raw.mediaIds, 0);
    if (mediaIds.length !== 0) throw new TypeError();
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
  const common = {
    chatJid,
    contentRef: text(raw.contentRef, 2048),
    threadId: raw.threadId === null ? null : integer(raw.threadId, 1),
    mediaIds: uniquePositive(raw.mediaIds, 100),
    contentBlocksRef: nullableText(raw.contentBlocksRef, 2048),
  };
  if (raw.mode === "insert" && raw.placeholderRowId === null) {
    return { mode: "insert", placeholderRowId: null, ...common };
  }
  if (raw.mode === "replace_placeholder") {
    return {
      mode: "replace_placeholder",
      placeholderRowId: integer(raw.placeholderRowId, 1),
      ...common,
    };
  }
  throw new TypeError();
}

function sources(input: unknown): readonly SourceDisposition[] {
  const entries = array(input, 1000);
  if (entries.length === 0) throw new TypeError();
  let previous = 0;
  return Object.freeze(
    entries.map((entry) => {
      const raw = object(entry, ["sourceSeq", "state", "reason"]);
      const sourceSeq = integer(raw.sourceSeq, 1);
      if (sourceSeq <= previous) throw new TypeError();
      previous = sourceSeq;
      return {
        sourceSeq,
        state: member(["consumed", "disposed"])(raw.state),
        reason: text(raw.reason, 512),
      };
    }),
  );
}

function outbox(input: unknown): readonly EnqueueOutboxRequest[] {
  const entries = array(input, 100);
  const ids = new Set<string>();
  const keys = new Set<string>();
  return Object.freeze(
    entries.map((entry) => {
      const raw = object(entry, [
        "effect",
        "outboxId",
        "kind",
        "payloadRef",
        "destinationRef",
        "availableAt",
        "enqueuedAt",
        "repeatability",
      ]);
      const request: EnqueueOutboxRequest = {
        effect: effect(raw.effect, true),
        outboxId: text(raw.outboxId, 512),
        kind: member([
          "wake_chat",
          "timeline_broadcast",
          "channel_delivery",
          "notification",
          "scheduler_run_log",
          "maintenance",
        ])(raw.kind),
        payloadRef: text(raw.payloadRef, 2048),
        destinationRef: nullableText(raw.destinationRef, 2048),
        availableAt: instant(raw.availableAt),
        enqueuedAt: instant(raw.enqueuedAt),
        repeatability: member([
          "repeatable",
          "reconciliation_required",
        ])(raw.repeatability),
      };
      if (request.availableAt < request.enqueuedAt) throw new TypeError();
      if (
        hashCanonicalRequest(request as unknown as CanonicalJsonValue) !==
        request.effect.requestHash
      ) {
        throw new TypeError();
      }
      const key = JSON.stringify([
        request.kind,
        request.effect.idempotencyKey,
      ]);
      if (ids.has(request.outboxId) || keys.has(key)) throw new TypeError();
      ids.add(request.outboxId);
      keys.add(key);
      return freeze(request);
    }),
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
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError();
  const output: Plain = {};
  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(input),
  )) {
    if (!("value" in descriptor) || !descriptor.enumerable) throw new TypeError();
    output[key] = snapshot(descriptor.value, depth + 1, seen);
  }
  return output;
}

function object(input: unknown, fields: readonly string[]): Plain {
  const raw = snapshot(input) as Plain;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError();
  }
  const actual = Object.keys(raw).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    throw new TypeError();
  }
  return raw;
}

function array(input: unknown, maximum: number): unknown[] {
  const raw = snapshot(input);
  if (!Array.isArray(raw) || raw.length > maximum) throw new TypeError();
  return raw;
}

function uniquePositive(input: unknown, maximum: number): readonly number[] {
  const values = array(input, maximum).map((entry) => integer(entry, 1));
  if (new Set(values).size !== values.length) throw new TypeError();
  return Object.freeze(values);
}

function member<T extends string>(values: readonly T[]) {
  const set = new Set<string>(values);
  return (input: unknown): T => {
    if (typeof input !== "string" || !set.has(input)) throw new TypeError();
    return input as T;
  };
}

function text(input: unknown, maximum: number): string {
  if (
    typeof input !== "string" ||
    input.length === 0 ||
    input.trim().length === 0 ||
    input.length > maximum
  ) {
    throw new TypeError();
  }
  return input.normalize("NFC");
}

function nullableText(input: unknown, maximum: number): string | null {
  return input === null ? null : text(input, maximum);
}

function diagnostic(input: unknown): string | null {
  if (input === null) return null;
  const value = text(input, 128);
  if (!/^[A-Za-z0-9_.:-]+$/.test(value)) throw new TypeError();
  return value;
}

function integer(input: unknown, minimum: number): number {
  if (!Number.isSafeInteger(input) || (input as number) < minimum) {
    throw new TypeError();
  }
  return input as number;
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

function freeze<T>(input: T): T {
  if (input && typeof input === "object") {
    for (const value of Object.values(input)) freeze(value);
    Object.freeze(input);
  }
  return input;
}
