import type { Database } from "bun:sqlite";
import type { AcceptedInput } from "./host-runtime.js";

/** The accepted source exists, but its selected reply root is unavailable. */
export class AcceptedReplyThreadUnavailableError extends Error {
  constructor() { super("Accepted reply thread missing"); this.name = "AcceptedReplyThreadUnavailableError"; }
}

/** Resolve only the immutable accepted message, never the latest timeline row. */
export function resolveAcceptedMessageThread(db: Database, input: AcceptedInput): number | null {
  const source = db.query(`SELECT kind,source_id,payload_ref FROM service_effect_s01_sources
    WHERE chat_jid=? AND source_seq=?`).get(input.chatJid, input.sourceSeq) as
    { kind: string; source_id: string; payload_ref: string } | null;
  if (!source || source.source_id !== input.sourceId || source.payload_ref !== input.payloadRef)
    throw Error("Reply source identity changed");
  if (source.kind !== "message") return null;
  const row = db.query(`SELECT rowid,thread_id FROM messages
    WHERE chat_jid=? AND id=? AND is_bot_message=0`).get(input.chatJid, input.sourceId) as
    { rowid: number; thread_id: number | null } | null;
  if (!row || (input.payloadRef !== `message-row:${row.rowid}` && input.payloadRef !== `queued-source:${input.sourceId}`))
    throw Error("Accepted reply message missing or mismatched");
  const threadId = row.thread_id ?? row.rowid;
  if (!Number.isSafeInteger(threadId) || threadId <= 0 || !db.query(
    "SELECT 1 FROM messages WHERE chat_jid=? AND rowid=? AND (thread_id IS NULL OR thread_id=rowid)"
  ).get(input.chatJid, threadId)) throw new AcceptedReplyThreadUnavailableError();
  return threadId;
}
