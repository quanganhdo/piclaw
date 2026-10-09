import { Result, type Result as ResultValue } from "../contracts/result.js";
import type Database from "bun:sqlite";

import { validateServiceEffectContentBlocks } from "../../channels/web/messaging/content-block-safety.js";
import { hashCanonicalRequest, type CanonicalJsonValue } from "../contracts/common.js";
import { storeMessageInDatabase, replaceMessageContentInDatabase } from "../../db/messages.js";
import type { NewMessage } from "../../types.js";
import type { EffectPayloadResolver } from "../contracts/payload-resolver.js";
import type {
  CommitDraftRequest,
  CommitServiceNoticeRequest,
  OperationArtifacts,
  TimelineDraftStore,
  TimelineStoreError,
  TimelineStoreErrorTag,
  TimelineWrite,
} from "../contracts/timeline-draft-store.js";
import { resolveVerifiedJson, resolveVerifiedText } from "../payloads.js";
import type { CurrentPiclawAdapterRuntime } from "./adapter-runtime.js";

interface TimelineWriteRow {
  idempotency_key: string;
  request_hash: string;
  write_type: "draft" | "notice";
  operation_id: string | null;
  draft_kind: string | null;
  revision: number | null;
  notice_kind: string | null;
  source_id: string | null;
  message_rowid: number;
  chat_jid: string;
  written_at: string;
}

export class CurrentPiclawTimelineDraftStore implements TimelineDraftStore {
  constructor(
    readonly database: Database,
    private readonly payloads: EffectPayloadResolver,
    private readonly runtime: CurrentPiclawAdapterRuntime,
  ) {}

  async commitDraft(request: CommitDraftRequest): Promise<ResultValue<TimelineWrite, TimelineStoreError>> {
    this.call("commitDraft", request.effect.idempotencyKey, request.effect.operationId, request.revision);
    if (!hasValidRequestHash(request)) return this.failure("commitDraft", request, "idempotency_conflict");
    if (this.runtime.hitFault("before_effect")) {
      return this.failure("commitDraft", request, "storage_unavailable", "not_applied", true);
    }

    try {
      const reconciled = this.findByKey(request.effect.idempotencyKey) ?? this.findDraftRevision(request);
      if (reconciled) return this.replayOrConflict("commitDraft", request, reconciled);
      if (!Number.isSafeInteger(request.revision) || request.revision < 0) {
        return this.failure("commitDraft", request, "stale_revision");
      }
      const resolved = await this.resolveTimelinePayloads(request.contentRef, request.contentBlocksRef);
      if (!resolved.ok) return this.failure("commitDraft", request, resolved.error);

      const outcome = this.database.transaction((): TimelineMutationOutcome => {
        const byKey = this.findByKey(request.effect.idempotencyKey);
        if (byKey) return replayOutcome(request.effect.requestHash, byKey);
        const knownRevision = this.database.prepare(`
          SELECT * FROM service_effect_timeline_writes
          WHERE write_type = 'draft' AND operation_id = ? AND draft_kind = ? AND revision = ?
        `).get(request.effect.operationId, request.draftKind, request.revision) as TimelineWriteRow | undefined;
        if (knownRevision) return replayOutcome(request.effect.requestHash, knownRevision);

        const latest = this.database.prepare(`
          SELECT * FROM service_effect_timeline_writes
          WHERE write_type = 'draft' AND operation_id = ? AND draft_kind = ?
          ORDER BY revision DESC LIMIT 1
        `).get(request.effect.operationId, request.draftKind) as TimelineWriteRow | undefined;
        if (latest && request.revision <= (latest.revision ?? -1)) {
          return { ok: false, tag: "stale_revision" };
        }
        if (!this.mediaAreDraftOwned(request.effect.operationId, request.mediaIds)) {
          return { ok: false, tag: "missing_media" };
        }

        let rowId: number;
        if (request.mode === "replace") {
          if (!request.existingRowId || !latest || latest.message_rowid !== request.existingRowId) {
            return { ok: false, tag: "row_owner_conflict" };
          }
          const current = this.database.prepare(`
            SELECT chat_jid, thread_id, is_terminal_agent_reply FROM messages WHERE rowid = ?
          `).get(request.existingRowId) as {
            chat_jid: string;
            thread_id: number | null;
            is_terminal_agent_reply: number;
          } | undefined;
          if (!current) return { ok: false, tag: "row_not_found" };
          if (
            current.chat_jid !== request.chatJid || current.thread_id !== request.threadId ||
            current.is_terminal_agent_reply !== 0
          ) return { ok: false, tag: "row_owner_conflict" };
          if (!replaceMessageContentInDatabase(
            this.database,
            request.chatJid,
            request.existingRowId,
            resolved.content,
            { contentBlocks: resolved.blocks ? [...resolved.blocks] : undefined, mediaIds: [...request.mediaIds], isTerminalAgentReply: false },
          )) return { ok: false, tag: "row_not_found" };
          rowId = request.existingRowId;
        } else {
          if (request.existingRowId !== null || latest) return { ok: false, tag: "row_owner_conflict" };
          this.ensureChat(request.chatJid, request.writtenAt);
          rowId = storeMessageInDatabase(this.database, draftMessage(request, resolved.content, resolved.blocks));
          if (rowId <= 0) throw new Error("draft insert failed");
          if (request.mediaIds.length > 0 && !replaceMessageContentInDatabase(
            this.database,
            request.chatJid,
            rowId,
            resolved.content,
            { contentBlocks: resolved.blocks ? [...resolved.blocks] : undefined, mediaIds: [...request.mediaIds], isTerminalAgentReply: false },
          )) throw new Error("draft media attachment failed");
        }

        this.database.prepare(`
          INSERT INTO service_effect_timeline_writes (
            idempotency_key, request_hash, write_type, operation_id, draft_kind,
            revision, notice_kind, source_id, message_rowid, chat_jid, written_at
          ) VALUES (?, ?, 'draft', ?, ?, ?, NULL, NULL, ?, ?, ?)
        `).run(
          request.effect.idempotencyKey,
          request.effect.requestHash,
          request.effect.operationId,
          request.draftKind,
          request.revision,
          rowId,
          request.chatJid,
          request.writtenAt,
        );
        return { ok: true, write: timelineWrite(rowId, request.chatJid, request.effect.operationId, request.revision, request.writtenAt), duplicate: false };
      }).immediate();

      if (!outcome.ok) return this.failure("commitDraft", request, outcome.tag);
      if (outcome.duplicate) return this.success("commitDraft", request, outcome.write, "duplicate");
      if (this.runtime.hitFault("effect_then_lost_acknowledgement")) {
        return this.failure("commitDraft", request, "storage_unavailable", "unknown", true);
      }
      return this.success("commitDraft", request, outcome.write);
    } catch {
      return this.failure("commitDraft", request, "storage_unavailable", "unknown", true);
    }
  }

