import { createHash } from "node:crypto";

import {
  hashCanonicalRequest,
  type CanonicalJsonValue,
  type EffectIdentity,
} from "../../contracts/common.js";
import type { EnqueueOutboxRequest } from "../../contracts/service-outbox-store.js";
import type {
  AbandonScheduledRunRequest,
  BindScheduledSourceRequest,
  ClaimDueRunsRequest,
  CleanupScheduledRunsRequest,
  CompleteScheduledRunRequest,
  ListScheduledRunsRequest,
  RenewScheduledRunRequest,
  ScheduledRunRecord,
  ScheduledRunReclaimAuthority,
  ScheduledTaskAuthorityInput,
  ScheduledTaskSnapshot,
  UpdateScheduledTaskAuthorityRequest,
} from "../../contracts/scheduled-run-store.js";
import { computeNextRun } from "../../../task-scheduler-utils.js";

const MAX = Number.MAX_SAFE_INTEGER;
const RUN = /^scheduled_run:[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{64}$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const CODE = /^[A-Za-z0-9_.:-]{1,128}$/u;
const OUTBOX_KINDS = Object.freeze(new Set(["wake_chat", "timeline_broadcast", "channel_delivery", "notification", "scheduler_run_log", "maintenance"]));

type Dictionary = Record<string, unknown>;

/** Fake-owned descriptor reader. It never invokes caller code. */
class ClosedInput {
  private constructor(private readonly source: Dictionary) {}

  static capture(candidate: unknown, fields: readonly string[]): ClosedInput | null {
    if (!isPassiveGraph(candidate) || candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const keys = Reflect.ownKeys(candidate);
    if (keys.length !== fields.length || keys.some((key) => typeof key !== "string" || !fields.includes(key))) return null;
    return new ClosedInput(candidate as Dictionary);
  }

  value(name: string): unknown { return this.source[name]; }
  copy(fields: readonly string[]): Dictionary {
    return Object.fromEntries(fields.map((field) => [field, this.source[field]]));
  }
}

function isPassiveGraph(value: unknown, path = new Set<object>()): boolean {
  if (value === null || typeof value !== "object") return true;
  if (path.has(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype && prototype !== Array.prototype) return false;
  path.add(value);
  try {
    const keys = Reflect.ownKeys(value);
    if (Array.isArray(value)) {
      if (keys.length !== value.length + 1) return false;
      for (let index = 0; index < value.length; index += 1) if (!Object.hasOwn(value, index)) return false;
    }
    for (const key of keys) {
      if (Array.isArray(value) && key === "length") continue;
      if (typeof key !== "string") return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !isPassiveGraph(descriptor.value, path)) return false;
    }
    return true;
  } catch {
    return false;
  } finally {
    path.delete(value);
  }
}

function arrayOf<T>(value: unknown, maximum: number, convert: (item: unknown) => T | null): readonly T[] | null {
  if (!Array.isArray(value) || value.length > maximum || !isPassiveGraph(value)) return null;
  const output: T[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const converted = convert(value[index]);
    if (converted === null) return null;
    output.push(converted);
  }
  return Object.freeze(output);
}

const text = {
  id(value: unknown): value is string { return typeof value === "string" && value.length >= 1 && value.length <= 512 && !/\s/u.test(value); },
  reference(value: unknown): value is string { return typeof value === "string" && value.length >= 1 && value.length <= 2048; },
  opaque(value: unknown): value is string { return typeof value === "string" && value.length >= 1 && value.length <= 2048 && !/\s/u.test(value); },
  code(value: unknown): value is string { return typeof value === "string" && CODE.test(value); },
  hash(value: unknown): value is string { return typeof value === "string" && SHA.test(value); },
};

function integer(value: unknown, minimum = 0, maximum = MAX): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

export function canonicalInstant(value: unknown): string | null {
  if (typeof value !== "string" || !UTC.test(value)) return null;
  try {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? value : null;
  } catch {
    return null;
  }
}

export function addCanonicalDuration(value: string, durationMs: number): string | null {
  const start = canonicalInstant(value);
  if (start === null || !integer(durationMs, 1)) return null;
  const end = Date.parse(start) + durationMs;
  if (!Number.isSafeInteger(end)) return null;
  try { return canonicalInstant(new Date(end).toISOString()); } catch { return null; }
}

export function validScheduledRunId(value: unknown): value is string {
  return typeof value === "string" && RUN.test(value);
}

function timezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(0); return true; } catch { return false; }
}

