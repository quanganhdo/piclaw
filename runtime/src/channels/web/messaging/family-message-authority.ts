import { createHash } from "node:crypto";
import type { AuthenticatedPrincipal } from "../../../core/access-types.js";
import type { ExecutionProvenance } from "../../../core/execution-context.js";
import { getDb } from "../../../db/connection.js";
import { requireAccountActor } from "../../../db/account-administration.js";
import { ChatAccessDenied, resolveAuthorisedChat } from "../../../db/session-ownership.js";
import { getMessageByRowId, storeMessageInDatabase } from "../../../db/messages.js";
import { attachMediaToMessageInDatabase, getMediaInfoByIdFromDatabase } from "../../../db/media.js";
import { consumeFamilyMediaUploads, readFamilyMessageMediaIds } from "../../../db/family-media-uploads.js";
import { createUuid } from "../../../utils/ids.js";
import { authoriseExecutionIdentity } from "../../../agent-pool/execution-identity.js";
import { getIdentityConfig, getRoutingConfig } from "../../../core/config.js";
import { parseControlCommand } from "../../../agent-control/index.js";
import { insertFamilyTurnQueue, readFamilyTurnQueueByMessageId, type FamilyTurnAdmissionMode } from "../../../db/family-turn-queue.js";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const payloadHash = (content:string,mediaIds:number[],contentBlocks:unknown[]|undefined) => mediaIds.length || contentBlocks?.length
  ? hash(JSON.stringify({content,media_ids:[...mediaIds].sort((a,b)=>a-b),content_blocks:contentBlocks??[]})) : hash(content);
const validSubmissionBlock = (value: unknown): boolean => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const block = value as Record<string, unknown>;
  if (Object.keys(block).some(key => !["type","card_id","source_post_id","submitted_at","action_type","title","data"].includes(key))) return false;
  if (block.type !== "adaptive_card_submission" || block.action_type !== "Action.Submit"
    || typeof block.card_id !== "string" || !block.card_id.trim() || block.card_id.length > 128
    || !Number.isSafeInteger(block.source_post_id) || Number(block.source_post_id) <= 0
    || typeof block.submitted_at !== "string" || !Number.isFinite(Date.parse(block.submitted_at))
    || (block.title !== undefined && (typeof block.title !== "string" || block.title.length > 256))) return false;
  try { return new TextEncoder().encode(JSON.stringify(block.data ?? null)).byteLength <= 128*1024; } catch { return false; }
};
interface Authority { message_rowid: number; message_id: string; chat_jid: string; owner_user_id: string; actor_user_id: string; login_session_id: string; content_hash: string; thread_id: number | null }

function validateText(content: string, hasMedia = false): void {
  if ((!content.trim() && !hasMedia) || content.length > 100 * 1024 || /^[\s]*[/@]/.test(content)
    || content.startsWith(`${getIdentityConfig().assistantName}:`)
    || parseControlCommand(content, getRoutingConfig().triggerPattern)) throw new Error("Only plain text prompts are supported by this family endpoint.");
}

/** Read live immutable admission plus exact persisted payload before any message/model processing. */
export function readFamilyMessageAdmission(chatJid: string, messageId: string) {
  const db = getDb();
  if(db.query('SELECT 1 FROM migration_input_holds WHERE chat_jid=? AND message_id=?').get(chatJid,messageId))throw new ChatAccessDenied();
  const row = db.query(`SELECT a.*,m.content,m.thread_id AS current_thread_id,m.is_bot_message,m.is_steering_message,m.content_blocks,m.link_previews
    FROM message_execution_authorities a JOIN messages m ON m.rowid=a.message_rowid AND m.id=a.message_id AND m.chat_jid=a.chat_jid
    WHERE a.chat_jid=? AND a.message_id=?`).get(chatJid, messageId) as (Authority & { content: string; current_thread_id: number | null; is_bot_message: number; is_steering_message: number; content_blocks: string | null; link_previews: string | null }) | null;
  if (!row || row.owner_user_id !== row.actor_user_id || row.current_thread_id !== row.thread_id
    || row.is_bot_message || row.is_steering_message || row.link_previews) throw new ChatAccessDenied();
  const mediaIds = readFamilyMessageMediaIds(db, row.message_rowid);
  let blocks: unknown = null;
  if (row.content_blocks !== null) { try { blocks = JSON.parse(row.content_blocks); } catch { throw new ChatAccessDenied(); } }
  if (mediaIds.length > 0 && (!Array.isArray(blocks) || blocks.length !== mediaIds.length)) throw new ChatAccessDenied();
  if (Array.isArray(blocks) && blocks.some(block => !block || typeof block !== "object" || !["image","file","adaptive_card_submission"].includes((block as any).type)
    || (["image","file"].includes((block as any).type) && !mediaIds.includes((block as any).media_id))
    || ((block as any).type === "adaptive_card_submission" && !validSubmissionBlock(block)))) throw new ChatAccessDenied();
  const mediaBlockIds=Array.isArray(blocks)?blocks.filter(block=>["image","file"].includes((block as any)?.type)).map(block=>(block as any).media_id):[];
  if(new Set(mediaBlockIds).size!==mediaIds.length||mediaBlockIds.some(id=>!mediaIds.includes(id))||row.content_hash!==payloadHash(row.content,mediaIds,Array.isArray(blocks)?blocks:undefined))throw new ChatAccessDenied();
  validateText(row.content, mediaIds.length > 0);
  if (row.thread_id !== null && !getMessageByRowId(chatJid, row.thread_id)) throw new ChatAccessDenied();
  return row;
}