  async commitServiceNotice(
    request: CommitServiceNoticeRequest,
  ): Promise<ResultValue<TimelineWrite, TimelineStoreError>> {
    this.call("commitServiceNotice", request.effect.idempotencyKey, request.effect.operationId, null);
    if (!hasValidRequestHash(request)) return this.failure("commitServiceNotice", request, "idempotency_conflict");
    if (this.runtime.hitFault("before_effect")) {
      return this.failure("commitServiceNotice", request, "storage_unavailable", "not_applied", true);
    }
    try {
      const reconciled = this.findByKey(request.effect.idempotencyKey) ?? this.findNotice(request);
      if (reconciled) return this.replayOrConflict("commitServiceNotice", request, reconciled);
      const resolved = await this.resolveTimelinePayloads(request.contentRef, request.contentBlocksRef);
      if (!resolved.ok) return this.failure("commitServiceNotice", request, resolved.error);

      const outcome = this.database.transaction((): TimelineMutationOutcome => {
        const byKey = this.findByKey(request.effect.idempotencyKey);
        if (byKey) return replayOutcome(request.effect.requestHash, byKey);
        const existing = this.findNotice(request);
        if (existing) return replayOutcome(request.effect.requestHash, existing);
        this.ensureChat(request.chatJid, request.writtenAt);
        const rowId = storeMessageInDatabase(this.database, noticeMessage(request, resolved.content, resolved.blocks));
        if (rowId <= 0) throw new Error("notice insert failed");
        this.database.prepare(`
          INSERT INTO service_effect_timeline_writes (
            idempotency_key, request_hash, write_type, operation_id, draft_kind,
            revision, notice_kind, source_id, message_rowid, chat_jid, written_at
          ) VALUES (?, ?, 'notice', NULL, NULL, NULL, ?, ?, ?, ?, ?)
        `).run(
          request.effect.idempotencyKey, request.effect.requestHash, request.noticeKind,
          request.sourceId, rowId, request.chatJid, request.writtenAt,
        );
        return { ok: true, write: timelineWrite(rowId, request.chatJid, null, null, request.writtenAt), duplicate: false };
      }).immediate();

      if (!outcome.ok) return this.failure("commitServiceNotice", request, outcome.tag);
      if (outcome.duplicate) return this.success("commitServiceNotice", request, outcome.write, "duplicate");
      if (this.runtime.hitFault("effect_then_lost_acknowledgement")) {
        return this.failure("commitServiceNotice", request, "storage_unavailable", "unknown", true);
      }
      return this.success("commitServiceNotice", request, outcome.write);
    } catch {
      return this.failure("commitServiceNotice", request, "storage_unavailable", "unknown", true);
    }
  }

