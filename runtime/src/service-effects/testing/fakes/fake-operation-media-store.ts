import { Result, type Result as ResultValue } from "../../contracts/result.js";

import { hashCanonicalRequest, type CanonicalJsonValue } from "../../contracts/common.js";

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
} from "../../contracts/operation-media-store.js";
import type { EffectPayloadResolver } from "../../contracts/payload-resolver.js";
import type { ContractTestContext } from "../contract-suite.js";
import {
  fakeResolveVerifiedJson,
  fakeResolveVerifiedPayload,
  fakeSha256,
} from "./fake-payload-validation.js";
import { EffectTraceRecorder } from "../trace-recorder.js";

interface FakeMediaRecord extends StoredMediaRecord {
  readonly uploadId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly bytes: Uint8Array;
}

interface FakeMediaCreationRecord {
  readonly ref: MediaRef;
  readonly uploadId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly byteLength: number;
  readonly dataRef: string;
  readonly thumbnailRef: string | null;
  readonly metadataRef: string | null;
  readonly createdAt: string;
}

interface FakeBindingRecord extends OperationMediaBinding {
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export interface FakeOperationMediaSnapshot {
  readonly nextMediaId: number;
  readonly media: readonly FakeMediaRecord[];
  readonly creationHistory: readonly FakeMediaCreationRecord[];
  readonly bindings: readonly FakeBindingRecord[];
  readonly deletions: readonly Readonly<{ key: string; requestHash: string; value: boolean }>[];
  readonly messageReferences: readonly number[];
  readonly outboxReferences: readonly number[];
  readonly trace: ReturnType<EffectTraceRecorder["snapshot"]>;
}

export class FakeOperationMediaStore implements OperationMediaStore {
  trace = new EffectTraceRecorder();
  #nextMediaId = 1;
  #media: FakeMediaRecord[] = [];
  #creationHistory: FakeMediaCreationRecord[] = [];
  #bindings: FakeBindingRecord[] = [];
  #deletions: Array<{ key: string; requestHash: string; value: boolean }> = [];
  #messageReferences = new Set<number>();
  #outboxReferences = new Set<number>();
  #beforeDeleteDecision: (() => void) | null = null;

  constructor(
    private readonly payloads: EffectPayloadResolver,
    private readonly context: ContractTestContext,
  ) {}

  async create(request: CreateMediaRequest): Promise<ResultValue<MediaRef, MediaStoreError>> {
    this.call("create", request.effect.idempotencyKey, request.effect.operationId);
    if (!hasValidRequestHash(request)) return this.fail("create", request, "idempotency_conflict");
    if (this.context.faults.hit("before_effect")) return this.fail("create", request, "storage_unavailable", "not_applied", true);
    const byKey = this.#creationHistory.find((entry) => entry.idempotencyKey === request.effect.idempotencyKey);
    if (byKey) return byKey.requestHash === request.effect.requestHash
      ? this.ok("create", request, byKey.ref, "duplicate")
      : this.fail("create", request, "idempotency_conflict");
    const byUpload = this.#creationHistory.find((entry) => entry.uploadId === request.uploadId);
    if (byUpload) {
      if (byUpload.ref.sha256 !== request.sha256 || byUpload.byteLength !== request.byteLength) {
        return this.fail("create", request, "digest_mismatch");
      }
      return byUpload.requestHash === request.effect.requestHash
        ? this.ok("create", request, byUpload.ref, "duplicate")
        : this.fail("create", request, "idempotency_conflict");
    }
    if (!request.uploadId || !request.filename || !request.contentType || !request.dataRef) {
      return this.fail("create", request, "unsupported_media");
    }
    const payload = await fakeResolveVerifiedPayload(this.payloads, request.dataRef);
    if (!payload || payload.sha256 !== request.sha256 || payload.byteLength !== request.byteLength) {
      return this.fail("create", request, "digest_mismatch");
    }
    if (payload.mediaType !== request.contentType) return this.fail("create", request, "unsupported_media");
    if (request.thumbnailRef && !await fakeResolveVerifiedPayload(this.payloads, request.thumbnailRef)) {
      return this.fail("create", request, "unsupported_media");
    }
    const metadata = request.metadataRef ? await fakeResolveVerifiedJson(this.payloads, request.metadataRef) : null;
    if (request.metadataRef && (!metadata || typeof metadata !== "object" || Array.isArray(metadata))) {
      return this.fail("create", request, "unsupported_media");
    }
    const byKeyAfterResolve = this.#creationHistory.find((entry) => entry.idempotencyKey === request.effect.idempotencyKey);
    if (byKeyAfterResolve) return byKeyAfterResolve.requestHash === request.effect.requestHash
      ? this.ok("create", request, byKeyAfterResolve.ref, "duplicate")
      : this.fail("create", request, "idempotency_conflict");
    const byUploadAfterResolve = this.#creationHistory.find((entry) => entry.uploadId === request.uploadId);
    if (byUploadAfterResolve) {
      if (byUploadAfterResolve.ref.sha256 !== request.sha256 || byUploadAfterResolve.byteLength !== request.byteLength) {
        return this.fail("create", request, "digest_mismatch");
      }
      return byUploadAfterResolve.requestHash === request.effect.requestHash
        ? this.ok("create", request, byUploadAfterResolve.ref, "duplicate")
        : this.fail("create", request, "idempotency_conflict");
    }
    const ref = Object.freeze({ mediaId: this.#nextMediaId++, sha256: request.sha256 });
    const record = Object.freeze({
      ref,
      uploadId: request.uploadId,
      idempotencyKey: request.effect.idempotencyKey,
      requestHash: request.effect.requestHash,
      filename: request.filename,
      contentType: request.contentType,
      byteLength: request.byteLength,
      dataRef: request.dataRef,
      thumbnailRef: request.thumbnailRef,
      metadataRef: request.metadataRef,
      createdAt: request.createdAt,
      bytes: new Uint8Array(payload.bytes),
    });
    this.#media.push(record);
    this.#creationHistory.push(Object.freeze({
      ref, uploadId: request.uploadId, idempotencyKey: request.effect.idempotencyKey,
      requestHash: request.effect.requestHash, byteLength: request.byteLength,
      dataRef: request.dataRef, thumbnailRef: request.thumbnailRef,
      metadataRef: request.metadataRef, createdAt: request.createdAt,
    }));
    if (this.context.faults.hit("effect_then_lost_acknowledgement")) {
      return this.fail("create", request, "storage_unavailable", "unknown", true);
    }
    return this.ok("create", request, ref);
  }

