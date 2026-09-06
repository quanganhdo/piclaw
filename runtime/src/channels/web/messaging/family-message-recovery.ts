import type { AuthenticatedPrincipal } from "../../../core/access-types.js";
import { getDb } from "../../../db/connection.js";
import { requireAccountActor } from "../../../db/account-administration.js";
import { ChatAccessDenied, resolveAuthorisedChat } from "../../../db/session-ownership.js";
import { getChatCursor, getFailedRun, clearFailedRun, setChatCursor } from "../../../db/chat-cursors.js";
import { getIdentityConfig } from "../../../core/config.js";
import { readFamilyMessageAdmission, resolveFamilyMessageAuthority } from "./family-message-authority.js";
import { migrationDismissalFilter, migrationInputHash } from '../../../db/migration-input-holds.js';

export interface MessageRecoveryInput { chatJid: string; messageRowId: number; requestId: string; action: "retry" | "skip" }

/** Match normal dequeue exclusions, but read one metadata row rather than loading the whole queue. */
function oldestPendingInput(chatJid: string) {
  return getDb().query(`SELECT rowid,id,timestamp FROM messages WHERE chat_jid=? AND timestamp>?
    AND is_bot_message=0 AND content NOT LIKE ? AND ltrim(content) NOT LIKE '/%'
    AND COALESCE(is_steering_message,0)=0 ${migrationDismissalFilter(getDb())} ORDER BY timestamp ASC,rowid ASC LIMIT 1`)
    .get(chatJid, getChatCursor(chatJid), `${getIdentityConfig().assistantName}:%`) as { rowid:number; id: string; timestamp: string } | null;
}

/** Metadata only: failure text, message content, login IDs and runtime arguments stay private. */
export function readFamilyRecoveryStatus(actor: AuthenticatedPrincipal, chatJid?: string) {
  const db = getDb();
  return db.transaction(() => {
    requireAccountActor(db, actor);
    const target = resolveAuthorisedChat(db, actor, chatJid, "session.read");
    const cursor = db.query("SELECT inflight_message_id,preflight_message_id FROM chat_cursors WHERE chat_jid=?").get(target.chatJid) as { inflight_message_id: string | null; preflight_message_id: string | null } | null;
    if (cursor?.inflight_message_id || cursor?.preflight_message_id) return { state: "working" as const };
    const head = oldestPendingInput(target.chatJid);
    if (!head) return { state: "idle" as const };
    const failed = getFailedRun(target.chatJid);
    if (failed && failed.messageId !== head.id) return { state: "blocked" as const };
    const legacy=db.query('SELECT owner_user_id,message_id,message_timestamp FROM migration_input_holds WHERE message_rowid=? AND chat_jid=?').get(head.rowid,target.chatJid) as {owner_user_id:string;message_id:string;message_timestamp:string}|null;
    if(legacy)return legacy.owner_user_id===actor.userId&&legacy.message_id===head.id&&legacy.message_timestamp===head.timestamp
      ? {state:'legacy-held' as const,message_rowid:head.rowid} : {state:'blocked' as const};
    let row: ReturnType<typeof readFamilyMessageAdmission>;
    try { row = readFamilyMessageAdmission(target.chatJid, head.id); }
    catch { return { state: "blocked" as const }; }
    if (row.owner_user_id !== actor.userId) return { state: "blocked" as const };
    let held = Boolean(failed);
    try { resolveFamilyMessageAuthority(target.chatJid, head.id); }
    catch (error) { if (!(error instanceof ChatAccessDenied)) throw error; held = true; }
    return held ? { state: "held" as const, message_rowid: row.message_rowid } : { state: "queued" as const };
  })();
}