function parseEffect(candidate: unknown): EffectIdentity | null {
  const fields = ["idempotencyKey", "requestHash", "operationId", "sourceSeq", "provenanceRef", "redactionClass"];
  const input = ClosedInput.capture(candidate, fields);
  if (!input) return null;
  const idempotencyKey = input.value("idempotencyKey"), requestHash = input.value("requestHash");
  const operationId = input.value("operationId"), sourceSeq = input.value("sourceSeq"), provenanceRef = input.value("provenanceRef"), redactionClass = input.value("redactionClass");
  if (!text.id(idempotencyKey) || !text.hash(requestHash) || (operationId !== null && !text.id(operationId))
    || (sourceSeq !== null && !integer(sourceSeq, 0)) || !text.reference(provenanceRef)
    || !["public", "private", "secret"].includes(redactionClass as string)) return null;
  return Object.freeze({ idempotencyKey, requestHash, operationId: operationId as string | null, sourceSeq: sourceSeq as number | null, provenanceRef, redactionClass: redactionClass as EffectIdentity["redactionClass"] });
}

function parseOutbox(candidate: unknown): EnqueueOutboxRequest | null {
  const fields = ["effect", "outboxId", "kind", "payloadRef", "destinationRef", "availableAt", "enqueuedAt", "repeatability"];
  const input = ClosedInput.capture(candidate, fields);
  if (!input) return null;
  const effect = parseEffect(input.value("effect")), outboxId = input.value("outboxId"), kind = input.value("kind");
  const payloadRef = input.value("payloadRef"), destinationRef = input.value("destinationRef");
  const availableAt = canonicalInstant(input.value("availableAt")), enqueuedAt = canonicalInstant(input.value("enqueuedAt"));
  const repeatability = input.value("repeatability");
  if (!effect || !text.id(outboxId) || !OUTBOX_KINDS.has(kind as string) || !text.opaque(payloadRef)
    || (destinationRef !== null && !text.opaque(destinationRef)) || !availableAt || !enqueuedAt || availableAt < enqueuedAt
    || (repeatability !== "repeatable" && repeatability !== "reconciliation_required")) return null;
  return Object.freeze({ effect, outboxId, kind: kind as EnqueueOutboxRequest["kind"], payloadRef, destinationRef: destinationRef as string | null, availableAt, enqueuedAt, repeatability });
}

function digestTuple(values: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(values), "utf8").digest("hex");
}

export function deriveScheduledRunId(taskId: string, scheduledFor: string): string {
  return `scheduled_run:${digestTuple([taskId, scheduledFor])}`;
}
export function validateScheduledRunId(runId: string, taskId: string, scheduledFor: string): boolean {
  return runId === deriveScheduledRunId(taskId, scheduledFor);
}
export function deriveScheduledLeaseToken(prefix: string, runId: string, attempt: number): string {
  return `scheduled_lease:${digestTuple([prefix, runId, attempt])}`;
}
export function hashScheduledLeaseToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const TASK_FIELDS = Object.freeze([
  "taskId", "chatJid", "kind", "payloadRef", "modelLabel", "scheduleType", "scheduleValue", "timezone",
  "notifyOnComplete", "muted", "cwd", "timeoutSec", "internalTask", "redactionClass", "executionRepeatability",
  "nextRunAt", "authoredAt",
]);

function parseInternal(value: unknown): ScheduledTaskAuthorityInput["internalTask"] | undefined {
  if (value === null) return null;
  const input = ClosedInput.capture(value, ["discriminator", "reference"]);
  const discriminator = input?.value("discriminator"), reference = input?.value("reference");
  return input && text.code(discriminator) && text.reference(reference) ? Object.freeze({ discriminator, reference }) : undefined;
}

