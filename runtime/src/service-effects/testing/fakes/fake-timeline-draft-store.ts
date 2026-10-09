import { Result, type Result as ResultValue } from "../../contracts/result.js";

import { hashCanonicalRequest, type CanonicalJsonValue } from "../../contracts/common.js";
import type { EffectPayloadResolver } from "../../contracts/payload-resolver.js";
import type {
  CommitDraftRequest,
  CommitServiceNoticeRequest,
  OperationArtifacts,
  TimelineDraftStore,
  TimelineStoreError,
  TimelineStoreErrorTag,
  TimelineWrite,
} from "../../contracts/timeline-draft-store.js";
import type { ContractTestContext } from "../contract-suite.js";
import { EffectTraceRecorder } from "../trace-recorder.js";
import {
  fakeResolveVerifiedJson,
  fakeResolveVerifiedText,
  fakeValidateContentBlocks,
} from "./fake-payload-validation.js";

interface FakeTimelineRevision {
  readonly key: string;
  readonly requestHash: string;
  readonly writeType: "draft" | "notice";
  readonly operationId: string | null;
  readonly draftKind: string | null;
  readonly revision: number | null;
  readonly noticeKind: string | null;
  readonly sourceId: string | null;
  readonly write: TimelineWrite;
}

interface FakeTimelineRow {
  readonly rowId: number;
  readonly chatJid: string;
  readonly operationId: string | null;
  readonly draftKind: string | null;
  readonly content: string;
  readonly threadId: number | null;
  readonly mediaIds: readonly number[];
  readonly terminal: false;
}

export interface FakeTimelineDraftSnapshot {
  readonly nextRowId: number;
  readonly revisions: readonly FakeTimelineRevision[];
  readonly rows: readonly FakeTimelineRow[];
  readonly trace: ReturnType<EffectTraceRecorder["snapshot"]>;
}

export class FakeTimelineDraftStore implements TimelineDraftStore {
  trace = new EffectTraceRecorder();
  #nextRowId = 1;
  #revisions: FakeTimelineRevision[] = [];
  #rows: FakeTimelineRow[] = [];

  constructor(
    private readonly payloads: EffectPayloadResolver,
    private readonly context: ContractTestContext,
    private readonly mediaIsDraftOwned: (operationId: string, mediaId: number) => boolean,
  ) {}

  async commitDraft(request: CommitDraftRequest): Promise<ResultValue<TimelineWrite, TimelineStoreError>> {
    this.call("commitDraft", request.effect.idempotencyKey, request.effect.operationId, request.revision);
    if (!hasValidRequestHash(request)) return this.fail("commitDraft", request, "idempotency_conflict");
    if (this.context.faults.hit("before_effect")) return this.fail("commitDraft", request, "storage_unavailable", "not_applied", true);
    const byKey = this.#revisions.find((entry) => entry.key === request.effect.idempotencyKey);
    if (byKey) return this.replay("commitDraft", request, byKey);
    const known = this.#revisions.find((entry) => entry.writeType === "draft" && entry.operationId === request.effect.operationId && entry.draftKind === request.draftKind && entry.revision === request.revision);
    if (known) return this.replay("commitDraft", request, known);
    const latest = this.latest(request.effect.operationId, request.draftKind);
    if (!Number.isSafeInteger(request.revision) || request.revision < 0 || (latest && request.revision <= (latest.revision ?? -1))) {
      return this.fail("commitDraft", request, "stale_revision");
    }
    const payloads = await this.resolve(request.contentRef, request.contentBlocksRef);
    if (!payloads.ok) return this.fail("commitDraft", request, payloads.error);
    const byKeyAfterResolve = this.#revisions.find((entry) => entry.key === request.effect.idempotencyKey);
    if (byKeyAfterResolve) return this.replay("commitDraft", request, byKeyAfterResolve);
    const knownAfterResolve = this.#revisions.find((entry) =>
      entry.writeType === "draft" && entry.operationId === request.effect.operationId &&
      entry.draftKind === request.draftKind && entry.revision === request.revision);
    if (knownAfterResolve) return this.replay("commitDraft", request, knownAfterResolve);
    const latestAfterResolve = this.latest(request.effect.operationId, request.draftKind);
    if (latestAfterResolve && request.revision <= (latestAfterResolve.revision ?? -1)) {
      return this.fail("commitDraft", request, "stale_revision");
    }
    if (new Set(request.mediaIds).size !== request.mediaIds.length || request.mediaIds.some((id) => !this.mediaIsDraftOwned(request.effect.operationId, id))) {
      return this.fail("commitDraft", request, "missing_media");
    }

