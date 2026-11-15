/** Polling cursor and queued payload/provenance only. Native SDK tasks own execution.
 * Retired marker history belongs to the owned chat-cursor-storage migration. */
import { getDb } from './connection.js';
import { projectPersistedQueuedFollowupItem, type QueuedFollowupSourceMetadata } from '../queued-followups.js';


/** Deferred queued follow-up items persisted outside the timeline. */
export interface DeferredQueuedFollowupRecord {
  /** Host-owned durable identity, preserved verbatim across queue persistence. */
  readonly source_id?: string;
  readonly source_accepted?: true;
  rowId: number;
  queuedContent: string;
  threadId: number | null;
  queuedAt: string;
  mediaIds?: number[];
  contentBlocks?: unknown[];
  linkPreviews?: unknown[];
  screenHint?: string;
  source?: string;
  queuedBy?: QueuedFollowupSourceMetadata;
  /** Number of times materializeNextDeferredFollowup has failed for this item. */
  materializeRetries?: number;
}


// ---------------------------------------------------------------------------
// Cursor reads
// ---------------------------------------------------------------------------

/** Get the cursor timestamp for a chat. Returns '' if never processed. */
export function getChatCursor(chatJid: string): string {
  const db = getDb();
  const row = db
    .prepare("SELECT cursor_ts FROM chat_cursors WHERE chat_jid = ?")
    .get(chatJid) as { cursor_ts: string } | undefined;
  return row?.cursor_ts ?? "";
}


/** Get all chat cursors as { chatJid → cursor_ts }. */
export function getAllChatCursors(): Record<string, string> {
  const db = getDb();
  const rows = db
    .prepare("SELECT chat_jid, cursor_ts FROM chat_cursors")
    .all() as Array<{ chat_jid: string; cursor_ts: string }>;
  const result: Record<string, string> = {};
  for (const row of rows) result[row.chat_jid] = row.cursor_ts;
  return result;
}


function sanitizeDeferredQueuedFollowupRecord(value: unknown): DeferredQueuedFollowupRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (!Number.isFinite(record.rowId) || typeof record.queuedContent !== "string") return null;
  return projectPersistedQueuedFollowupItem(record as any) as DeferredQueuedFollowupRecord;
}


/** Read deferred queued follow-ups for a chat from chat_cursors. */
export function getDeferredQueuedFollowups(chatJid: string): DeferredQueuedFollowupRecord[] {
  const db = getDb();
  const row = db
    .prepare("SELECT queued_followups_json FROM chat_cursors WHERE chat_jid = ?")
    .get(chatJid) as { queued_followups_json: string | null } | undefined;
  if (!row?.queued_followups_json) return [];
  try {
    const parsed = JSON.parse(row.queued_followups_json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => sanitizeDeferredQueuedFollowupRecord(item))
      .filter((item): item is DeferredQueuedFollowupRecord => Boolean(item));
  } catch {
    return [];
  }
}


/** Persist the full deferred queued follow-up list for a chat. */
export function setDeferredQueuedFollowups(chatJid: string, items: DeferredQueuedFollowupRecord[]): void {
  const db = getDb();
  const payload = JSON.stringify(items.map((item) => projectPersistedQueuedFollowupItem(item)));
  db.prepare(`
    INSERT INTO chat_cursors (chat_jid, cursor_ts, queued_followups_json)
    VALUES (?, '', ?)
    ON CONFLICT(chat_jid) DO UPDATE SET
      queued_followups_json = excluded.queued_followups_json
  `).run(chatJid, payload);
}


// ---------------------------------------------------------------------------
// Cursor writes
// ---------------------------------------------------------------------------

/**
 * Set the cursor without touching inflight or failed state.
 * Used by skipFailedOnModelSwitch() to advance past a permanently-failed
 * message when the user changes model.
 */
export function setChatCursor(chatJid: string, ts: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO chat_cursors (chat_jid, cursor_ts) VALUES (?, ?)
    ON CONFLICT(chat_jid) DO UPDATE SET cursor_ts = excluded.cursor_ts
  `).run(chatJid, ts);
}


/** Remove one source-tagged protected-recovery continuation. */
export function removeProtectedRecoveryContinuationForSourceMessageId(
  chatJid: string,
  sourceMessageId: string,
): boolean {
  const normalizedSourceMessageId = sourceMessageId.trim();
  if (!normalizedSourceMessageId) return false;
  const queued = getDeferredQueuedFollowups(chatJid);
  const filtered = queued.filter((item) => !(
    item.source === "auto-protected-recovery-continuation"
    && item.queuedBy?.sourceMessageId === normalizedSourceMessageId
  ));
  if (filtered.length === queued.length) return false;
  setDeferredQueuedFollowups(chatJid, filtered);
  return true;
}