/** A dismissed legacy input stays in history and can never acquire normal execution/retry authority. */
export function dismissLegacyInput(actor:AuthenticatedPrincipal,input:Omit<MessageRecoveryInput,'action'>) {
  const db=getDb();
  return db.transaction(()=>{
    requireAccountActor(db,actor,{recent:true});resolveAuthorisedChat(db,actor,input.chatJid,'session.write');
    if(!Number.isSafeInteger(input.messageRowId)||input.messageRowId<=0||!/^[a-zA-Z0-9_-]{1,128}$/.test(input.requestId))throw new ChatAccessDenied();
    const row=db.query(`SELECT h.*,m.content,m.id AS current_id,m.timestamp AS current_timestamp FROM migration_input_holds h
      JOIN messages m ON m.rowid=h.message_rowid AND m.chat_jid=h.chat_jid WHERE h.message_rowid=? AND h.chat_jid=? AND h.owner_user_id=?`).get(input.messageRowId,input.chatJid,actor.userId) as {message_id:string;message_timestamp:string;content_hash:string;content:string;current_id:string;current_timestamp:string}|null;
    if(!row||row.message_id!==row.current_id||row.message_timestamp!==row.current_timestamp||row.content_hash!==migrationInputHash(row.content))throw new ChatAccessDenied();
    const duplicate=db.query('SELECT id,message_rowid FROM migration_input_dismissals WHERE owner_user_id=? AND request_id=?').get(actor.userId,input.requestId) as {id:number;message_rowid:number}|null;
    if(duplicate){if(duplicate.message_rowid!==input.messageRowId)throw new ChatAccessDenied();return {created:false,recovery_id:duplicate.id,action:'dismiss-legacy' as const,message_rowid:input.messageRowId};}
    const cursor=db.query('SELECT inflight_message_id,preflight_message_id,compaction_active_started_at FROM chat_cursors WHERE chat_jid=?').get(input.chatJid) as Record<string,unknown>|null;
    if(cursor&&Object.values(cursor).some(Boolean))throw new Error('Legacy dismissal requires an idle chat.');
    const head=oldestPendingInput(input.chatJid),failed=getFailedRun(input.chatJid);
    if(!head||head.rowid!==input.messageRowId||(failed&&failed.messageId!==head.id))throw new ChatAccessDenied();
    const inserted=db.query('INSERT INTO migration_input_dismissals(message_rowid,owner_user_id,login_session_id,request_id,created_at) VALUES (?,?,?,?,?)')
      .run(input.messageRowId,actor.userId,actor.authentication.sessionId!,input.requestId,new Date().toISOString());
    if(failed)clearFailedRun(input.chatJid);
    return {created:true,recovery_id:Number(inserted.lastInsertRowid),action:'dismiss-legacy' as const,message_rowid:input.messageRowId};
  }).immediate();
}

/** Called under the same per-chat queue lane; every predicate is checked again at commit. */
export function recoverFamilyMessage(actor: AuthenticatedPrincipal, input: MessageRecoveryInput) {
  if (!Number.isSafeInteger(input.messageRowId) || input.messageRowId <= 0 || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.requestId)
    || !["retry", "skip"].includes(input.action)) throw new Error("Invalid recovery request.");
  const db = getDb();
  return db.transaction(() => {
    requireAccountActor(db, actor, { recent: true });
    resolveAuthorisedChat(db, actor, input.chatJid, "session.write");
    const admission = db.query("SELECT message_id FROM message_execution_authorities WHERE message_rowid=? AND chat_jid=? AND owner_user_id=?")
      .get(input.messageRowId, input.chatJid, actor.userId) as { message_id: string } | null;
    if (!admission) throw new ChatAccessDenied();
    const row = readFamilyMessageAdmission(input.chatJid, admission.message_id);
    const duplicate = db.query("SELECT id,message_rowid,action FROM message_recovery_authorities WHERE owner_user_id=? AND request_id=?")
      .get(actor.userId, input.requestId) as { id: number; message_rowid: number; action: string } | null;
    if (duplicate) {
      if (duplicate.message_rowid !== input.messageRowId || duplicate.action !== input.action) throw new ChatAccessDenied();
      return { created: false, recovery_id: duplicate.id, action: input.action, message_rowid: input.messageRowId };
    }
    const cursor = db.query("SELECT inflight_message_id,preflight_message_id FROM chat_cursors WHERE chat_jid=?").get(input.chatJid) as { inflight_message_id: string | null; preflight_message_id: string | null } | null;
    if (cursor?.inflight_message_id || cursor?.preflight_message_id) throw new Error("Message recovery requires an idle chat.");
    const failed = getFailedRun(input.chatJid);
    const head = oldestPendingInput(input.chatJid);
    // Only the oldest unconsumed, admitted input can be skipped or retried. Never rewind a completed turn.
    if (!head || head.id !== row.message_id || (failed && failed.messageId !== row.message_id)) throw new ChatAccessDenied();
    const now = new Date().toISOString();
    const inserted = db.query("INSERT INTO message_recovery_authorities(message_rowid,owner_user_id,login_session_id,request_id,action,failure_created_at,created_at) VALUES (?,?,?,?,?,?,?)")
      .run(row.message_rowid, actor.userId, actor.authentication.sessionId!, input.requestId, input.action, failed?.createdAt ?? null, now);
    if (input.action === "skip") setChatCursor(input.chatJid, head.timestamp);
    clearFailedRun(input.chatJid);
    return { created: true, recovery_id: Number(inserted.lastInsertRowid), action: input.action, message_rowid: input.messageRowId };
  }).immediate();
}
