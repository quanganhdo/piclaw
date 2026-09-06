import { createHash } from "node:crypto";
import type { AuthenticatedPrincipal } from "../../../core/access-types.js";
import type { ExecutionProvenance } from "../../../core/execution-context.js";
import { getDb } from "../../../db/connection.js";
import { requireAccountActor } from "../../../db/account-administration.js";
import { ChatAccessDenied, resolveAuthorisedChat } from "../../../db/session-ownership.js";
import { getMessageByRowId, storeMessage } from "../../../db/messages.js";
import { createUuid } from "../../../utils/ids.js";
import { authoriseExecutionIdentity } from "../../../agent-pool/execution-identity.js";
import { getIdentityConfig, getRoutingConfig } from "../../../core/config.js";
import { parseControlCommand } from "../../../agent-control/index.js";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
interface Authority { message_rowid: number; message_id: string; chat_jid: string; owner_user_id: string; actor_user_id: string; login_session_id: string; content_hash: string; thread_id: number | null }

function validateText(content: string): void {
  if (!content.trim() || content.length > 100 * 1024 || /^[\s]*[/@]/.test(content)
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
  if (!row || row.owner_user_id !== row.actor_user_id || row.content_hash !== hash(row.content) || row.current_thread_id !== row.thread_id
    || row.is_bot_message || row.is_steering_message || row.content_blocks || row.link_previews
    || db.query("SELECT 1 FROM message_media WHERE message_rowid=?").get(row.message_rowid)) throw new ChatAccessDenied();
  validateText(row.content);
  if (row.thread_id !== null && !getMessageByRowId(chatJid, row.thread_id)) throw new ChatAccessDenied();
  return row;
}

/** The latest explicit retry grant supersedes its original login; skipped messages cannot execute. */
export function resolveFamilyMessageAuthority(chatJid: string, messageId: string) {
  const db = getDb();
  const row = readFamilyMessageAdmission(chatJid, messageId);
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
export function admitFamilyMessage(actor: AuthenticatedPrincipal, input: { chatJid?: string; content: string; requestId: string; threadId?: number | null }) {
  validateText(input.content);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.requestId)) throw new Error("A stable request_id is required.");
  const db = getDb();
  return db.transaction(() => {
    const user = requireAccountActor(db, actor);
    const target = resolveAuthorisedChat(db, actor, input.chatJid, "session.write");
    const threadId = input.threadId ?? null;
    if (threadId !== null && (!Number.isSafeInteger(threadId) || threadId <= 0 || !getMessageByRowId(target.chatJid, threadId))) throw new ChatAccessDenied();
    const existing = db.query("SELECT * FROM message_execution_authorities WHERE owner_user_id=? AND request_id=?")
      .get(actor.userId, input.requestId) as Authority | null;
    if (existing) {
      if (existing.chat_jid !== target.chatJid || existing.content_hash !== hash(input.content) || existing.thread_id !== threadId) throw new ChatAccessDenied();
      resolveFamilyMessageAuthority(target.chatJid, existing.message_id);
      return { interaction: getMessageByRowId(target.chatJid, existing.message_rowid)!, created: false };
    }
    const messageId = createUuid("msg");
    const rowId = storeMessage({ id: messageId, chat_jid: target.chatJid, sender: user.id, sender_name: user.display_name,
      content: input.content, timestamp: new Date().toISOString(), is_from_me: false, is_bot_message: false, thread_id: threadId });
    if (!rowId) throw new Error("Message persistence failed.");
    db.query(`INSERT INTO message_execution_authorities(message_rowid,message_id,chat_jid,owner_user_id,actor_user_id,login_session_id,request_id,content_hash,thread_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(rowId, messageId, target.chatJid, user.id, user.id, actor.authentication.sessionId!, input.requestId, hash(input.content), threadId, new Date().toISOString());
    return { interaction: getMessageByRowId(target.chatJid, rowId)!, created: true };
  }).immediate();
}