  async getOperationArtifacts(
    operationId: string,
  ): Promise<ResultValue<OperationArtifacts, TimelineStoreError>> {
    const effectId = this.runtime.nextId();
    this.call("getOperationArtifacts", effectId, operationId, null);
    try {
      const rows = this.database.prepare(`
        SELECT * FROM service_effect_timeline_writes
        WHERE write_type = 'draft' AND operation_id = ?
        ORDER BY draft_kind, revision DESC
      `).all(operationId) as TimelineWriteRow[];
      const latest = new Map<string, TimelineWriteRow>();
      for (const row of rows) if (row.draft_kind && !latest.has(row.draft_kind)) latest.set(row.draft_kind, row);
      const draftRows = Object.freeze([...latest.values()].map(writeFromRow));
      const latestRowIds = [...latest.values()].map((row) => row.message_rowid);
      const mediaIds = latestRowIds.length === 0
        ? []
        : (this.database.prepare(`
          SELECT DISTINCT media_id FROM message_media
          WHERE message_rowid IN (${latestRowIds.map(() => "?").join(",")})
          ORDER BY media_id
        `).all(...latestRowIds) as Array<{ media_id: number }>).map((row) => row.media_id);
      const value = Object.freeze({
        operationId,
        draftRows,
        mediaIds: Object.freeze(mediaIds),
      });
      this.runtime.recordTrace({
        contract: "EF-S03", method: "getOperationArtifacts", effectId,
        operationId, certainty: "applied", resultTag: "ok",
      });
      return Result.ok(value);
    } catch {
      this.runtime.recordTrace({
        contract: "EF-S03", method: "getOperationArtifacts", effectId,
        operationId, certainty: "unknown", resultTag: "storage_unavailable",
      });
      return Result.err(timelineError("storage_unavailable", "unknown", true));
    }
  }

  private findByKey(idempotencyKey: string): TimelineWriteRow | undefined {
    return this.database.prepare(
      "SELECT * FROM service_effect_timeline_writes WHERE idempotency_key = ?",
    ).get(idempotencyKey) as TimelineWriteRow | undefined;
  }

  private findDraftRevision(request: CommitDraftRequest): TimelineWriteRow | undefined {
    return this.database.prepare(`
      SELECT * FROM service_effect_timeline_writes
      WHERE write_type = 'draft' AND operation_id = ? AND draft_kind = ? AND revision = ?
    `).get(request.effect.operationId, request.draftKind, request.revision) as TimelineWriteRow | undefined;
  }

  private findNotice(request: CommitServiceNoticeRequest): TimelineWriteRow | undefined {
    return this.database.prepare(`
      SELECT * FROM service_effect_timeline_writes
      WHERE write_type = 'notice' AND notice_kind = ? AND source_id = ?
    `).get(request.noticeKind, request.sourceId) as TimelineWriteRow | undefined;
  }

  private replayOrConflict<TRequest extends { effect: { requestHash: string } }>(
    method: string,
    request: TRequest & { effect: { idempotencyKey: string; requestHash: string; operationId: string | null } },
    row: TimelineWriteRow,
  ): ResultValue<TimelineWrite, TimelineStoreError> {
    return row.request_hash === request.effect.requestHash
      ? this.success(method, request, writeFromRow(row), "duplicate")
      : this.failure(method, request, "idempotency_conflict");
  }

  private async resolveTimelinePayloads(
    contentRef: string,
    contentBlocksRef: string | null,
  ): Promise<
    | { ok: true; content: string; blocks: readonly Readonly<Record<string, unknown>>[] | null }
    | { ok: false; error: TimelineStoreErrorTag }
  > {
    const content = await resolveVerifiedText(this.payloads, contentRef);
    if (content === null) return { ok: false, error: "storage_unavailable" };
    if (!contentBlocksRef) return { ok: true, content, blocks: null };
    const rawBlocks = await resolveVerifiedJson(this.payloads, contentBlocksRef);
    const blocks = validateServiceEffectContentBlocks(rawBlocks);
    return blocks ? { ok: true, content, blocks } : { ok: false, error: "invalid_content_blocks" };
  }