/** The latest explicit retry grant supersedes its original login; skipped messages cannot execute. */
export function resolveFamilyMessageAuthority(chatJid: string, messageId: string) {
  const db = getDb();
  const row = readFamilyMessageAdmission(chatJid, messageId);
  const queue = readFamilyTurnQueueByMessageId(chatJid, messageId);
  if (!queue || queue.owner_user_id !== row.owner_user_id || queue.state !== "ready") throw new ChatAccessDenied();
  const recovery = db.query("SELECT owner_user_id,login_session_id,action FROM message_recovery_authorities WHERE message_rowid=? ORDER BY id DESC LIMIT 1")
    .get(row.message_rowid) as { owner_user_id: string; login_session_id: string; action: string } | null;
  if (recovery && (recovery.owner_user_id !== row.owner_user_id || recovery.action !== "retry")) throw new ChatAccessDenied();
  const provenance: ExecutionProvenance = { actorUserId: row.actor_user_id, ownerUserId: row.owner_user_id, chatJid,
    kind: "interactive", authenticationSessionId: recovery?.login_session_id ?? row.login_session_id };
  const identity = authoriseExecutionIdentity(db, "family-shared", chatJid, provenance);
  if (!identity) throw new ChatAccessDenied();
  return identity;
}

/** Message and authority commit together; retries cannot substitute a different body or target. */
export function admitFamilyMessage(actor: AuthenticatedPrincipal, input: { chatJid?: string; content: string; requestId: string; threadId?: number | null; mode?: FamilyTurnAdmissionMode; mediaIds?: number[]; contentBlocks?: unknown[] }) {
  const mediaIds = input.mediaIds ?? [],providedBlocks=input.contentBlocks;
  if (providedBlocks !== undefined && (mediaIds.length > 0 || providedBlocks.length !== 1 || !validSubmissionBlock(providedBlocks[0]))) throw new ChatAccessDenied();
  validateText(input.content, mediaIds.length > 0);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.requestId)) throw new Error("A stable request_id is required.");
  const db = getDb();
  return db.transaction(() => {
    const user = requireAccountActor(db, actor);
    const target = resolveAuthorisedChat(db, actor, input.chatJid, "session.write");
    const mode = input.mode ?? "send";
    if (!["send", "queue", "queue_all", "steer", "auto"].includes(mode)) throw new ChatAccessDenied();
    const threadId = input.threadId ?? null;
    if (threadId !== null && (!Number.isSafeInteger(threadId) || threadId <= 0 || !getMessageByRowId(target.chatJid, threadId))) throw new ChatAccessDenied();
    const canonicalBlocks = providedBlocks??mediaIds.map(mediaId => {
      const info = getMediaInfoByIdFromDatabase(db, mediaId);
      if (!info) throw new ChatAccessDenied();
      const type = info.content_type.toLowerCase().startsWith("image/") ? "image" : "file";
      return { type, media_id: mediaId, name: info.filename, filename: info.filename, mime_type: info.content_type };
    });
    const existing = db.query("SELECT * FROM message_execution_authorities WHERE owner_user_id=? AND request_id=?")
      .get(actor.userId, input.requestId) as Authority | null;
    if (existing) {
      const existingMedia=readFamilyMessageMediaIds(db,existing.message_rowid),existingMessage=getMessageByRowId(target.chatJid,existing.message_rowid);
      if (existing.chat_jid !== target.chatJid || existing.content_hash !== payloadHash(input.content,mediaIds,canonicalBlocks) || existing.thread_id !== threadId
        || JSON.stringify(existingMedia) !== JSON.stringify([...mediaIds].sort((a,b)=>a-b)) || JSON.stringify(existingMessage?.data.content_blocks??[])!==JSON.stringify(canonicalBlocks)) throw new ChatAccessDenied();
      const queue = readFamilyTurnQueueByMessageId(target.chatJid, existing.message_id);
      if (!queue || queue.admission_mode !== mode || queue.owner_user_id !== actor.userId) throw new ChatAccessDenied();
      // A crash after HTTP admission but before the wake is safe to retry: if
      // this is still the selected ready item and the chat has no run marker,
      // the caller will issue the same idempotent wake below.
      return { interaction: getMessageByRowId(target.chatJid, existing.message_rowid)!, queue, created: false };
    }
    consumeFamilyMediaUploads(db, actor, mediaIds);
    const contentBlocks = canonicalBlocks;
    const messageId = createUuid("msg");
    const rowId = storeMessageInDatabase(db, { id: messageId, chat_jid: target.chatJid, sender: user.id, sender_name: user.display_name,
      content: input.content, timestamp: new Date().toISOString(), is_from_me: false, is_bot_message: false, thread_id: threadId,
      content_blocks: contentBlocks.length ? contentBlocks : undefined });
    if (mediaIds.length) attachMediaToMessageInDatabase(db, rowId, mediaIds);
    if (!rowId) throw new Error("Message persistence failed.");
    const createdAt = new Date().toISOString();
    db.query(`INSERT INTO message_execution_authorities(message_rowid,message_id,chat_jid,owner_user_id,actor_user_id,login_session_id,request_id,content_hash,thread_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(rowId, messageId, target.chatJid, user.id, user.id, actor.authentication.sessionId!, input.requestId, payloadHash(input.content,mediaIds,contentBlocks.length?contentBlocks:undefined), threadId, new Date().toISOString());
    const queue = insertFamilyTurnQueue(db, { messageRowId: rowId, messageId, chatJid: target.chatJid, ownerUserId: user.id, mode, createdAt });
    return { interaction: getMessageByRowId(target.chatJid, rowId)!, queue, created: true };
  }).immediate();
}
