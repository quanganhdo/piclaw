import { Result } from "@earendil-works/pi-agent-core";

import {
  hashCanonicalRequest,
  type CanonicalJsonValue,
  type NormalisedEffectTrace,
  type NormalisedTraceInput,
} from "../../contracts/common.js";
import type {
  AbandonScheduledRunRequest,
  BindScheduledSourceRequest,
  ClaimDueRunsRequest,
  CleanupScheduledRunsRequest,
  CompleteScheduledRunRequest,
  ListScheduledRunsRequest,
  RenewScheduledRunRequest,
  ScheduledRunLease,
  ScheduledRunRecord,
  ScheduledRunStore,
  ScheduledRunStoreError,
  ScheduledTaskAuthority,
  ScheduledTaskAuthorityInput,
  ScheduledTaskSnapshot,
  UpdateScheduledTaskAuthorityRequest,
} from "../../contracts/scheduled-run-store.js";
import type { ContractTestContext } from "../contract-suite.js";
import {
  addCanonicalDuration,
  computeScheduledSuccessor,
  decodeClaimReplayRows,
  decodeCleanupResult,
  decodeScheduledRunRecord,
  deriveScheduledLeaseToken,
  deriveScheduledRunId,
  hashScheduledLeaseToken,
  makeTaskSnapshot,
  normaliseAbandon,
  normaliseBind,
  normaliseClaim,
  normaliseCleanup,
  normaliseComplete,
  normaliseList,
  normaliseRenew,
  normaliseTaskAuthorityInput,
  normaliseTaskUpdate,
  validScheduledRunId,
} from "./fake-scheduled-run-values.js";
import { EffectTraceRecorder } from "../trace-recorder.js";

type FakeMutationMethod = "claimDue" | "renew" | "bindAcceptedSource" | "complete" | "abandon" | "cleanupTerminal";

type Head = { revision: number; status: "active" | "paused" | "completed" | "deleted"; nextRunAt: string | null; snapshots: Map<number, ScheduledTaskSnapshot> };
type Run = { record: ScheduledRunRecord; snapshot: ScheduledTaskSnapshot; tokenHash: string | null; claimedAt: string; leaseAuthorities: Array<{ attempt: number; kind: "new" | "agent_reconciled_absent" | "repeatable" | "reconciled_absent"; reconciliationRef: string | null }> };
type Source = { sourceId: string; kind: string; chatJid: string; sourceSeq: number; operationId: string; primary: boolean };
type Decision = { method: FakeMutationMethod; requestHash: string; value: unknown; runId: string | null };
type Tombstone = ScheduledRunRecord & { decisionMethod: "complete" | "abandon"; decisionHash: string };

export interface FakeScheduledRunSnapshot {
  readonly heads: readonly [string, Head][];
  readonly runs: readonly [string, Run][];
  readonly decisions: readonly [string, Decision][];
  readonly outboxIds: readonly string[];
  readonly outboxStates: readonly [string, "pending" | "unknown"][];
  readonly sources: readonly [string, Source][];
  readonly tombstones: readonly [string, Tombstone][];
  readonly trace: readonly NormalisedEffectTrace[];
}

function clone<T>(value: T): T { return structuredClone(value); }
function freezeRecord(record: ScheduledRunRecord): ScheduledRunRecord {
  const closed = decodeScheduledRunRecord(record);
  if (!closed) throw new FakeFailure(err("corrupt_state"));
  return closed;
}
function err(tag: ScheduledRunStoreError["_tag"], certainty: "not_applied" | "unknown" = "not_applied", details: Partial<ScheduledRunStoreError> = {}): ScheduledRunStoreError {
  return Object.freeze({ _tag: tag, certainty, retryable: tag === "storage_unavailable", ...details });
}
class FakeFailure extends Error {
  constructor(readonly error: ScheduledRunStoreError) { super(error._tag); }
}
function runId(taskId: string, taskRevision: number, scheduledFor: string): string { return deriveScheduledRunId(taskId, taskRevision, scheduledFor); }
function token(prefix: string, id: string, attempt: number): string { return deriveScheduledLeaseToken(prefix, id, attempt); }
function tokenHash(value: string): string { return hashScheduledLeaseToken(value); }
function requestHash(value: unknown): string { return hashCanonicalRequest(value as CanonicalJsonValue); }