  private mediaAreDraftOwned(operationId: string, mediaIds: readonly number[]): boolean {
    if (new Set(mediaIds).size !== mediaIds.length) return false;
    for (const mediaId of mediaIds) {
      const row = this.database.prepare(`
        SELECT 1 FROM service_effect_operation_media
        WHERE operation_id = ? AND media_id = ? AND role = 'draft'
      `).get(operationId, mediaId);
      if (!row) return false;
    }
    return true;
  }

  private ensureChat(chatJid: string, writtenAt: string): void {
    this.database.prepare(`
      INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET last_message_time = MAX(last_message_time, excluded.last_message_time)
    `).run(chatJid, chatJid, writtenAt);
  }

  private call(method: string, effectId: string, operationId: string | null, version: number | null): void {
    this.runtime.recordTrace({ contract: "EF-S03", method, effectId, operationId, version });
  }

  private success<T>(
    method: string,
    request: { effect: { idempotencyKey: string; operationId: string | null } },
    value: T,
    resultTag = "ok",
  ): ResultValue<T, never> {
    this.runtime.recordTrace({
      contract: "EF-S03", method, effectId: request.effect.idempotencyKey,
      operationId: request.effect.operationId, certainty: "applied", resultTag,
    });
    return Result.ok(value);
  }

  private failure(
    method: string,
    request: { effect: { idempotencyKey: string; operationId: string | null } },
    tag: TimelineStoreErrorTag,
    certainty: TimelineStoreError["certainty"] = "not_applied",
    retryable = false,
  ): ResultValue<never, TimelineStoreError> {
    this.runtime.recordTrace({
      contract: "EF-S03", method, effectId: request.effect.idempotencyKey,
      operationId: request.effect.operationId, certainty, resultTag: tag,
    });
    return Result.err(timelineError(tag, certainty, retryable));
  }
}

function hasValidRequestHash(request: { effect: { requestHash: string } }): boolean {
  return request.effect.requestHash === hashCanonicalRequest(request as unknown as CanonicalJsonValue);
}

type TimelineMutationOutcome =
  | { readonly ok: true; readonly write: TimelineWrite; readonly duplicate: boolean }
  | { readonly ok: false; readonly tag: TimelineStoreErrorTag };

function replayOutcome(requestHash: string, row: TimelineWriteRow): TimelineMutationOutcome {
  return row.request_hash === requestHash
    ? { ok: true, write: writeFromRow(row), duplicate: true }
    : { ok: false, tag: "idempotency_conflict" };
}

function timelineError(
  tag: TimelineStoreErrorTag,
  certainty: TimelineStoreError["certainty"] = "not_applied",
  retryable = false,
): TimelineStoreError {
  return Object.freeze({ _tag: tag, certainty, retryable });
}

function timelineWrite(
  rowId: number,
  chatJid: string,
  operationId: string | null,
  revision: number | null,
  writtenAt: string,
): TimelineWrite {
  return Object.freeze({ rowId, chatJid, operationId, revision, terminal: false, writtenAt });
}

function writeFromRow(row: TimelineWriteRow): TimelineWrite {
  return timelineWrite(row.message_rowid, row.chat_jid, row.operation_id, row.revision, row.written_at);
}

function draftMessage(
  request: CommitDraftRequest,
  content: string,
  blocks: readonly Readonly<Record<string, unknown>>[] | null,
): NewMessage {
  return {
    id: `service-draft:${request.effect.idempotencyKey}`,
    chat_jid: request.chatJid,
    sender: "web-agent",
    sender_name: "Piclaw",
    content,
    timestamp: request.writtenAt,
    is_from_me: false,
    is_bot_message: true,
    is_terminal_agent_reply: false,
    content_blocks: blocks ? [...blocks] : undefined,
    thread_id: request.threadId,
  };
}

function noticeMessage(
  request: CommitServiceNoticeRequest,
  content: string,
  blocks: readonly Readonly<Record<string, unknown>>[] | null,
): NewMessage {
  return {
    id: `service-notice:${request.noticeKind}:${request.sourceId}`,
    chat_jid: request.chatJid,
    sender: "web-agent",
    sender_name: "Piclaw",
    content,
    timestamp: request.writtenAt,
    is_from_me: false,
    is_bot_message: true,
    is_terminal_agent_reply: false,
    content_blocks: blocks ? [...blocks] : undefined,
    thread_id: null,
  };
}