function scheduleIsUsable(kind: unknown, value: unknown, zone: string, anchor: string): boolean {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024) return false;
  switch (kind) {
    case "once": return canonicalInstant(value) !== null;
    case "interval": return /^[1-9]\d*$/u.test(value) && integer(Number(value), 1);
    case "cron": return computeNextRun("cron", value, { currentDate: anchor, timezone: zone }) !== null;
    default: return false;
  }
}

export function normaliseTaskAuthorityInput(candidate: unknown): ScheduledTaskAuthorityInput | null {
  const input = ClosedInput.capture(candidate, TASK_FIELDS);
  if (!input) return null;
  const taskId = input.value("taskId"), chatJid = input.value("chatJid"), kind = input.value("kind"), payloadRef = input.value("payloadRef");
  const modelLabel = input.value("modelLabel"), scheduleType = input.value("scheduleType"), scheduleValue = input.value("scheduleValue"), zone = input.value("timezone");
  const notifyOnComplete = input.value("notifyOnComplete"), muted = input.value("muted"), cwd = input.value("cwd"), timeoutSec = input.value("timeoutSec");
  const internalTask = parseInternal(input.value("internalTask")), redactionClass = input.value("redactionClass"), repeatability = input.value("executionRepeatability");
  const nextRunAt = canonicalInstant(input.value("nextRunAt")), authoredAt = canonicalInstant(input.value("authoredAt"));
  if (!text.id(taskId) || !text.id(chatJid) || !["agent", "shell", "internal"].includes(kind as string) || !text.opaque(payloadRef)
    || (modelLabel !== null && !text.id(modelLabel)) || !timezone(zone) || !nextRunAt || !authoredAt
    || !scheduleIsUsable(scheduleType, scheduleValue, zone, nextRunAt) || (scheduleType === "once" && scheduleValue !== nextRunAt)
    || typeof notifyOnComplete !== "boolean" || typeof muted !== "boolean" || notifyOnComplete === muted
    || (cwd !== null && !text.reference(cwd)) || (timeoutSec !== null && !integer(timeoutSec, 1, 86400))
    || internalTask === undefined || (kind === "internal") !== (internalTask !== null)
    || !["public", "private", "secret"].includes(redactionClass as string)
    || !["agent_source", "repeatable", "reconciliation_required"].includes(repeatability as string)
    || (kind === "agent") !== (repeatability === "agent_source") || (kind !== "shell" && (cwd !== null || timeoutSec !== null))) return null;
  return Object.freeze({ taskId, chatJid, kind: kind as ScheduledTaskAuthorityInput["kind"], payloadRef, modelLabel: modelLabel as string | null,
    scheduleType: scheduleType as ScheduledTaskAuthorityInput["scheduleType"], scheduleValue: scheduleValue as string, timezone: zone,
    notifyOnComplete, muted, cwd: cwd as string | null, timeoutSec: timeoutSec as number | null, internalTask,
    redactionClass: redactionClass as ScheduledTaskAuthorityInput["redactionClass"], executionRepeatability: repeatability as ScheduledTaskAuthorityInput["executionRepeatability"], nextRunAt, authoredAt });
}

export function normaliseTaskUpdate(candidate: unknown): UpdateScheduledTaskAuthorityRequest | null {
  const fields = [...TASK_FIELDS, "expectedRevision"];
  const input = ClosedInput.capture(candidate, fields), expectedRevision = input?.value("expectedRevision");
  if (!input || !integer(expectedRevision, 1)) return null;
  const base = normaliseTaskAuthorityInput(input.copy(TASK_FIELDS));
  return base ? Object.freeze({ ...base, expectedRevision }) : null;
}