export class FakeScheduledRunBackend {
  heads = new Map<string, Head>();
  runs = new Map<string, Run>();
  decisions = new Map<string, Decision>();
  outboxIds = new Set<string>();
  outboxStates = new Map<string, "pending" | "unknown">();
  sources = new Map<string, Source>();
  tombstones = new Map<string, Tombstone>();

  snapshot(trace: readonly NormalisedEffectTrace[] = []): FakeScheduledRunSnapshot {
    return clone({ heads: [...this.heads], runs: [...this.runs], decisions: [...this.decisions], outboxIds: [...this.outboxIds], outboxStates: [...this.outboxStates], sources: [...this.sources], tombstones: [...this.tombstones], trace });
  }
  restore(snapshot: FakeScheduledRunSnapshot): void {
    this.heads = new Map(clone(snapshot.heads)); this.runs = new Map(clone(snapshot.runs));
    this.decisions = new Map(clone(snapshot.decisions)); this.outboxIds = new Set(clone(snapshot.outboxIds)); this.outboxStates = new Map(clone(snapshot.outboxStates));
    this.sources = new Map(clone(snapshot.sources)); this.tombstones = new Map(clone(snapshot.tombstones));
  }
  acceptScheduledAgentSource(source: Source): void { this.sources.set(`${source.chatJid}:${source.sourceSeq}:${source.operationId}`, clone(source)); }
  markOutboxUnknown(outboxId: string): void { if (this.outboxStates.get(outboxId) !== "pending") throw new Error("Fake outbox is not pending."); this.outboxStates.set(outboxId, "unknown"); }
}

export function createFakeScheduledTaskAuthority(backend: FakeScheduledRunBackend): ScheduledTaskAuthority {
  return Object.freeze({
    create(input: ScheduledTaskAuthorityInput) {
      const closed = normaliseTaskAuthorityInput(input); if (!closed || backend.heads.has(closed.taskId)) throw new TypeError("Invalid fake scheduled task.");
      const snapshot = makeTaskSnapshot(closed, 1);
      backend.heads.set(closed.taskId, { revision: 1, status: "active", nextRunAt: closed.nextRunAt, snapshots: new Map([[1, snapshot]]) });
      return snapshot;
    },
    update(input: UpdateScheduledTaskAuthorityRequest) {
      const closed = normaliseTaskUpdate(input); if (!closed) throw new TypeError("Invalid fake scheduled task update.");
      const head = backend.heads.get(closed.taskId); if (!head || head.revision !== closed.expectedRevision || head.status === "deleted") throw new Error("Fake task revision mismatch.");
      const revision = head.revision + 1, snapshot = makeTaskSnapshot(closed, revision);
      head.revision = revision; head.status = "active"; head.nextRunAt = closed.nextRunAt; head.snapshots.set(revision, snapshot);
      return snapshot;
    },
    pause(taskId: string) { const head = backend.heads.get(taskId); if (!head || head.status !== "active") throw new Error("Fake active task not found."); head.status = "paused"; },
    resume(taskId: string) {
      const head = backend.heads.get(taskId); if (!head || head.status !== "paused") throw new Error("Fake paused task not found.");
      const latest = [...backend.runs.values()].filter((run) => run.record.taskId === taskId && run.record.taskRevision === head.revision && run.record.headDisposition === "paused").sort((a, b) => b.record.scheduledFor.localeCompare(a.record.scheduledFor))[0];
      if (latest) head.nextRunAt = latest.record.nextRunAt;
      head.status = head.nextRunAt === null ? "completed" : "active";
    },
    delete(taskId: string) { const head = backend.heads.get(taskId); if (!head || head.status === "deleted") throw new Error("Fake task not found."); head.status = "deleted"; head.nextRunAt = null; },
    get(taskId: string) { const head = backend.heads.get(taskId); return head?.snapshots.get(head.revision) ?? null; },
  });
}

