import { Result, type Result as ResultValue } from "../contracts/result.js";
import type Database from "bun:sqlite";

import {
  createMediaInDatabase,
  deleteUnreferencedMediaInDatabase,
  getMediaByIdFromDatabase,
} from "../../db/media.js";
import { hashCanonicalRequest, type CanonicalJsonValue } from "../contracts/common.js";
import type {
  BindOperationMediaRequest,
  CreateMediaRequest,
  DeleteMediaIfUnreferencedRequest,
  MediaRef,
  MediaStoreError,
  MediaStoreErrorTag,
  OperationMediaBinding,
  OperationMediaStore,
  StoredMediaRecord,
} from "../contracts/operation-media-store.js";
import type { EffectPayloadResolver } from "../contracts/payload-resolver.js";
import { resolveVerifiedJson, resolveVerifiedPayload, sha256Bytes } from "../payloads.js";
import type { CurrentPiclawAdapterRuntime } from "./adapter-runtime.js";

interface UploadRow {
  idempotency_key: string;
  request_hash: string;
  upload_id: string;
  media_id: number;
  sha256: string;
  byte_length: number;
  data_ref: string;
  thumbnail_ref: string | null;
  metadata_ref: string | null;
  created_at: string;
}

interface BindingRow {
  idempotency_key: string;
  request_hash: string;
  operation_id: string;
  media_id: number;
  role: OperationMediaBinding["role"];
  bound_at: string;
}

export class CurrentPiclawOperationMediaStore implements OperationMediaStore {
  constructor(
    readonly database: Database,
    private readonly payloads: EffectPayloadResolver,
    private readonly runtime: CurrentPiclawAdapterRuntime,
  ) {}