    let row: FakeTimelineRow;
    const currentLatest = latestAfterResolve ?? latest;
    if (request.mode === "replace") {
      if (!request.existingRowId || !currentLatest || currentLatest.write.rowId !== request.existingRowId) {
        return this.fail("commitDraft", request, "row_owner_conflict");
      }
      const index = this.#rows.findIndex((entry) => entry.rowId === request.existingRowId);
      if (index < 0) return this.fail("commitDraft", request, "row_not_found");
      const current = this.#rows[index];
      if (current.chatJid !== request.chatJid || current.threadId !== request.threadId || current.operationId !== request.effect.operationId) {
        return this.fail("commitDraft", request, "row_owner_conflict");
      }
      row = Object.freeze({ ...current, content: payloads.content, mediaIds: Object.freeze([...request.mediaIds]) });
      this.#rows[index] = row;
    } else {
      if (request.existingRowId !== null || currentLatest) return this.fail("commitDraft", request, "row_owner_conflict");
      row = Object.freeze({
        rowId: this.#nextRowId++, chatJid: request.chatJid, operationId: request.effect.operationId,
        draftKind: request.draftKind, content: payloads.content, threadId: request.threadId,
        mediaIds: Object.freeze([...request.mediaIds]), terminal: false,
      });
      this.#rows.push(row);
    }
    const write = timelineWrite(row.rowId, request.chatJid, request.effect.operationId, request.revision, request.writtenAt);
    this.#revisions.push(Object.freeze({
      key: request.effect.idempotencyKey, requestHash: request.effect.requestHash, writeType: "draft",
      operationId: request.effect.operationId, draftKind: request.draftKind, revision: request.revision,
      noticeKind: null, sourceId: null, write,
    }));
    if (this.context.faults.hit("effect_then_lost_acknowledgement")) return this.fail("commitDraft", request, "storage_unavailable", "unknown", true);
    return this.ok("commitDraft", request, write);
  }

  async commitServiceNotice(request: CommitServiceNoticeRequest): Promise<ResultValue<TimelineWrite, TimelineStoreError>> {
    this.call("commitServiceNotice", request.effect.idempotencyKey, request.effect.operationId, null);
    if (!hasValidRequestHash(request)) return this.fail("commitServiceNotice", request, "idempotency_conflict");
    if (this.context.faults.hit("before_effect")) return this.fail("commitServiceNotice", request, "storage_unavailable", "not_applied", true);
    const byKey = this.#revisions.find((entry) => entry.key === request.effect.idempotencyKey);
    if (byKey) return this.replay("commitServiceNotice", request, byKey);
    const existing = this.#revisions.find((entry) => entry.writeType === "notice" && entry.noticeKind === request.noticeKind && entry.sourceId === request.sourceId);
    if (existing) return this.replay("commitServiceNotice", request, existing);
    const payloads = await this.resolve(request.contentRef, request.contentBlocksRef);
    if (!payloads.ok) return this.fail("commitServiceNotice", request, payloads.error);
    const byKeyAfterResolve = this.#revisions.find((entry) => entry.key === request.effect.idempotencyKey);
    if (byKeyAfterResolve) return this.replay("commitServiceNotice", request, byKeyAfterResolve);
    const existingAfterResolve = this.#revisions.find((entry) =>
      entry.writeType === "notice" && entry.noticeKind === request.noticeKind && entry.sourceId === request.sourceId);
    if (existingAfterResolve) return this.replay("commitServiceNotice", request, existingAfterResolve);
    const row = Object.freeze({
      rowId: this.#nextRowId++, chatJid: request.chatJid, operationId: null, draftKind: null,
      content: payloads.content, threadId: null, mediaIds: Object.freeze([]), terminal: false as const,
    });
    this.#rows.push(row);
    const write = timelineWrite(row.rowId, request.chatJid, null, null, request.writtenAt);
    this.#revisions.push(Object.freeze({
      key: request.effect.idempotencyKey, requestHash: request.effect.requestHash, writeType: "notice",
      operationId: null, draftKind: null, revision: null, noticeKind: request.noticeKind,
      sourceId: request.sourceId, write,
    }));
    if (this.context.faults.hit("effect_then_lost_acknowledgement")) return this.fail("commitServiceNotice", request, "storage_unavailable", "unknown", true);
    return this.ok("commitServiceNotice", request, write);
  }

  async getOperationArtifacts(operationId: string): Promise<ResultValue<OperationArtifacts, TimelineStoreError>> {
    const effectId = this.context.ids.nextId();
    this.call("getOperationArtifacts", effectId, operationId, null);
    const byKind = new Map<string, FakeTimelineRevision>();
    for (const revision of this.#revisions.filter((entry) => entry.writeType === "draft" && entry.operationId === operationId)) {
      const prior = revision.draftKind ? byKind.get(revision.draftKind) : undefined;
      if (revision.draftKind && (!prior || (revision.revision ?? -1) > (prior.revision ?? -1))) byKind.set(revision.draftKind, revision);
    }
    const rowIds = new Set([...byKind.values()].map((entry) => entry.write.rowId));
    const mediaIds = [...new Set(this.#rows.filter((row) => rowIds.has(row.rowId)).flatMap((row) => [...row.mediaIds]))].sort((a, b) => a - b);
    const value = Object.freeze({
      operationId,
      draftRows: Object.freeze([...byKind.values()].map((entry) => entry.write)),
      mediaIds: Object.freeze(mediaIds),
    });
    this.trace.recordResult({ contract: "EF-S03", method: "getOperationArtifacts", effectId, operationId, certainty: "applied", resultTag: "ok" });
    return Result.ok(value);
  }

  inspectRows(): readonly FakeTimelineRow[] { return Object.freeze([...this.#rows]); }

  injectHistoricalMedia(operationId: string, draftKind: string, mediaId: number): void {
    const latest = this.latest(operationId, draftKind);
    if (!latest) throw new Error("cannot inject history without a current draft");
    const historical = this.#revisions.find((entry) =>
      entry.writeType === "draft" && entry.operationId === operationId && entry.draftKind === draftKind && entry !== latest);
    if (!historical) throw new Error("cannot inject history without an older revision");
    const row = this.#rows.find((entry) => entry.rowId === historical.write.rowId);
    if (!row) throw new Error("historical row is missing");
    const historicalRowId = this.#nextRowId++;
    this.#rows.push(Object.freeze({ ...row, rowId: historicalRowId, mediaIds: Object.freeze([mediaId]) }));
    const index = this.#revisions.indexOf(historical);
    this.#revisions[index] = Object.freeze({
      ...historical,
      write: timelineWrite(historicalRowId, historical.write.chatJid, operationId, historical.revision, historical.write.writtenAt),
    });
  }

  snapshot(): FakeTimelineDraftSnapshot {
    return structuredClone({ nextRowId: this.#nextRowId, revisions: this.#revisions, rows: this.#rows, trace: this.trace.snapshot() });
  }
  restore(snapshot: FakeTimelineDraftSnapshot): void {
    const state = structuredClone(snapshot);
    this.#nextRowId = state.nextRowId;
    this.#revisions = [...state.revisions];
    this.#rows = [...state.rows];
    this.trace = EffectTraceRecorder.fromSnapshot(state.trace);
  }

  private latest(operationId: string, draftKind: string): FakeTimelineRevision | undefined {
    return this.#revisions
      .filter((entry) => entry.writeType === "draft" && entry.operationId === operationId && entry.draftKind === draftKind)
      .sort((a, b) => (b.revision ?? -1) - (a.revision ?? -1))[0];
  }
  private replay(method: string, request: EffectRequest & { effect: { requestHash: string } }, known: FakeTimelineRevision): ResultValue<TimelineWrite, TimelineStoreError> {
    return known.requestHash === request.effect.requestHash
      ? this.ok(method, request, known.write, "duplicate")
      : this.fail(method, request, "idempotency_conflict");
  }
  private async resolve(contentRef: string, blocksRef: string | null): Promise<{ ok: true; content: string } | { ok: false; error: TimelineStoreErrorTag }> {
    const content = await fakeResolveVerifiedText(this.payloads, contentRef);
    if (content === null) return { ok: false, error: "storage_unavailable" };
    if (!blocksRef) return { ok: true, content };
    const blocks = await fakeResolveVerifiedJson(this.payloads, blocksRef);
    return fakeValidateContentBlocks(blocks)
      ? { ok: true, content }
      : { ok: false, error: "invalid_content_blocks" };
  }
  private call(method: string, effectId: string, operationId: string | null, version: number | null): void {
    this.trace.recordCall({ contract: "EF-S03", method, effectId, operationId, version });
  }
  private ok<T>(method: string, request: EffectRequest, value: T, resultTag = "ok"): ResultValue<T, never> {
    this.trace.recordResult({ contract: "EF-S03", method, effectId: request.effect.idempotencyKey, operationId: request.effect.operationId, certainty: "applied", resultTag });
    return Result.ok(value);
  }
  private fail(method: string, request: EffectRequest, tag: TimelineStoreErrorTag, certainty: TimelineStoreError["certainty"] = "not_applied", retryable = false): ResultValue<never, TimelineStoreError> {
    this.trace.recordResult({ contract: "EF-S03", method, effectId: request.effect.idempotencyKey, operationId: request.effect.operationId, certainty, resultTag: tag });
    return Result.err(Object.freeze({ _tag: tag, certainty, retryable }));
  }
}

type EffectRequest = { effect: { idempotencyKey: string; operationId: string | null } };

function hasValidRequestHash(request: { effect: { requestHash: string } }): boolean {
  return request.effect.requestHash === hashCanonicalRequest(request as unknown as CanonicalJsonValue);
}

function timelineWrite(rowId: number, chatJid: string, operationId: string | null, revision: number | null, writtenAt: string): TimelineWrite {
  return Object.freeze({ rowId, chatJid, operationId, revision, terminal: false, writtenAt });
}
