import type { Result } from "@earendil-works/pi-agent-core";

import type { EffectIdentity, PiclawEffectError } from "./common.js";
import type { EnqueueOutboxRequest } from "./service-outbox-store.js";
import type {
  HarnessCorrelation,
  PiclawDisposition,
} from "./service-work-store.js";

interface TerminalTimelineBase {
  readonly chatJid: string;
  readonly contentBlocksRef: string | null;
  readonly mediaIds: readonly number[];
}

export interface InsertTerminalTimelineWrite extends TerminalTimelineBase {
  readonly mode: "insert";
  readonly placeholderRowId: null;
  readonly contentRef: string;
  readonly threadId: number | null;
}

export interface ReplaceTerminalPlaceholderWrite extends TerminalTimelineBase {
  readonly mode: "replace_placeholder";
  readonly placeholderRowId: number;
  readonly contentRef: string;
  readonly threadId: number | null;
}

export interface NoTerminalTimelineWrite {
  readonly mode: "none";
  readonly placeholderRowId: null;
  readonly chatJid: string;
  readonly contentRef: null;
  readonly threadId: null;
  readonly mediaIds: readonly [];
  readonly contentBlocksRef: null;
}

export type TerminalTimelineWrite =
  | InsertTerminalTimelineWrite
  | ReplaceTerminalPlaceholderWrite
  | NoTerminalTimelineWrite;

export interface SourceDisposition {
  readonly sourceSeq: number;
  readonly state: "consumed" | "disposed";
  readonly reason: string;
}

export interface CommitTerminalRequest {
  /**
   * Content and content-block payloads must resolve with this exact redaction
   * class. EF-S02 performs no implicit redaction upgrade or downgrade.
   */
  readonly effect: EffectIdentity & { readonly operationId: string };
  readonly expectedChatJid: string;
  readonly expectedVersion: number;
  readonly expectedHarness: HarnessCorrelation | null;
  readonly disposition: PiclawDisposition;
  readonly errorCode: string | null;
  readonly terminalAuthorityRef: string | null;
  readonly timeline: TerminalTimelineWrite;
  readonly sourceDispositions: readonly SourceDisposition[];
  readonly outboxIntents: readonly EnqueueOutboxRequest[];
  readonly committedAt: string;
}

export interface TerminalCommit {
  readonly operationId: string;
  readonly operationVersion: number;
  readonly disposition: PiclawDisposition;
  readonly messageRowId: number | null;
  readonly consumedThroughSourceSeq: number;
  readonly outboxIds: readonly string[];
  readonly committedAt: string;
}

export type TerminalSettlementErrorTag =
  | "invalid_request"
  | "not_found"
  | "idempotency_conflict"
  | "version_mismatch"
  | "owner_conflict"
  | "already_terminal_conflict"
  | "invalid_source_disposition"
  | "missing_media"
  | "corrupt_state"
  | "storage_unavailable";

export interface TerminalSettlementError
  extends PiclawEffectError<TerminalSettlementErrorTag> {
  readonly _tag: TerminalSettlementErrorTag;
  readonly existing?: TerminalCommit;
}

export interface TerminalSettlementStore {
  commitTerminal(
    request: CommitTerminalRequest,
  ): Promise<Result<TerminalCommit, TerminalSettlementError>>;
  getTerminal(
    operationId: string,
  ): Promise<Result<TerminalCommit | null, TerminalSettlementError>>;
  getTerminalByKey(
    idempotencyKey: string,
  ): Promise<Result<TerminalCommit | null, TerminalSettlementError>>;
}