  async create(request: CreateMediaRequest): Promise<ResultValue<MediaRef, MediaStoreError>> {
    this.call("create", request.effect.idempotencyKey, request.effect.operationId, null);
    if (!hasValidRequestHash(request)) return this.failure("create", request, "idempotency_conflict");
    if (this.runtime.hitFault("before_effect")) return this.failure("create", request, "storage_unavailable", "not_applied", true);

    try {
      const reconciled = this.findUploadByKey(request.effect.idempotencyKey) ?? this.findUploadById(request.uploadId);
      if (reconciled) return this.reconcileCreate(request, reconciled);
      if (!validCreateRequest(request)) return this.failure("create", request, "unsupported_media");
      const data = await resolveVerifiedPayload(this.payloads, request.dataRef);
      if (!data || data.sha256 !== request.sha256 || data.byteLength !== request.byteLength) {
        return this.failure("create", request, "digest_mismatch");
      }
      if (data.mediaType !== request.contentType) return this.failure("create", request, "unsupported_media");
      const thumbnail = request.thumbnailRef ? await resolveVerifiedPayload(this.payloads, request.thumbnailRef) : null;
      if (request.thumbnailRef && !thumbnail) return this.failure("create", request, "unsupported_media");
      const metadataValue = request.metadataRef ? await resolveVerifiedJson(this.payloads, request.metadataRef) : null;
      if (request.metadataRef && (!metadataValue || typeof metadataValue !== "object" || Array.isArray(metadataValue))) {
        return this.failure("create", request, "unsupported_media");
      }

      const outcome = this.database.transaction((): MediaCreateOutcome => {
        const byKey = this.findUploadByKey(request.effect.idempotencyKey);
        if (byKey) return byKey.request_hash === request.effect.requestHash
          ? { ok: true, ref: { mediaId: byKey.media_id, sha256: byKey.sha256 }, duplicate: true }
          : { ok: false, tag: "idempotency_conflict" };

        const byUpload = this.findUploadById(request.uploadId);
        if (byUpload) {
          if (byUpload.sha256 !== request.sha256 || byUpload.byte_length !== request.byteLength) {
            return { ok: false, tag: "digest_mismatch" };
          }
          return byUpload.request_hash === request.effect.requestHash
            ? { ok: true, ref: { mediaId: byUpload.media_id, sha256: byUpload.sha256 }, duplicate: true }
            : { ok: false, tag: "idempotency_conflict" };
        }

        const mediaId = createMediaInDatabase(
          this.database, request.filename, request.contentType, data.bytes, thumbnail?.bytes ?? null,
          metadataValue as Record<string, unknown> | null, request.createdAt,
        );
        for (const table of ["service_effect_media_upload_history", "service_effect_media_uploads"] as const) {
          this.database.prepare(`
            INSERT INTO ${table} (
              idempotency_key, request_hash, upload_id, media_id, sha256, byte_length,
              data_ref, thumbnail_ref, metadata_ref, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            request.effect.idempotencyKey, request.effect.requestHash, request.uploadId, mediaId,
            request.sha256, request.byteLength, request.dataRef, request.thumbnailRef,
            request.metadataRef, request.createdAt,
          );
        }
        return { ok: true, ref: Object.freeze({ mediaId, sha256: request.sha256 }), duplicate: false };
      }).immediate();

      if (!outcome.ok) return this.failure("create", request, outcome.tag);
      if (outcome.duplicate) return this.success("create", request, outcome.ref, "duplicate");
      if (this.runtime.hitFault("effect_then_lost_acknowledgement")) {
        return this.failure("create", request, "storage_unavailable", "unknown", true);
      }
      return this.success("create", request, outcome.ref);
    } catch {
      return this.failure("create", request, "storage_unavailable", "unknown", true);
    }
  }

  async bindToOperation(
    request: BindOperationMediaRequest,
  ): Promise<ResultValue<OperationMediaBinding, MediaStoreError>> {
    this.call("bindToOperation", request.effect.idempotencyKey, request.effect.operationId, null);
    if (!hasValidRequestHash(request)) return this.failure("bindToOperation", request, "idempotency_conflict");
    if (this.runtime.hitFault("before_effect")) {
      return this.failure("bindToOperation", request, "storage_unavailable", "not_applied", true);
    }

    try {
      const outcome = this.database.transaction((): MediaBindingOutcome => {
        const byKey = this.database.prepare(
          "SELECT * FROM service_effect_operation_media WHERE idempotency_key = ?",
        ).get(request.effect.idempotencyKey) as BindingRow | undefined;
        if (byKey) return byKey.request_hash === request.effect.requestHash
          ? { ok: true, binding: bindingFromRow(byKey), duplicate: true }
          : { ok: false, tag: "idempotency_conflict" };
        const media = this.database.prepare(
          "SELECT 1 FROM service_effect_media_uploads WHERE media_id = ?",
        ).get(request.mediaId);
        if (!media) return { ok: false, tag: "media_not_found" };
        const existing = this.database.prepare(`
          SELECT * FROM service_effect_operation_media
          WHERE operation_id = ? AND media_id = ? AND role = ?
        `).get(request.effect.operationId, request.mediaId, request.role) as BindingRow | undefined;
        if (existing) return existing.request_hash === request.effect.requestHash
          ? { ok: true, binding: bindingFromRow(existing), duplicate: true }
          : { ok: false, tag: "binding_conflict" };
        const binding = Object.freeze({
          operationId: request.effect.operationId, mediaId: request.mediaId,
          role: request.role, boundAt: request.boundAt,
        });
        this.database.prepare(`
          INSERT INTO service_effect_operation_media (
            idempotency_key, request_hash, operation_id, media_id, role, bound_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          request.effect.idempotencyKey, request.effect.requestHash, request.effect.operationId,
          request.mediaId, request.role, request.boundAt,
        );
        return { ok: true, binding, duplicate: false };
      }).immediate();

      if (!outcome.ok) return this.failure("bindToOperation", request, outcome.tag);
      if (outcome.duplicate) return this.success("bindToOperation", request, outcome.binding, "duplicate");
      if (this.runtime.hitFault("effect_then_lost_acknowledgement")) {
        return this.failure("bindToOperation", request, "storage_unavailable", "unknown", true);
      }
      return this.success("bindToOperation", request, outcome.binding);
    } catch {
      return this.failure("bindToOperation", request, "storage_unavailable", "unknown", true);
    }
  }

  async get(ref: MediaRef): Promise<ResultValue<StoredMediaRecord | null, MediaStoreError>> {
    const effectId = this.runtime.nextId();
    this.call("get", effectId, null, null);
    try {
      const upload = this.database.prepare(
        "SELECT * FROM service_effect_media_uploads WHERE media_id = ?",
      ).get(ref.mediaId) as UploadRow | undefined;
      if (!upload) return this.querySuccess("get", effectId, null, "absent");
      if (upload.sha256 !== ref.sha256) return this.queryFailure("get", effectId, "digest_mismatch");
      const media = getMediaByIdFromDatabase(this.database, ref.mediaId);
      if (!media || media.data.byteLength !== upload.byte_length || sha256Bytes(media.data) !== upload.sha256) {
        return this.queryFailure("get", effectId, "digest_mismatch");
      }
      return this.querySuccess("get", effectId, storedRecord(upload, media.filename, media.content_type));
    } catch {
      return this.queryFailure("get", effectId, "storage_unavailable", "unknown", true);
    }
  }

  async listForOperation(operationId: string): Promise<ResultValue<readonly MediaRef[], MediaStoreError>> {
    const effectId = this.runtime.nextId();
    this.call("listForOperation", effectId, operationId, null);
    try {
      const rows = this.database.prepare(`
        SELECT DISTINCT u.media_id, u.sha256
        FROM service_effect_operation_media b
        JOIN service_effect_media_uploads u ON u.media_id = b.media_id
        WHERE b.operation_id = ? ORDER BY u.media_id
      `).all(operationId) as Array<{ media_id: number; sha256: string }>;
      return this.querySuccess("listForOperation", effectId, Object.freeze(rows.map((row) => Object.freeze({
        mediaId: row.media_id,
        sha256: row.sha256,
      }))));
    } catch {
      return this.queryFailure("listForOperation", effectId, "storage_unavailable", "unknown", true);
    }
  }

  async deleteIfUnreferenced(
    request: DeleteMediaIfUnreferencedRequest,
  ): Promise<ResultValue<boolean, MediaStoreError>> {
    this.call("deleteIfUnreferenced", request.effect.idempotencyKey, request.effect.operationId, null);
    if (!hasValidRequestHash(request)) return this.failure("deleteIfUnreferenced", request, "idempotency_conflict");
    if (this.runtime.hitFault("before_effect")) {
      return this.failure("deleteIfUnreferenced", request, "storage_unavailable", "not_applied", true);
    }
    try {
      this.runtime.hitFault("before_delete_transaction");
      const outcome = this.database.transaction((): MediaDeleteOutcome => {
        const prior = this.database.prepare(
          "SELECT request_hash, deleted FROM service_effect_media_deletions WHERE idempotency_key = ?",
        ).get(request.effect.idempotencyKey) as { request_hash: string; deleted: number } | undefined;
        if (prior) return prior.request_hash === request.effect.requestHash
          ? { ok: true, deleted: prior.deleted === 1, duplicate: true }
          : { ok: false, tag: "idempotency_conflict" };

        const upload = this.database.prepare(
          "SELECT * FROM service_effect_media_uploads WHERE media_id = ?",
        ).get(request.mediaId) as UploadRow | undefined;
        if (!upload) return { ok: false, tag: "media_not_found" };
        if (upload.sha256 !== request.expectedSha256) return { ok: false, tag: "digest_mismatch" };
        const referenced = this.database.prepare(`
          SELECT 1 FROM service_effect_operation_media WHERE media_id = ?
          UNION ALL SELECT 1 FROM message_media WHERE media_id = ?
          UNION ALL SELECT 1 FROM service_effect_outbox_media_refs WHERE media_id = ?
          LIMIT 1
        `).get(request.mediaId, request.mediaId, request.mediaId);
        if (referenced) return { ok: false, tag: "still_referenced" };

        this.database.prepare("DELETE FROM service_effect_media_uploads WHERE media_id = ?").run(request.mediaId);
        const deleted = deleteUnreferencedMediaInDatabase(this.database, [request.mediaId]) === 1;
        this.database.prepare(`
          INSERT INTO service_effect_media_deletions
            (idempotency_key, request_hash, media_id, expected_sha256, deleted)
          VALUES (?, ?, ?, ?, ?)
        `).run(request.effect.idempotencyKey, request.effect.requestHash, request.mediaId, request.expectedSha256, deleted ? 1 : 0);
        return { ok: true, deleted, duplicate: false };
      }).immediate();

      if (!outcome.ok) return this.failure("deleteIfUnreferenced", request, outcome.tag);
      if (outcome.duplicate) return this.success("deleteIfUnreferenced", request, outcome.deleted, "duplicate");
      if (this.runtime.hitFault("effect_then_lost_acknowledgement")) {
        return this.failure("deleteIfUnreferenced", request, "storage_unavailable", "unknown", true);
      }
      return this.success("deleteIfUnreferenced", request, outcome.deleted);
    } catch {
      return this.failure("deleteIfUnreferenced", request, "storage_unavailable", "unknown", true);
    }
  }

  private findUploadByKey(idempotencyKey: string): UploadRow | undefined {
    return this.database.prepare("SELECT * FROM service_effect_media_upload_history WHERE idempotency_key = ?")
      .get(idempotencyKey) as UploadRow | undefined;
  }

  private findUploadById(uploadId: string): UploadRow | undefined {
    return this.database.prepare("SELECT * FROM service_effect_media_upload_history WHERE upload_id = ?")
      .get(uploadId) as UploadRow | undefined;
  }

  private reconcileCreate(request: CreateMediaRequest, row: UploadRow): ResultValue<MediaRef, MediaStoreError> {
    if (row.sha256 !== request.sha256 || row.byte_length !== request.byteLength) {
      return this.failure("create", request, "digest_mismatch");
    }
    return row.request_hash === request.effect.requestHash
      ? this.success("create", request, { mediaId: row.media_id, sha256: row.sha256 }, "duplicate")
      : this.failure("create", request, "idempotency_conflict");
  }

  private call(method: string, effectId: string, operationId: string | null, version: number | null): void {
    this.runtime.recordTrace({ contract: "EF-S04", method, effectId, operationId, version });
  }

  private success<T>(
    method: string,
    request: { effect: { idempotencyKey: string; operationId: string | null } },
    value: T,
    resultTag = "ok",
  ): ResultValue<T, never> {
    this.runtime.recordTrace({
      contract: "EF-S04", method, effectId: request.effect.idempotencyKey,
      operationId: request.effect.operationId, certainty: "applied", resultTag,
    });
    return Result.ok(value);
  }

  private failure(
    method: string,
    request: { effect: { idempotencyKey: string; operationId: string | null } },
    tag: MediaStoreErrorTag,
    certainty: MediaStoreError["certainty"] = "not_applied",
    retryable = false,
  ): ResultValue<never, MediaStoreError> {
    this.runtime.recordTrace({
      contract: "EF-S04", method, effectId: request.effect.idempotencyKey,
      operationId: request.effect.operationId, certainty, resultTag: tag,
    });
    return Result.err(Object.freeze({ _tag: tag, certainty, retryable }));
  }

  private querySuccess<T>(method: string, effectId: string, value: T, resultTag = "ok"): ResultValue<T, never> {
    this.runtime.recordTrace({ contract: "EF-S04", method, effectId, certainty: "applied", resultTag });
    return Result.ok(value);
  }

  private queryFailure(
    method: string,
    effectId: string,
    tag: MediaStoreErrorTag,
    certainty: MediaStoreError["certainty"] = "not_applied",
    retryable = false,
  ): ResultValue<never, MediaStoreError> {
    this.runtime.recordTrace({ contract: "EF-S04", method, effectId, certainty, resultTag: tag });
    return Result.err(Object.freeze({ _tag: tag, certainty, retryable }));
  }
}

type MediaCreateOutcome =
  | { readonly ok: true; readonly ref: MediaRef; readonly duplicate: boolean }
  | { readonly ok: false; readonly tag: MediaStoreErrorTag };

type MediaBindingOutcome =
  | { readonly ok: true; readonly binding: OperationMediaBinding; readonly duplicate: boolean }
  | { readonly ok: false; readonly tag: MediaStoreErrorTag };

type MediaDeleteOutcome =
  | { readonly ok: true; readonly deleted: boolean; readonly duplicate: boolean }
  | { readonly ok: false; readonly tag: MediaStoreErrorTag };

function hasValidRequestHash(request: { effect: { requestHash: string } }): boolean {
  return request.effect.requestHash === hashCanonicalRequest(request as unknown as CanonicalJsonValue);
}

function validCreateRequest(request: CreateMediaRequest): boolean {
  return Boolean(
    request.uploadId && request.filename && request.contentType && request.dataRef &&
    Number.isSafeInteger(request.byteLength) && request.byteLength >= 0 &&
    /^[a-f0-9]{64}$/.test(request.sha256),
  );
}

function bindingFromRow(row: BindingRow): OperationMediaBinding {
  return Object.freeze({
    operationId: row.operation_id,
    mediaId: row.media_id,
    role: row.role,
    boundAt: row.bound_at,
  });
}

function storedRecord(upload: UploadRow, filename: string, contentType: string): StoredMediaRecord {
  return Object.freeze({
    ref: Object.freeze({ mediaId: upload.media_id, sha256: upload.sha256 }),
    filename,
    contentType,
    byteLength: upload.byte_length,
    dataRef: upload.data_ref,
    thumbnailRef: upload.thumbnail_ref,
    metadataRef: upload.metadata_ref,
    createdAt: upload.created_at,
  });
}