  async bindToOperation(request: BindOperationMediaRequest): Promise<ResultValue<OperationMediaBinding, MediaStoreError>> {
    this.call("bindToOperation", request.effect.idempotencyKey, request.effect.operationId);
    if (!hasValidRequestHash(request)) return this.fail("bindToOperation", request, "idempotency_conflict");
    if (this.context.faults.hit("before_effect")) return this.fail("bindToOperation", request, "storage_unavailable", "not_applied", true);
    const byKey = this.#bindings.find((entry) => entry.idempotencyKey === request.effect.idempotencyKey);
    if (byKey) return byKey.requestHash === request.effect.requestHash
      ? this.ok("bindToOperation", request, bindingValue(byKey), "duplicate")
      : this.fail("bindToOperation", request, "idempotency_conflict");
    if (!this.#media.some((entry) => entry.ref.mediaId === request.mediaId)) {
      return this.fail("bindToOperation", request, "media_not_found");
    }
    const existing = this.#bindings.find((entry) =>
      entry.operationId === request.effect.operationId && entry.mediaId === request.mediaId && entry.role === request.role);
    if (existing) return existing.requestHash === request.effect.requestHash
      ? this.ok("bindToOperation", request, bindingValue(existing), "duplicate")
      : this.fail("bindToOperation", request, "binding_conflict");
    const binding = Object.freeze({
      operationId: request.effect.operationId,
      mediaId: request.mediaId,
      role: request.role,
      boundAt: request.boundAt,
      idempotencyKey: request.effect.idempotencyKey,
      requestHash: request.effect.requestHash,
    });
    this.#bindings.push(binding);
    if (this.context.faults.hit("effect_then_lost_acknowledgement")) {
      return this.fail("bindToOperation", request, "storage_unavailable", "unknown", true);
    }
    return this.ok("bindToOperation", request, bindingValue(binding));
  }

  async get(ref: MediaRef): Promise<ResultValue<StoredMediaRecord | null, MediaStoreError>> {
    const effectId = this.context.ids.nextId();
    this.call("get", effectId, null);
    const record = this.#media.find((entry) => entry.ref.mediaId === ref.mediaId);
    if (!record) return this.queryOk("get", effectId, null, "absent");
    if (record.ref.sha256 !== ref.sha256 || fakeSha256(record.bytes) !== record.ref.sha256) {
      return this.queryFail("get", effectId, "digest_mismatch");
    }
    return this.queryOk("get", effectId, storedValue(record));
  }

  async listForOperation(operationId: string): Promise<ResultValue<readonly MediaRef[], MediaStoreError>> {
    const effectId = this.context.ids.nextId();
    this.call("listForOperation", effectId, operationId);
    const ids = new Set(this.#bindings.filter((entry) => entry.operationId === operationId).map((entry) => entry.mediaId));
    const refs = Object.freeze(this.#media.filter((entry) => ids.has(entry.ref.mediaId)).map((entry) => entry.ref));
    return this.queryOk("listForOperation", effectId, refs);
  }

  async deleteIfUnreferenced(request: DeleteMediaIfUnreferencedRequest): Promise<ResultValue<boolean, MediaStoreError>> {
    this.call("deleteIfUnreferenced", request.effect.idempotencyKey, request.effect.operationId);
    if (!hasValidRequestHash(request)) return this.fail("deleteIfUnreferenced", request, "idempotency_conflict");
    if (this.context.faults.hit("before_effect")) return this.fail("deleteIfUnreferenced", request, "storage_unavailable", "not_applied", true);
    if (this.#beforeDeleteDecision) {
      const run = this.#beforeDeleteDecision;
      this.#beforeDeleteDecision = null;
      run();
    }
    const prior = this.#deletions.find((entry) => entry.key === request.effect.idempotencyKey);
    if (prior) return prior.requestHash === request.effect.requestHash
      ? this.ok("deleteIfUnreferenced", request, prior.value, "duplicate")
      : this.fail("deleteIfUnreferenced", request, "idempotency_conflict");
    const index = this.#media.findIndex((entry) => entry.ref.mediaId === request.mediaId);
    if (index < 0) return this.fail("deleteIfUnreferenced", request, "media_not_found");
    if (this.#media[index].ref.sha256 !== request.expectedSha256) return this.fail("deleteIfUnreferenced", request, "digest_mismatch");
    if (
      this.#bindings.some((entry) => entry.mediaId === request.mediaId) ||
      this.#messageReferences.has(request.mediaId) || this.#outboxReferences.has(request.mediaId)
    ) return this.fail("deleteIfUnreferenced", request, "still_referenced");
    this.#media.splice(index, 1);
    this.#deletions.push({ key: request.effect.idempotencyKey, requestHash: request.effect.requestHash, value: true });
    if (this.context.faults.hit("effect_then_lost_acknowledgement")) {
      return this.fail("deleteIfUnreferenced", request, "storage_unavailable", "unknown", true);
    }
    return this.ok("deleteIfUnreferenced", request, true);
  }

  beforeDeleteDecisionOnce(run: () => void): void { this.#beforeDeleteDecision = run; }
  addMessageReference(mediaId: number): void { this.#messageReferences.add(mediaId); }
  removeMessageReference(mediaId: number): void { this.#messageReferences.delete(mediaId); }
  addOutboxReference(mediaId: number): void { this.#outboxReferences.add(mediaId); }
  removeOutboxReference(mediaId: number): void { this.#outboxReferences.delete(mediaId); }

  snapshot(): FakeOperationMediaSnapshot {
    return structuredClone({
      nextMediaId: this.#nextMediaId,
      media: this.#media,
      creationHistory: this.#creationHistory,
      bindings: this.#bindings,
      deletions: this.#deletions,
      messageReferences: [...this.#messageReferences],
      outboxReferences: [...this.#outboxReferences],
      trace: this.trace.snapshot(),
    });
  }

  restore(snapshot: FakeOperationMediaSnapshot): void {
    const state = structuredClone(snapshot);
    this.#nextMediaId = state.nextMediaId;
    this.#media = [...state.media];
    this.#creationHistory = [...state.creationHistory];
    this.#bindings = [...state.bindings];
    this.#deletions = [...state.deletions];
    this.#messageReferences = new Set(state.messageReferences);
    this.#outboxReferences = new Set(state.outboxReferences);
    this.trace = EffectTraceRecorder.fromSnapshot(state.trace);
  }

  private call(method: string, effectId: string, operationId: string | null): void {
    this.trace.recordCall({ contract: "EF-S04", method, effectId, operationId });
  }
  private ok<T>(method: string, request: EffectRequest, value: T, resultTag = "ok"): ResultValue<T, never> {
    this.trace.recordResult({ contract: "EF-S04", method, effectId: request.effect.idempotencyKey, operationId: request.effect.operationId, certainty: "applied", resultTag });
    return Result.ok(value);
  }
  private fail(method: string, request: EffectRequest, tag: MediaStoreErrorTag, certainty: MediaStoreError["certainty"] = "not_applied", retryable = false): ResultValue<never, MediaStoreError> {
    this.trace.recordResult({ contract: "EF-S04", method, effectId: request.effect.idempotencyKey, operationId: request.effect.operationId, certainty, resultTag: tag });
    return Result.err(Object.freeze({ _tag: tag, certainty, retryable }));
  }
  private queryOk<T>(method: string, effectId: string, value: T, resultTag = "ok"): ResultValue<T, never> {
    this.trace.recordResult({ contract: "EF-S04", method, effectId, certainty: "applied", resultTag });
    return Result.ok(value);
  }
  private queryFail(method: string, effectId: string, tag: MediaStoreErrorTag): ResultValue<never, MediaStoreError> {
    this.trace.recordResult({ contract: "EF-S04", method, effectId, certainty: "not_applied", resultTag: tag });
    return Result.err(Object.freeze({ _tag: tag, certainty: "not_applied", retryable: false }));
  }
}

type EffectRequest = { effect: { idempotencyKey: string; operationId: string | null } };

function hasValidRequestHash(request: { effect: { requestHash: string } }): boolean {
  return request.effect.requestHash === hashCanonicalRequest(request as unknown as CanonicalJsonValue);
}

function bindingValue(record: FakeBindingRecord): OperationMediaBinding {
  return Object.freeze({ operationId: record.operationId, mediaId: record.mediaId, role: record.role, boundAt: record.boundAt });
}
function storedValue(record: FakeMediaRecord): StoredMediaRecord {
  return Object.freeze({
    ref: record.ref,
    filename: record.filename,
    contentType: record.contentType,
    byteLength: record.byteLength,
    dataRef: record.dataRef,
    thumbnailRef: record.thumbnailRef,
    metadataRef: record.metadataRef,
    createdAt: record.createdAt,
  });
}
