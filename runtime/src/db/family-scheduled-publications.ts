import type Database from "bun:sqlite";
import { createHash } from "node:crypto";
import type { AuthenticatedPrincipal } from "../core/access-types.js";
import type { NewMessage } from "../types.js";
import { requireAccountActor } from "./account-administration.js";
import { readOwnFamilyScheduledResult } from "./family-scheduled-executions.js";
import { storeMessageInDatabase } from "./messages.js";
import { ChatAccessDenied } from "./session-ownership.js";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
interface Publication { execution_id: string; owner_user_id: string; login_session_id: string; message_rowid: number; message_id: string; chat_jid: string; content_hash: string; published_at: string }

/** Explicit owner publication, never a scheduler completion hook. No queue, model, push or cursor effects. */
export function publishOwnFamilyScheduledResult(database: Database, actor: AuthenticatedPrincipal, executionId: string) {
  return database.transaction(() => {
    requireAccountActor(database,actor,{recent:true});
    const source = readOwnFamilyScheduledResult(database,actor,executionId);
    if (source.state !== "settled" || !source.result) throw new ChatAccessDenied();
    const message: NewMessage = {
      id: `scheduled-result-${source.execution_id}`, chat_jid: source.chat_jid, sender: "service:scheduler", sender_name: "Scheduled task",
      content: `Scheduled task result (${source.result.status})\nOwner: ${JSON.stringify(source.owner_username)} (${JSON.stringify(source.owner_display_name)})\nExecution: ${source.execution_id}\n\n${source.result.text}`,
      timestamp: new Date().toISOString(), is_from_me: true, is_bot_message: true, is_terminal_agent_reply: false, is_steering_message: false,
    };
    const existing = database.query("SELECT * FROM family_scheduled_publications WHERE execution_id=?").get(executionId) as Publication | null;
    if (existing) {
      if (existing.owner_user_id !== actor.userId || existing.chat_jid !== message.chat_jid || existing.message_id !== message.id
        || existing.content_hash !== hash(message.content)) throw new ChatAccessDenied();
      const row = database.query("SELECT rowid,* FROM messages WHERE rowid=? AND id=? AND chat_jid=?").get(existing.message_rowid,existing.message_id,existing.chat_jid) as
        { content: string; timestamp: string; sender: string; sender_name: string; is_from_me: number; is_bot_message: number; is_terminal_agent_reply: number;
          is_steering_message: number; content_blocks: string | null; link_previews: string | null; annotations: string | null; screen_hint: string | null; thread_id: number | null } | null;
      if (!row || row.content !== message.content || row.timestamp !== existing.published_at || row.sender !== message.sender || row.sender_name !== message.sender_name
        || row.is_from_me !== 1 || row.is_bot_message !== 1 || row.is_terminal_agent_reply !== 0 || row.is_steering_message !== 0
        || row.content_blocks !== null || row.link_previews !== null || row.annotations !== null || row.screen_hint !== null || row.thread_id !== null
        || database.query("SELECT 1 FROM message_media WHERE message_rowid=?").get(existing.message_rowid)) throw new ChatAccessDenied();
      return { execution_id: executionId, chat_jid: existing.chat_jid, message_rowid: existing.message_rowid, created: false };
    }
    // The shared writer supports upserts; an unexpected deterministic-ID collision must not overwrite history.
    if (database.query("SELECT 1 FROM messages WHERE id=?").get(message.id)) throw new ChatAccessDenied();
    const rowId = storeMessageInDatabase(database,message);
    if (!rowId) throw new ChatAccessDenied();
    database.query(`INSERT INTO family_scheduled_publications(execution_id,owner_user_id,login_session_id,message_rowid,message_id,chat_jid,content_hash,published_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(executionId,actor.userId,actor.authentication.sessionId!,rowId,message.id,message.chat_jid,hash(message.content),message.timestamp);
    return { execution_id: executionId, chat_jid: message.chat_jid, message_rowid: rowId, created: true };
  }).immediate();
}