export class FakeScheduledRunStore implements ScheduledRunStore {
  readonly trace: EffectTraceRecorder;
  private readonly plannedFaults = new Map<string, Set<number>>();
  private readonly faultCounts = new Map<string, number>();
  private traceObserver: (trace: NormalisedTraceInput) => void = () => undefined;
  constructor(readonly backend: FakeScheduledRunBackend, private readonly context: ContractTestContext, trace: readonly NormalisedEffectTrace[] = []) {
    this.trace = EffectTraceRecorder.fromSnapshot(trace);
  }

  poisonTraceObserver(): void { this.traceObserver = () => { throw new Error("malformed trace observer"); }; }

  planFault(method: string, point: "before_effect" | "effect_then_lost_acknowledgement", occurrence: number): void {
    const key = `${method}:${point}`;
    const base = this.faultCounts.get(key) ?? 0;
    this.plannedFaults.set(key, new Set([base + occurrence]));
  }

  async claimDue(input: ClaimDueRunsRequest) {
    const request = normaliseClaim(input);
    const effectId = request ? "claimDue" : "invalid";
    if (!request) return Result.err(err("invalid_request"));
    return this.mutate("claimDue", effectId, () => {
      const key = `claim:${tokenHash(request.leaseTokenPrefix)}`, hash = requestHash(request);
      const replay = this.decision(key, "claimDue", hash, null);
      if (replay !== undefined) return Result.ok(this.restoreClaim(request, replay));
      type Candidate = { kind: "new" | "expired"; taskId: string; scheduledFor: string; id: string };
      const candidates: Candidate[] = [];
      for (const [taskId, head] of this.backend.heads) if (head.status === "active" && head.nextRunAt && head.nextRunAt <= request.now) candidates.push({ kind: "new", taskId, scheduledFor: head.nextRunAt, id: runId(taskId, head.revision, head.nextRunAt) });
      for (const [id, run] of this.backend.runs) if ((run.record.state === "claimed" || run.record.state === "source_bound") && run.record.leaseExpiresAt! <= request.now) candidates.push({ kind: "expired", taskId: run.record.taskId, scheduledFor: run.record.scheduledFor, id });
      candidates.sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor) || a.taskId.localeCompare(b.taskId) || a.kind.localeCompare(b.kind));
      const leases: ScheduledRunLease[] = [], rows: Array<{ runId: string; attempt: number; state: "claimed" | "source_bound" }> = [];
      for (const candidate of candidates) {
        if (leases.length >= request.limit) break;
        if (candidate.kind === "new") {
          if (this.backend.runs.has(candidate.id) || this.backend.tombstones.has(candidate.id)) continue;
          const head = this.backend.heads.get(candidate.taskId)!; if (head.status !== "active" || head.nextRunAt !== candidate.scheduledFor) continue;
          const snapshot = head.snapshots.get(head.revision)!;
          const expires = addCanonicalDuration(request.now, request.leaseDurationMs); if (!expires) throw new FakeFailure(err("invalid_request"));
          const leaseToken = token(request.leaseTokenPrefix, candidate.id, 1);
          const record = freezeRecord({ runId: candidate.id, taskId: candidate.taskId, taskRevision: snapshot.revision, scheduledFor: candidate.scheduledFor, state: "claimed", attempt: 1, workerId: request.workerId, leaseExpiresAt: expires, acceptedSourceSeq: null, operationId: null, status: null, durationMs: null, resultRef: null, errorCode: null, nextRunAt: null, headDisposition: "pending", settledAt: null, abandonmentReasonTag: null, outboxIds: [], retained: false });
          this.backend.runs.set(candidate.id, { record, snapshot, tokenHash: tokenHash(leaseToken), claimedAt: request.now, leaseAuthorities: [{ attempt: 1, kind: "new", reconciliationRef: null }] });
          leases.push(Object.freeze({ record: record as ScheduledRunLease["record"], task: snapshot, leaseToken })); rows.push({ runId: candidate.id, attempt: 1, state: "claimed" });
        } else {
          const run = this.backend.runs.get(candidate.id)!; const expected = request.reclaimAuthorities.find((item) => item.runId === candidate.id && item.expectedAttempt === run.record.attempt);
          const allowed = (run.snapshot.executionRepeatability === "agent_source" && expected?.kind === "agent_reconciled_absent")
            || (run.snapshot.executionRepeatability === "repeatable" && expected?.kind === "repeatable")
            || (run.snapshot.executionRepeatability === "reconciliation_required" && expected?.kind === "reconciled_absent");
          if (!allowed || !expected) continue;
          const attempt = run.record.attempt + 1; if (!Number.isSafeInteger(attempt)) throw new FakeFailure(err("corrupt_state"));
          const expires = addCanonicalDuration(request.now, request.leaseDurationMs); if (!expires) throw new FakeFailure(err("invalid_request"));
          const leaseToken = token(request.leaseTokenPrefix, candidate.id, attempt);
          run.tokenHash = tokenHash(leaseToken); run.claimedAt = request.now;
          run.leaseAuthorities.push({ attempt, kind: expected.kind, reconciliationRef: expected.reconciliationRef });
          run.record = freezeRecord({ ...run.record, attempt, workerId: request.workerId, leaseExpiresAt: expires });
          leases.push(Object.freeze({ record: run.record as ScheduledRunLease["record"], task: run.snapshot, leaseToken })); rows.push({ runId: candidate.id, attempt, state: run.record.state === "source_bound" ? "source_bound" : "claimed" });
        }
      }
      this.backend.decisions.set(key, { method: "claimDue", requestHash: hash, value: clone(rows), runId: null });
      return Result.ok(Object.freeze(leases));
    });
  }

  async renew(input: RenewScheduledRunRequest) {
    const request = normaliseRenew(input); if (!request) return Result.err(err("invalid_request"));
    return this.mutate("renew", `renew:${request.runId}:${request.expectedAttempt}:${request.leaseExpiresAt}`, () => {
      const key = `renew:${request.runId}:${request.expectedAttempt}:${tokenHash(request.leaseToken)}:${request.leaseExpiresAt}`, hash = requestHash(request);
      const replay = this.decision(key, "renew", hash, request.runId);
      if (replay !== undefined) {
        const saved = decodeScheduledRunRecord(replay);
        if (!saved || (saved.state !== "claimed" && saved.state !== "source_bound") || saved.leaseExpiresAt !== request.leaseExpiresAt) throw new FakeFailure(err("corrupt_state"));
        const run = this.backend.runs.get(saved.runId);
        if (!run || run.record.state === "completed" || run.record.state === "abandoned" || run.record.attempt !== saved.attempt
          || run.record.taskRevision !== saved.taskRevision) throw new FakeFailure(err("invalid_transition"));
        this.validateRun(run);
        const current = this.requireRecord(run.record);
        if ((current.state !== "claimed" && current.state !== "source_bound") || current.workerId !== request.workerId
          || run.tokenHash !== tokenHash(request.leaseToken)) throw new FakeFailure(err("invalid_transition"));
        if (current.leaseExpiresAt! < request.leaseExpiresAt) throw new FakeFailure(err("corrupt_state"));
        return Result.ok(Object.freeze({ record: current as ScheduledRunLease["record"], task: run.snapshot, leaseToken: request.leaseToken }));
      }
      const fenced = this.fence(request); if (!fenced.ok) return fenced;
      const run = fenced.value; if (request.leaseExpiresAt <= run.record.leaseExpiresAt!) return Result.err(err("invalid_request"));
      run.record = freezeRecord({ ...run.record, leaseExpiresAt: request.leaseExpiresAt });
      this.backend.decisions.set(key, { method: "renew", requestHash: hash, value: clone(run.record), runId: request.runId });
      return Result.ok(Object.freeze({ record: run.record as ScheduledRunLease["record"], task: run.snapshot, leaseToken: request.leaseToken }));
    });
  }

  async bindAcceptedSource(input: BindScheduledSourceRequest) {
    const request = normaliseBind(input); if (!request) return Result.err(err("invalid_request"));
    return this.mutate("bindAcceptedSource", request.effect.idempotencyKey, () => {
      const key = `effect:${request.effect.idempotencyKey}`, replay = this.recordDecision(key, "bindAcceptedSource", request.effect.requestHash, request.runId); if (replay) return Result.ok(replay);
      const fenced = this.fence(request); if (!fenced.ok) return fenced; const run = fenced.value;
      if (run.record.state === "source_bound") return Result.err(err("idempotency_conflict"));
      if (run.snapshot.kind !== "agent" || run.record.state !== "claimed" || request.effect.operationId !== request.operationId || request.effect.sourceSeq !== request.sourceSeq) return Result.err(err("invalid_transition"));
      const source = this.backend.sources.get(`${run.snapshot.chatJid}:${request.sourceSeq}:${request.operationId}`);
      if (!source) return Result.err(err("not_found"));
      if (source.sourceId !== request.runId || source.kind !== "scheduled_agent" || !source.primary) return Result.err(err("invalid_transition"));
      run.record = freezeRecord({ ...run.record, state: "source_bound", acceptedSourceSeq: request.sourceSeq, operationId: request.operationId });
      this.backend.decisions.set(key, { method: "bindAcceptedSource", requestHash: request.effect.requestHash, value: clone(run.record), runId: request.runId });
      return Result.ok(run.record);
    });
  }

  async complete(input: CompleteScheduledRunRequest) {
    const request = normaliseComplete(input); if (!request) return Result.err(err("invalid_request"));
    return this.mutate("complete", request.effect.idempotencyKey, () => {
      const key = `effect:${request.effect.idempotencyKey}`, replay = this.recordDecision(key, "complete", request.effect.requestHash, request.runId); if (replay) return Result.ok(replay);
      const fenced = this.fence(request); if (!fenced.ok) return fenced; const run = fenced.value;
      const shapeError = this.resultShapeError(run, request); if (shapeError) return Result.err(err(shapeError));
      for (const intent of request.outboxIntents) {
        if (this.backend.outboxIds.has(intent.outboxId)) return Result.err(err("idempotency_conflict"));
        if (run.snapshot.kind === "agent" ? (intent.effect.operationId !== run.record.operationId || intent.effect.sourceSeq !== run.record.acceptedSourceSeq) : (intent.effect.operationId !== null || intent.effect.sourceSeq !== null)) return Result.err(err("invalid_request"));
        if ((!run.snapshot.notifyOnComplete || run.snapshot.muted || run.snapshot.kind === "internal") && intent.kind === "notification") return Result.err(err("invalid_request"));
      }
      const next = this.successor(run, request.completedAt, null), headDisposition = this.headDecision(run, next);
      request.outboxIntents.forEach((intent) => { this.backend.outboxIds.add(intent.outboxId); this.backend.outboxStates.set(intent.outboxId, "pending"); });
      run.tokenHash = null; run.record = freezeRecord({ ...run.record, state: "completed", workerId: null, leaseExpiresAt: null, status: request.status, durationMs: request.durationMs, resultRef: request.resultRef, errorCode: request.errorCode, nextRunAt: headDisposition === "advanced" || headDisposition === "paused" ? next : null, headDisposition, settledAt: request.completedAt, outboxIds: request.outboxIntents.map((intent) => intent.outboxId) });
      this.advanceHead(run, next, headDisposition);
      this.backend.decisions.set(key, { method: "complete", requestHash: request.effect.requestHash, value: clone(run.record), runId: request.runId });
      return Result.ok(run.record);
    });
  }

  async abandon(input: AbandonScheduledRunRequest) {
    const request = normaliseAbandon(input); if (!request) return Result.err(err("invalid_request"));
    return this.mutate("abandon", request.effect.idempotencyKey, () => {
      const key = `effect:${request.effect.idempotencyKey}`, replay = this.recordDecision(key, "abandon", request.effect.requestHash, request.runId); if (replay) return Result.ok(replay);
      const fenced = this.fence(request); if (!fenced.ok) return fenced; const run = fenced.value;
      const next = this.successor(run, request.abandonedAt, request.retryAt), headDisposition = this.headDecision(run, next);
      run.tokenHash = null; run.record = freezeRecord({ ...run.record, state: "abandoned", workerId: null, leaseExpiresAt: null, nextRunAt: headDisposition === "advanced" || headDisposition === "paused" ? next : null, headDisposition, settledAt: request.abandonedAt, abandonmentReasonTag: request.reasonTag });
      this.advanceHead(run, next, headDisposition);
      this.backend.decisions.set(key, { method: "abandon", requestHash: request.effect.requestHash, value: clone(run.record), runId: request.runId });
      return Result.ok(run.record);
    });
  }

  async get(id: string) {
    if (!validScheduledRunId(id)) return Result.err(err("invalid_request"));
    try { return Result.ok(this.readRecord(id)); } catch (error) { return Result.err(error instanceof FakeFailure ? error.error : err("corrupt_state")); }
  }
  async listRuns(input: ListScheduledRunsRequest = {}) {
    const request = normaliseList(input); if (!request) return Result.err(err("invalid_request"));
    try {
      const rows = [...[...this.backend.runs.values()].map((run) => this.requireRecord(run.record)), ...this.backend.tombstones.values()].map((row) => this.requireRecord(row))
        .filter((row) => (!request.taskId || row.taskId === request.taskId) && (!request.state || row.state === request.state) && (!request.afterScheduledFor || row.scheduledFor > request.afterScheduledFor || (row.scheduledFor === request.afterScheduledFor && row.runId > request.afterRunId!)))
        .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor) || a.runId.localeCompare(b.runId)).slice(0, request.limit ?? 50);
      return Result.ok(Object.freeze(rows));
    } catch { return Result.err(err("corrupt_state")); }
  }
  async cleanupTerminal(input: CleanupScheduledRunsRequest) {
    const request = normaliseCleanup(input); if (!request) return Result.err(err("invalid_request"));
    return this.mutate("cleanupTerminal", `cleanup:${request.settledBefore}:${request.limit}`, () => {
      const key = `cleanupTerminal:${request.settledBefore}:${request.limit}`, hash = requestHash(request);
      const replay = this.decision(key, "cleanupTerminal", hash, null);
      if (replay !== undefined) { const result = decodeCleanupResult(replay); if (!result) throw new FakeFailure(err("corrupt_state")); return Result.ok(result); }
      const candidates = [...this.backend.runs.values()].filter((run) => (run.record.state === "completed" || run.record.state === "abandoned") && run.record.settledAt! < request.settledBefore).sort((a, b) => a.record.settledAt!.localeCompare(b.record.settledAt!) || a.record.runId.localeCompare(b.record.runId)).slice(0, request.limit);
      const ids: string[] = [];
      for (const run of candidates) {
        const terminalMethod = run.record.state === "completed" ? "complete" : "abandon";
        const terminal = [...this.backend.decisions.values()].find((decision) => decision.runId === run.record.runId && decision.method === terminalMethod);
        if (!terminal) throw new FakeFailure(err("corrupt_state"));
        const retainedRecord = freezeRecord({ ...run.record, workerId: null, leaseExpiresAt: null, acceptedSourceSeq: null, operationId: null, durationMs: null, resultRef: null, errorCode: null, abandonmentReasonTag: null, outboxIds: [], retained: true });
        const retained = Object.freeze({ ...retainedRecord, decisionMethod: terminalMethod, decisionHash: terminal.requestHash }) as Tombstone;
        this.backend.tombstones.set(run.record.runId, retained); this.backend.runs.delete(run.record.runId);
        for (const [decisionKey, decision] of this.backend.decisions) if (decision.runId === run.record.runId) this.backend.decisions.delete(decisionKey);
        ids.push(run.record.runId);
      }
      const result = Object.freeze({ removed: ids.length, runIds: Object.freeze(ids) });
      this.backend.decisions.set(key, { method: "cleanupTerminal", requestHash: hash, value: clone(result), runId: null });
      return Result.ok(result);
    });
  }

  snapshot(): FakeScheduledRunSnapshot { return this.backend.snapshot(this.trace.snapshot()); }
  restore(snapshot: FakeScheduledRunSnapshot): FakeScheduledRunStore { this.backend.restore(snapshot); return new FakeScheduledRunStore(this.backend, this.context, snapshot.trace); }

  private mutate<T>(method: FakeMutationMethod, effectId: string, action: () => ReturnType<typeof Result.ok<T>> | ReturnType<typeof Result.err<ScheduledRunStoreError>>) {
    this.recordTrace({ contract: "EF-S07", method, effectId, operationId: null, sourceSeq: null, version: null, certainty: null, resultTag: "call" });
    if (this.hitFault(method, "before_effect")) return Result.err(err("storage_unavailable"));
    const snapshot = this.backend.snapshot();
    let result;
    try { result = action(); } catch (error) { this.backend.restore(snapshot); return Result.err(error instanceof FakeFailure ? error.error : err("storage_unavailable")); }
    if (!result.ok) { this.backend.restore(snapshot); this.recordTrace({ contract: "EF-S07", method, effectId, operationId: null, sourceSeq: null, version: null, certainty: result.error.certainty, resultTag: result.error._tag }); return result; }
    if (this.hitFault(method, "effect_then_lost_acknowledgement")) return Result.err(err("storage_unavailable", "unknown"));
    this.recordTrace({ contract: "EF-S07", method, effectId, operationId: null, sourceSeq: null, version: null, certainty: "applied", resultTag: "applied" });
    return result;
  }
  private recordTrace(input: NormalisedTraceInput): void {
    try { if (input.resultTag === "call") this.trace.recordCall(input); else this.trace.recordResult(input); this.traceObserver(input); } catch (error) { void error; /* observers never own outcomes */ }
  }
  private hitFault(method: string, point: "before_effect" | "effect_then_lost_acknowledgement"): boolean {
    const key = `${method}:${point}`;
    const occurrence = (this.faultCounts.get(key) ?? 0) + 1;
    this.faultCounts.set(key, occurrence);
    return this.plannedFaults.get(key)?.has(occurrence) ?? this.context.faults.hit(point);
  }
  private decision(key: string, method: FakeMutationMethod, hash: string, runId: string | null): unknown | undefined {
    const existing = this.backend.decisions.get(key); if (!existing) return undefined;
    if (existing.method !== method || existing.requestHash !== hash) throw new FakeFailure(err("idempotency_conflict"));
    if (existing.runId !== runId || (existing.runId !== null && !validScheduledRunId(existing.runId))) throw new FakeFailure(err("corrupt_state"));
    return clone(existing.value);
  }
  private recordDecision(key: string, method: "bindAcceptedSource" | "complete" | "abandon", hash: string, id: string): ScheduledRunRecord | null {
    const existing = this.backend.decisions.get(key);
    if (existing) {
      if (existing.method !== method || existing.requestHash !== hash) throw new FakeFailure(err("idempotency_conflict"));
      if (existing.runId !== id || !validScheduledRunId(existing.runId)) throw new FakeFailure(err("corrupt_state"));
      const saved = decodeScheduledRunRecord(existing.value), current = this.readRecord(id);
      if (!saved || !current || saved.taskId !== current.taskId || saved.scheduledFor !== current.scheduledFor) throw new FakeFailure(err("corrupt_state"));
      return current.retained ? current : saved;
    }
    const tombstone = this.backend.tombstones.get(id); if (!tombstone) return null;
    if (tombstone.decisionMethod !== method || tombstone.decisionHash !== hash) throw new FakeFailure(err("idempotency_conflict"));
    return this.requireRecord(tombstone);
  }
  private restoreClaim(request: ClaimDueRunsRequest, value: unknown): readonly ScheduledRunLease[] {
    const rows = decodeClaimReplayRows(value); if (!rows) throw new FakeFailure(err("corrupt_state"));
    return Object.freeze(rows.map((row) => {
      const run = this.backend.runs.get(row.runId);
      if (!run || run.record.state !== row.state || run.record.attempt !== row.attempt) throw new FakeFailure(err("invalid_transition"));
      const record = this.requireRecord(run.record);
      if (record.state !== "claimed" && record.state !== "source_bound") throw new FakeFailure(err("invalid_transition"));
      const leaseToken = token(request.leaseTokenPrefix, row.runId, row.attempt);
      if (run.tokenHash !== tokenHash(leaseToken)) throw new FakeFailure(err("corrupt_state"));
      return Object.freeze({ record: record as ScheduledRunLease["record"], task: run.snapshot, leaseToken });
    }));
  }
  private readRecord(id: string): ScheduledRunRecord | null {
    const run = this.backend.runs.get(id);
    if (run) { this.validateRun(run); return this.requireRecord(run.record); }
    const tombstone = this.backend.tombstones.get(id) ?? null;
    return tombstone ? this.requireRecord(tombstone) : null;
  }
  private validateRun(run: Run): void {
    if (run.leaseAuthorities.length !== run.record.attempt) throw new FakeFailure(err("corrupt_state"));
    for (const [index, authority] of run.leaseAuthorities.entries()) {
      const attempt = index + 1;
      const valid = authority.attempt === attempt && (attempt === 1
        ? authority.kind === "new" && authority.reconciliationRef === null
        : run.snapshot.executionRepeatability === "agent_source"
          ? authority.kind === "agent_reconciled_absent" && typeof authority.reconciliationRef === "string"
          : run.snapshot.executionRepeatability === "repeatable"
            ? authority.kind === "repeatable" && authority.reconciliationRef === null
            : authority.kind === "reconciled_absent" && typeof authority.reconciliationRef === "string");
      if (!valid) throw new FakeFailure(err("corrupt_state"));
    }
  }
  private requireRecord(value: unknown): ScheduledRunRecord {
    const candidate = value && typeof value === "object" && "decisionHash" in value
      ? (({ decisionHash: _hash, decisionMethod: _method, ...record }) => record)(value as Tombstone)
      : value;
    const record = decodeScheduledRunRecord(candidate);
    if (!record) throw new FakeFailure(err("corrupt_state"));
    return record;
  }
  private fence(request: { runId: string; workerId: string; expectedAttempt: number; expectedTaskRevision: number; leaseToken: string; now: string }) {
    const run = this.backend.runs.get(request.runId); if (!run) return Result.err(err(this.backend.tombstones.has(request.runId) ? "invalid_transition" : "not_found"));
    this.requireRecord(run.record);
    if (run.record.taskRevision !== request.expectedTaskRevision) return Result.err(err("task_revision_mismatch", "not_applied", { observedTaskRevision: run.record.taskRevision }));
    if (run.record.state === "completed" || run.record.state === "abandoned") return Result.err(err("invalid_transition"));
    if (run.record.workerId !== request.workerId || run.record.attempt !== request.expectedAttempt || run.tokenHash !== tokenHash(request.leaseToken)) return Result.err(err("lease_conflict", "not_applied", { observedAttempt: run.record.attempt }));
    if (run.record.leaseExpiresAt! <= request.now) return Result.err(err("lease_expired"));
    return Result.ok(run);
  }
  private resultShapeError(run: Run, request: CompleteScheduledRunRequest): "invalid_transition" | "invalid_request" | null {
    if (run.snapshot.kind === "agent") {
      if (run.record.state !== "source_bound" || run.record.acceptedSourceSeq === null || run.record.operationId === null) return "invalid_transition";
      return request.effect.operationId === run.record.operationId && request.effect.sourceSeq === run.record.acceptedSourceSeq ? null : "invalid_request";
    }
    if (run.record.state !== "claimed" || run.record.acceptedSourceSeq !== null || run.record.operationId !== null) return "invalid_transition";
    return request.effect.operationId === null && request.effect.sourceSeq === null ? null : "invalid_request";
  }
  private successor(run: Run, settledAt: string, retryAt: string | null): string | null {
    const next = retryAt ?? computeScheduledSuccessor(run.snapshot, run.record.scheduledFor, settledAt);
    if (run.snapshot.scheduleType !== "once" && !next) throw new FakeFailure(err("corrupt_state"));
    return next;
  }
  private headDecision(run: Run, _next: string | null): "advanced" | "paused" | "deleted" | "superseded" {
    const head = this.backend.heads.get(run.record.taskId); if (!head) throw new FakeFailure(err("task_not_found"));
    if (head.status === "deleted") return "deleted";
    if (head.revision !== run.record.taskRevision || head.nextRunAt !== run.record.scheduledFor) return "superseded";
    if (head.status === "paused") return "paused"; if (head.status === "active") return "advanced";
    throw new FakeFailure(err("task_inactive"));
  }
  private advanceHead(run: Run, next: string | null, disposition: string): void { if (disposition !== "advanced") return; const head = this.backend.heads.get(run.record.taskId)!; head.nextRunAt = next; head.status = next === null ? "completed" : "active"; }
}
