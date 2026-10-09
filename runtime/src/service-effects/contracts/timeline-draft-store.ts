import type { Result } from "./result.js";

import type { EffectIdentity, PiclawEffectError } from "./common.js";

export type TimelineDraftKind = "assistant_progress" | "tool_progress" | "recovery";
export type ServiceNoticeKind = "restart" | "maintenance" | "operator";

export interface CommitDraftRequest {
  readonly effect: EffectIdentity & { readonly operationId: string };
  readonly chatJid: string;
  readonly draftKind: TimelineDraftKind;
  readonly revision: number;
  readonly mode: "insert" | "replace";
  readonly existingRowId: number | null;
  readonly contentRef: string;
  readonly threadId: number | null;
  readonly mediaIds: readonly number[];
  readonly contentBlocksRef: string | null;
  readonly writtenAt: string;
}

export interface CommitServiceNoticeRequest {
  readonly effect: EffectIdentity;
  readonly chatJid: string;
  readonly sourceId: string;
  readonly noticeKind: ServiceNoticeKind;
  readonly contentRef: string;
  readonly contentBlocksRef: string | null;
  readonly writtenAt: string;
}

export interface TimelineWrite {
  readonly rowId: number;
  readonly chatJid: string;
  readonly operationId: string | null;
  readonly revision: number | null;
  readonly terminal: false;
  readonly writtenAt: string;
}

export interface OperationArtifacts {
  readonly operationId: string;
  readonly draftRows: readonly TimelineWrite[];
  readonly mediaIds: readonly number[];
}

export type TimelineStoreErrorTag =
  | "idempotency_conflict"
  | "stale_revision"
  | "row_not_found"
  | "row_owner_conflict"
  | "invalid_content_blocks"
  | "missing_media"
  | "storage_unavailable";

export interface TimelineStoreError extends PiclawEffectError<TimelineStoreErrorTag> {
  readonly _tag: TimelineStoreErrorTag;
}

export interface TimelineDraftStore {
  commitDraft(request: CommitDraftRequest): Promise<Result<TimelineWrite, TimelineStoreError>>;
  commitServiceNotice(request: CommitServiceNoticeRequest): Promise<Result<TimelineWrite, TimelineStoreError>>;
  getOperationArtifacts(operationId: string): Promise<Result<OperationArtifacts, TimelineStoreError>>;
}