export function taskConfigProjection(input: ScheduledTaskAuthorityInput): CanonicalJsonValue {
  const { taskId, chatJid, kind, payloadRef, modelLabel, scheduleType, scheduleValue, timezone: zone, notifyOnComplete, muted,
    cwd, timeoutSec, internalTask, redactionClass, executionRepeatability } = input;
  return { taskId, chatJid, kind, payloadRef, modelLabel, scheduleType, scheduleValue, timezone: zone, notifyOnComplete, muted,
    cwd, timeoutSec, internalTask, redactionClass, executionRepeatability } as CanonicalJsonValue;
}

export function makeTaskSnapshot(input: ScheduledTaskAuthorityInput, revision: number): ScheduledTaskSnapshot {
  const projection = taskConfigProjection(input);
  return Object.freeze({ ...(projection as Dictionary), revision, configHash: hashCanonicalRequest(projection) }) as unknown as ScheduledTaskSnapshot;
}

export function decodeTaskSnapshot(candidate: unknown): ScheduledTaskSnapshot | null {
  const fields = ["taskId", "revision", "configHash", "chatJid", "kind", "payloadRef", "modelLabel", "scheduleType", "scheduleValue", "timezone",
    "notifyOnComplete", "muted", "cwd", "timeoutSec", "internalTask", "redactionClass", "executionRepeatability"];
  const input = ClosedInput.capture(candidate, fields), revision = input?.value("revision"), configHash = input?.value("configHash");
  if (!input || !integer(revision, 1) || !text.hash(configHash)) return null;
  const artificial = { ...input.copy(fields.filter((field) => field !== "revision" && field !== "configHash")),
    nextRunAt: input.value("scheduleType") === "once" ? input.value("scheduleValue") : "2000-01-01T00:00:00.000Z", authoredAt: "2000-01-01T00:00:00.000Z" };
  const authority = normaliseTaskAuthorityInput(artificial);
  if (!authority) return null;
  const snapshot = makeTaskSnapshot(authority, revision);
  return snapshot.configHash === configHash ? snapshot : null;
}

function parseAuthority(candidate: unknown): ScheduledRunReclaimAuthority | null {
  const input = ClosedInput.capture(candidate, ["runId", "expectedAttempt", "kind", "reconciliationRef"]);
  const runId = input?.value("runId"), expectedAttempt = input?.value("expectedAttempt"), kind = input?.value("kind"), reference = input?.value("reconciliationRef");
  if (!input || !validScheduledRunId(runId) || !integer(expectedAttempt, 1)) return null;
  if (kind === "repeatable" && reference === null) return Object.freeze({ runId, expectedAttempt, kind, reconciliationRef: null });
  if ((kind === "reconciled_absent" || kind === "agent_reconciled_absent") && text.reference(reference)) return Object.freeze({ runId, expectedAttempt, kind, reconciliationRef: reference });
  return null;
}

export function normaliseClaim(candidate: unknown): ClaimDueRunsRequest | null {
  const input = ClosedInput.capture(candidate, ["now", "limit", "workerId", "leaseTokenPrefix", "leaseDurationMs", "reclaimAuthorities"]);
  const now = canonicalInstant(input?.value("now")), limit = input?.value("limit"), workerId = input?.value("workerId"), prefix = input?.value("leaseTokenPrefix"), duration = input?.value("leaseDurationMs");
  const authorities = arrayOf(input?.value("reclaimAuthorities"), 100, parseAuthority);
  if (!input || !now || !integer(limit, 1, 100) || !text.id(workerId) || !text.id(prefix) || !integer(duration, 1, 86_400_000)
    || addCanonicalDuration(now, duration) === null || !authorities) return null;
  if (new Set(authorities.map((entry) => entry.runId)).size !== authorities.length) return null;
  return Object.freeze({ now, limit, workerId, leaseTokenPrefix: prefix, leaseDurationMs: duration, reclaimAuthorities: authorities });
}

