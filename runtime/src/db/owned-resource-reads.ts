import type Database from "bun:sqlite";
import type { AuthenticatedPrincipal } from "../core/access-types.js";
import { requireAccountActor } from "./account-administration.js";
import { ChatAccessDenied, resolveAuthorisedChat } from "./session-ownership.js";
import { resolveOwnedLifecycleSession } from "./owned-session-lifecycle.js";

/** A numeric media ID is not authority. Require a stored link to an active owned conversation. */
export function authoriseOwnedMedia(database: Database, actor: AuthenticatedPrincipal, mediaId: number): void {
  requireAccountActor(database, actor);
  if (!Number.isSafeInteger(mediaId) || mediaId <= 0) throw new ChatAccessDenied();
  if (database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='migration_media_quarantine'").get()
    && database.query('SELECT 1 FROM migration_media_quarantine WHERE media_id=?').get(mediaId)) throw new ChatAccessDenied();
  const candidates = database.query(`SELECT DISTINCT m.chat_jid FROM message_media mm
    JOIN messages m ON m.rowid=mm.message_rowid
    JOIN chat_branches b ON b.chat_jid=m.chat_jid
    JOIN chat_branches r ON r.chat_jid=b.root_chat_jid
    JOIN session_roots o ON o.root_branch_id=r.branch_id
    JOIN media a ON a.id=mm.media_id
    WHERE mm.media_id=? AND o.owner_user_id=?`).all(mediaId, actor.userId) as { chat_jid: string }[];
  for (const candidate of candidates) {
    try {
      resolveAuthorisedChat(database, actor, candidate.chat_jid, "session.read");
      return;
    } catch (error) { if (!(error instanceof ChatAccessDenied)) throw error; }
  }
  throw new ChatAccessDenied();
}

/** No arbitrary media metadata: it may contain workspace paths or another producer's private fields. */
export function readOwnedMediaInfo(database: Database, actor: AuthenticatedPrincipal, mediaId: number): unknown {
  authoriseOwnedMedia(database, actor, mediaId);
  return database.query("SELECT id,filename,content_type,created_at FROM media WHERE id=?").get(mediaId);
}

/** Text-only, paginated archive export. Never serialize service configs, tasks, KV or raw message blobs. */
export function exportOwnedArchivedTranscript(database: Database, actor: AuthenticatedPrincipal, chatJid: string, limit = 200, before?: number) {
  const branch = resolveOwnedLifecycleSession(database, actor, chatJid);
  if (!branch.archived_at) throw new ChatAccessDenied();
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500 || (before !== undefined && (!Number.isSafeInteger(before) || before <= 0))) {
    throw new Error("Invalid transcript page selection.");
  }
  // Bound each text field in SQL, not after loading unbounded raw message content.
  const messages = database.query(`SELECT rowid AS id, timestamp, substr(sender_name,1,128) AS sender_name,
      is_bot_message, substr(content,1,32000) AS content, length(content)>32000 AS content_truncated
    FROM messages WHERE chat_jid=? AND (? IS NULL OR rowid<?) ORDER BY rowid DESC LIMIT ?`)
    .all(chatJid, before ?? null, before ?? null, limit + 1) as Array<{ id: number; timestamp: string; sender_name: string | null; is_bot_message: number; content: string; content_truncated: number }>;
  const hasMore = messages.length > limit;
  const selected = messages.slice(0, limit);
  const nextBefore = hasMore ? selected.at(-1)!.id : null;
  return {
    schema: "piclaw.owned-transcript.v1",
    branch: { branch_id: branch.branch_id, chat_jid: branch.chat_jid, root_chat_jid: branch.root_chat_jid, agent_name: branch.agent_name, archived_at: branch.archived_at },
    messages: selected.reverse(),
    page: { limit, has_more: hasMore, next_before: nextBefore },
    omitted: ["media", "content_blocks", "link_previews", "annotations", "thread_links", "tasks", "service_configs", "extension_state", "session_files"],
  };
}
