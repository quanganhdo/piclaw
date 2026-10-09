import type { Result } from "./result.js";

import type { EffectIdentity, PiclawEffectError } from "./common.js";

export interface CreateMediaRequest {
  readonly effect: EffectIdentity;
  readonly uploadId: string;
  readonly filename: string;
  readonly contentType: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly dataRef: string;
  readonly thumbnailRef: string | null;
  readonly metadataRef: string | null;
  readonly createdAt: string;
}

export interface MediaRef {
  readonly mediaId: number;
  readonly sha256: string;
}

export type OperationMediaRole = "input" | "draft" | "terminal" | "tool_artifact";

export interface BindOperationMediaRequest {
  readonly effect: EffectIdentity & { readonly operationId: string };
  readonly mediaId: number;
  readonly role: OperationMediaRole;
  readonly boundAt: string;
}

export interface OperationMediaBinding {
  readonly operationId: string;
  readonly mediaId: number;
  readonly role: OperationMediaRole;
  readonly boundAt: string;
}

export interface DeleteMediaIfUnreferencedRequest {
  readonly effect: EffectIdentity;
  readonly mediaId: number;
  readonly expectedSha256: string;
}

export interface StoredMediaRecord {
  readonly ref: MediaRef;
  readonly filename: string;
  readonly contentType: string;
  readonly byteLength: number;
  readonly dataRef: string;
  readonly thumbnailRef: string | null;
  readonly metadataRef: string | null;
  readonly createdAt: string;
}

export type MediaStoreErrorTag =
  | "idempotency_conflict"
  | "digest_mismatch"
  | "unsupported_media"
  | "media_not_found"
  | "binding_conflict"
  | "still_referenced"
  | "storage_unavailable";

export interface MediaStoreError extends PiclawEffectError<MediaStoreErrorTag> {
  readonly _tag: MediaStoreErrorTag;
}

export interface OperationMediaStore {
  create(request: CreateMediaRequest): Promise<Result<MediaRef, MediaStoreError>>;
  bindToOperation(request: BindOperationMediaRequest): Promise<Result<OperationMediaBinding, MediaStoreError>>;
  get(ref: MediaRef): Promise<Result<StoredMediaRecord | null, MediaStoreError>>;
  listForOperation(operationId: string): Promise<Result<readonly MediaRef[], MediaStoreError>>;
  deleteIfUnreferenced(request: DeleteMediaIfUnreferencedRequest): Promise<Result<boolean, MediaStoreError>>;
}