const FENCE = Object.freeze(["runId", "workerId", "expectedAttempt", "expectedTaskRevision", "leaseToken", "now"]);
function fenceFrom(input: ClosedInput): { runId: string; workerId: string; expectedAttempt: number; expectedTaskRevision: number; leaseToken: string; now: string } | null {
  const runId = input.value("runId"), workerId = input.value("workerId"), attempt = input.value("expectedAttempt"), revision = input.value("expectedTaskRevision"), token = input.value("leaseToken"), now = canonicalInstant(input.value("now"));
  return validScheduledRunId(runId) && text.id(workerId) && integer(attempt, 1) && integer(revision, 1) && text.reference(token) && now
    ? { runId, workerId, expectedAttempt: attempt, expectedTaskRevision: revision, leaseToken: token, now } : null;
}

function hashMatches<T extends object>(value: T & { effect: EffectIdentity }): T | null {
  return value.effect.requestHash === hashCanonicalRequest(value as unknown as CanonicalJsonValue) ? Object.freeze(value) : null;
}

export function normaliseRenew(candidate: unknown): RenewScheduledRunRequest | null {
  const input = ClosedInput.capture(candidate, [...FENCE, "leaseExpiresAt"]);
  if (!input) return null;
  const fence = fenceFrom(input), expires = canonicalInstant(input.value("leaseExpiresAt"));
  return fence && expires && expires > fence.now ? Object.freeze({ ...fence, leaseExpiresAt: expires }) : null;
}

export function normaliseBind(candidate: unknown): BindScheduledSourceRequest | null {
  const fields = [...FENCE, "effect", "sourceSeq", "operationId", "boundAt"];
  const input = ClosedInput.capture(candidate, fields);
  if (!input) return null;
  const fence = fenceFrom(input), effect = parseEffect(input.value("effect")), sourceSeq = input.value("sourceSeq"), operationId = input.value("operationId"), boundAt = canonicalInstant(input.value("boundAt"));
  if (!fence || !effect || !integer(sourceSeq, 1) || !text.id(operationId) || !boundAt) return null;
  return hashMatches({ ...fence, effect, sourceSeq, operationId, boundAt });
}

export function normaliseComplete(candidate: unknown): CompleteScheduledRunRequest | null {
  const fields = [...FENCE, "effect", "status", "durationMs", "resultRef", "errorCode", "completedAt", "outboxIntents"];
  const input = ClosedInput.capture(candidate, fields);
  if (!input) return null;
  const fence = fenceFrom(input), effect = parseEffect(input.value("effect")), status = input.value("status"), durationMs = input.value("durationMs");
  const resultRef = input.value("resultRef"), errorCode = input.value("errorCode"), completedAt = canonicalInstant(input.value("completedAt"));
  const intents = arrayOf(input.value("outboxIntents"), 100, parseOutbox);
  if (!fence || !effect || !["success", "error"].includes(status as string) || !integer(durationMs, 0) || !completedAt || !intents
    || (resultRef !== null && !text.opaque(resultRef)) || (errorCode !== null && !text.code(errorCode))
    || (status === "success" ? resultRef === null || errorCode !== null : resultRef !== null || errorCode === null)
    || new Set(intents.map((entry) => entry.outboxId)).size !== intents.length) return null;
  return hashMatches({ ...fence, effect, status: status as CompleteScheduledRunRequest["status"], durationMs, resultRef: resultRef as string | null,
    errorCode: errorCode as string | null, completedAt, outboxIntents: intents });
}

export function normaliseAbandon(candidate: unknown): AbandonScheduledRunRequest | null {
  const input = ClosedInput.capture(candidate, [...FENCE, "effect", "reasonTag", "abandonedAt", "retryAt"]);
  if (!input) return null;
  const fence = fenceFrom(input), effect = parseEffect(input.value("effect")), reasonTag = input.value("reasonTag"), abandonedAt = canonicalInstant(input.value("abandonedAt"));
  const rawRetry = input.value("retryAt"), retryAt = rawRetry === null ? null : canonicalInstant(rawRetry);
  if (!fence || !effect || !text.code(reasonTag) || !abandonedAt || (rawRetry !== null && !retryAt) || (retryAt !== null && retryAt <= abandonedAt)) return null;
  return hashMatches({ ...fence, effect, reasonTag, abandonedAt, retryAt });
}

export function normaliseList(candidate: unknown): ListScheduledRunsRequest | null {
  const source = candidate ?? {};
  if (!isPassiveGraph(source) || source === null || Array.isArray(source)) return null;
  const allowed = ["taskId", "state", "limit", "afterScheduledFor", "afterRunId"];
  const keys = Reflect.ownKeys(source);
  if (keys.some((key) => typeof key !== "string" || !allowed.includes(key))) return null;
  const row = source as Dictionary, taskId = row.taskId, state = row.state, limit = row.limit ?? 50, after = row.afterScheduledFor, afterId = row.afterRunId;
  if (taskId !== undefined && !text.id(taskId)) return null;
  if (state !== undefined && !["claimed", "source_bound", "completed", "abandoned"].includes(state as string)) return null;
  if (!integer(limit, 1, 100) || ((after === undefined) !== (afterId === undefined)) || (after !== undefined && (!canonicalInstant(after) || !validScheduledRunId(afterId)))) return null;
  return Object.freeze({ taskId: taskId as string | undefined, state: state as ListScheduledRunsRequest["state"], limit, afterScheduledFor: after as string | undefined, afterRunId: afterId as string | undefined });
}

export function normaliseCleanup(candidate: unknown): CleanupScheduledRunsRequest | null {
  const input = ClosedInput.capture(candidate, ["settledBefore", "limit"]), settledBefore = canonicalInstant(input?.value("settledBefore")), limit = input?.value("limit");
  return input && settledBefore && integer(limit, 1, 100) ? Object.freeze({ settledBefore, limit }) : null;
}

export function computeScheduledSuccessor(snapshot: ScheduledTaskSnapshot, scheduledFor: string, settledAt: string): string | null {
  switch (snapshot.scheduleType) {
    case "once": return null;
    case "interval": {
      const milliseconds = Number(snapshot.scheduleValue);
      return integer(milliseconds, 1) ? addCanonicalDuration(settledAt, milliseconds) : null;
    }
    case "cron": return computeNextRun("cron", snapshot.scheduleValue, { currentDate: scheduledFor, timezone: snapshot.timezone });
  }
}

const RECORD_FIELDS = Object.freeze(["runId", "taskId", "taskRevision", "scheduledFor", "state", "attempt", "workerId", "leaseExpiresAt",
  "acceptedSourceSeq", "operationId", "status", "durationMs", "resultRef", "errorCode", "nextRunAt", "headDisposition", "settledAt",
  "abandonmentReasonTag", "outboxIds", "retained"]);

export function decodeScheduledRunRecord(candidate: unknown): ScheduledRunRecord | null {
  const input = ClosedInput.capture(candidate, RECORD_FIELDS);
  if (!input) return null;
  const runId = input.value("runId"), taskId = input.value("taskId"), scheduledFor = canonicalInstant(input.value("scheduledFor"));
  const revision = input.value("taskRevision"), attempt = input.value("attempt"), state = input.value("state"), retained = input.value("retained");
  const workerId = input.value("workerId"), leaseExpiresAt = input.value("leaseExpiresAt"), sourceSeq = input.value("acceptedSourceSeq"), operationId = input.value("operationId");
  const status = input.value("status"), durationMs = input.value("durationMs"), resultRef = input.value("resultRef"), errorCode = input.value("errorCode");
  const nextRunAt = input.value("nextRunAt"), disposition = input.value("headDisposition"), settledAt = input.value("settledAt"), reason = input.value("abandonmentReasonTag");
  const outboxIds = arrayOf(input.value("outboxIds"), 100, (id) => text.id(id) ? id : null);
  if (!validScheduledRunId(runId) || !text.id(taskId) || !scheduledFor || runId !== deriveScheduledRunId(taskId, scheduledFor)
    || !integer(revision, 1) || !integer(attempt, 1) || !["claimed", "source_bound", "completed", "abandoned"].includes(state as string)
    || typeof retained !== "boolean" || !outboxIds || new Set(outboxIds).size !== outboxIds.length
    || (workerId !== null && !text.id(workerId)) || (leaseExpiresAt !== null && !canonicalInstant(leaseExpiresAt))
    || (sourceSeq !== null && !integer(sourceSeq, 1)) || (operationId !== null && !text.id(operationId)) || ((sourceSeq === null) !== (operationId === null))
    || (status !== null && status !== "success" && status !== "error") || (durationMs !== null && !integer(durationMs, 0))
    || (resultRef !== null && !text.opaque(resultRef)) || (errorCode !== null && !text.code(errorCode))
    || (nextRunAt !== null && !canonicalInstant(nextRunAt)) || !["pending", "advanced", "paused", "deleted", "superseded"].includes(disposition as string)
    || (settledAt !== null && !canonicalInstant(settledAt)) || (reason !== null && !text.code(reason))) return null;

  const sourcePresent = sourceSeq !== null;
  let shape: boolean;
  if (retained) shape = (state === "completed" || state === "abandoned") && workerId === null && leaseExpiresAt === null && !sourcePresent
    && durationMs === null && resultRef === null && errorCode === null && reason === null && disposition !== "pending" && settledAt !== null
    && outboxIds.length === 0 && (state === "completed" ? status !== null : status === null);
  else if (state === "claimed" || state === "source_bound") shape = workerId !== null && leaseExpiresAt !== null && status === null && durationMs === null
    && resultRef === null && errorCode === null && nextRunAt === null && disposition === "pending" && settledAt === null && reason === null
    && outboxIds.length === 0 && (state === "source_bound" ? sourcePresent : !sourcePresent);
  else if (state === "completed") shape = workerId === null && leaseExpiresAt === null && status !== null && durationMs !== null && disposition !== "pending"
    && settledAt !== null && reason === null && (status === "success" ? resultRef !== null && errorCode === null : resultRef === null && errorCode !== null);
  else shape = workerId === null && leaseExpiresAt === null && status === null && durationMs === null && resultRef === null && errorCode === null
    && disposition !== "pending" && settledAt !== null && reason !== null && outboxIds.length === 0;
  if (!shape) return null;

  return Object.freeze({ runId, taskId, taskRevision: revision, scheduledFor, state: state as ScheduledRunRecord["state"], attempt,
    workerId: workerId as string | null, leaseExpiresAt: leaseExpiresAt as string | null, acceptedSourceSeq: sourceSeq as number | null,
    operationId: operationId as string | null, status: status as ScheduledRunRecord["status"], durationMs: durationMs as number | null,
    resultRef: resultRef as string | null, errorCode: errorCode as string | null, nextRunAt: nextRunAt as string | null,
    headDisposition: disposition as ScheduledRunRecord["headDisposition"], settledAt: settledAt as string | null,
    abandonmentReasonTag: reason as string | null, outboxIds, retained });
}

export interface ScheduledClaimReplayRow { readonly runId: string; readonly attempt: number; readonly state: "claimed" | "source_bound"; }
export function decodeClaimReplayRows(candidate: unknown): readonly ScheduledClaimReplayRow[] | null {
  const rows = arrayOf(candidate, 100, (item): ScheduledClaimReplayRow | null => {
    const input = ClosedInput.capture(item, ["runId", "attempt", "state"]), runId = input?.value("runId"), attempt = input?.value("attempt"), state = input?.value("state");
    return input && validScheduledRunId(runId) && integer(attempt, 1) && (state === "claimed" || state === "source_bound") ? Object.freeze({ runId, attempt, state }) : null;
  });
  return rows && new Set(rows.map((row) => row.runId)).size === rows.length ? rows : null;
}

export function decodeCleanupResult(candidate: unknown): { readonly removed: number; readonly runIds: readonly string[] } | null {
  const input = ClosedInput.capture(candidate, ["removed", "runIds"]), removed = input?.value("removed");
  const runIds = arrayOf(input?.value("runIds"), 100, (id) => validScheduledRunId(id) ? id : null);
  return input && integer(removed, 0, 100) && runIds && runIds.length === removed && new Set(runIds).size === runIds.length
    ? Object.freeze({ removed, runIds }) : null;
}
