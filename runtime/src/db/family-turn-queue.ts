import type Database from "bun:sqlite";
import type { AuthenticatedPrincipal } from "../core/access-types.js";
import { getDb } from "./connection.js";
import { requireAccountActor } from "./account-administration.js";
import { ChatAccessDenied, resolveAuthorisedChat } from "./session-ownership.js";
import { clearFailedRun, endChatRun } from "./chat-cursors.js";

export type FamilyTurnAdmissionMode = "send" | "queue" | "queue_all" | "steer" | "auto";
export type FamilyTurnQueueState = "held" | "ready" | "dispatching" | "completed" | "removed" | "skipped" | "steered";

export interface FamilyTurnQueueRow {
  message_rowid: number;
  message_id: string;
  chat_jid: string;
  owner_user_id: string;
  admission_mode: FamilyTurnAdmissionMode;
  queue_position: number;
  state: FamilyTurnQueueState;
  created_at: string;
  updated_at: string;
  revision: number;
}

const terminalStates = new Set<FamilyTurnQueueState>(["completed", "removed", "skipped", "steered"]);

function readQueueRow(database: Database, chatJid: string, messageRowId: number): FamilyTurnQueueRow | null {
  return database.query("SELECT * FROM family_turn_queue WHERE chat_jid=? AND message_rowid=?")
    .get(chatJid, messageRowId) as FamilyTurnQueueRow | null;
}

function chatHasRunBarrier(database: Database, chatJid: string): boolean {
  const cursor = database.query(`SELECT preflight_message_id,inflight_message_id,failed_message_id
    FROM chat_cursors WHERE chat_jid=?`).get(chatJid) as Record<string, unknown> | null;
  return Boolean(cursor && Object.values(cursor).some(Boolean));
}

function ensureQueueAuthority(database: Database, row: FamilyTurnQueueRow): void {
  const authority = database.query(`SELECT message_id,chat_jid,owner_user_id FROM message_execution_authorities
    WHERE message_rowid=?`).get(row.message_rowid) as { message_id: string; chat_jid: string; owner_user_id: string } | null;
  if (!authority || authority.message_id !== row.message_id || authority.chat_jid !== row.chat_jid || authority.owner_user_id !== row.owner_user_id) throw new ChatAccessDenied();
}

/** Promote exactly one held item when no run or recovery barrier owns the chat. */
export function activateNextFamilyTurn(database: Database, chatJid: string): FamilyTurnQueueRow | null {
  if (chatHasRunBarrier(database, chatJid)) return null;
  const current = database.query("SELECT * FROM family_turn_queue WHERE chat_jid=? AND state='ready'")
    .get(chatJid) as FamilyTurnQueueRow | null;
  if (current) return current;
  const next = database.query(`SELECT * FROM family_turn_queue WHERE chat_jid=? AND state='held'
    ORDER BY queue_position,message_rowid LIMIT 1`).get(chatJid) as FamilyTurnQueueRow | null;
  if (!next) return null;
  ensureQueueAuthority(database, next);
  const now = new Date().toISOString();
  database.query("UPDATE family_turn_queue SET state='ready',updated_at=?,revision=revision+1 WHERE message_rowid=? AND state='held'")
    .run(now, next.message_rowid);
  return readQueueRow(database, chatJid, next.message_rowid);
}

export function insertFamilyTurnQueue(
  database: Database,
  input: { messageRowId: number; messageId: string; chatJid: string; ownerUserId: string; mode: FamilyTurnAdmissionMode; createdAt: string },
): FamilyTurnQueueRow {
  const tail = database.query("SELECT COALESCE(MAX(queue_position),0) AS n FROM family_turn_queue WHERE chat_jid=?")
    .get(input.chatJid) as { n: number };
  database.query(`INSERT INTO family_turn_queue
    (message_rowid,message_id,chat_jid,owner_user_id,admission_mode,queue_position,state,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'held',?,?)`).run(
      input.messageRowId, input.messageId, input.chatJid, input.ownerUserId, input.mode,
      Number(tail.n) + 1, input.createdAt, input.createdAt,
    );
  activateNextFamilyTurn(database, input.chatJid);
  return readQueueRow(database, input.chatJid, input.messageRowId)!;
}

export function readFamilyTurnQueueByMessageId(chatJid: string, messageId: string): FamilyTurnQueueRow | null {
  return getDb().query("SELECT * FROM family_turn_queue WHERE chat_jid=? AND message_id=?")
    .get(chatJid, messageId) as FamilyTurnQueueRow | null;
}

export function listOwnedFamilyQueuedTurns(actor: AuthenticatedPrincipal, chatJid?: string) {
  const database = getDb();
  return database.transaction(() => {
    requireAccountActor(database, actor);
    const target = resolveAuthorisedChat(database, actor, chatJid, "session.read");
    const rows = database.query(`SELECT q.message_rowid AS row_id,m.content,m.timestamp,m.thread_id,q.admission_mode
      FROM family_turn_queue q JOIN messages m ON m.rowid=q.message_rowid AND m.id=q.message_id AND m.chat_jid=q.chat_jid
      WHERE q.chat_jid=? AND q.owner_user_id=? AND q.state='held'
      ORDER BY q.queue_position,q.message_rowid`).all(target.chatJid, actor.userId) as Array<Record<string, unknown>>;
    requireAccountActor(database, actor);
    return rows;
  })();
}

function requireMutableOwnedQueueRow(database: Database, actor: AuthenticatedPrincipal, chatJid: string, messageRowId: number): FamilyTurnQueueRow {
  requireAccountActor(database, actor);
  resolveAuthorisedChat(database, actor, chatJid, "session.write");
  const row = readQueueRow(database, chatJid, messageRowId);
  if (!row || row.owner_user_id !== actor.userId || terminalStates.has(row.state)) throw new ChatAccessDenied();
  return row;
}

export function removeOwnedFamilyQueuedTurn(actor: AuthenticatedPrincipal, chatJid: string, messageRowId: number): boolean {
  const database = getDb();
  return database.transaction(() => {
    requireAccountActor(database, actor);
    resolveAuthorisedChat(database, actor, chatJid, "session.write");
    const row = readQueueRow(database, chatJid, messageRowId);
    if (!row || row.owner_user_id !== actor.userId) throw new ChatAccessDenied();
    if (row.state === "removed") return false;
    if (terminalStates.has(row.state)) throw new ChatAccessDenied();
    if (row.state !== "held") return false;
    database.query("UPDATE family_turn_queue SET state='removed',updated_at=?,revision=revision+1 WHERE message_rowid=? AND state='held'")
      .run(new Date().toISOString(), messageRowId);
    return true;
  }).immediate();
}

export function reorderOwnedFamilyQueuedTurns(actor: AuthenticatedPrincipal, chatJid: string, fromIndex: number, toIndex: number): boolean {
  const database = getDb();
  return database.transaction(() => {
    requireAccountActor(database, actor);
    resolveAuthorisedChat(database, actor, chatJid, "session.write");
    const rows = database.query(`SELECT message_rowid FROM family_turn_queue WHERE chat_jid=? AND owner_user_id=? AND state='held'
      ORDER BY queue_position,message_rowid`).all(chatJid, actor.userId) as Array<{ message_rowid: number }>;
    if (!Number.isSafeInteger(fromIndex) || !Number.isSafeInteger(toIndex) || fromIndex < 0 || toIndex < 0
      || fromIndex >= rows.length || toIndex >= rows.length || fromIndex === toIndex) return false;
    const [moved] = rows.splice(fromIndex, 1);
    rows.splice(toIndex, 0, moved!);
    const now = new Date().toISOString();
    const update = database.query("UPDATE family_turn_queue SET queue_position=?,updated_at=?,revision=revision+1 WHERE message_rowid=? AND state='held'");
    rows.forEach((row, index) => update.run(index + 1, now, row.message_rowid));
    return true;
  }).immediate();
}

export function beginOwnedFamilySteer(actor: AuthenticatedPrincipal, chatJid: string, messageRowId: number): FamilyTurnQueueRow {
  const database = getDb();
  return database.transaction(() => {
    const row = requireMutableOwnedQueueRow(database, actor, chatJid, messageRowId);
    if (row.state !== "held") throw new ChatAccessDenied();
    database.query("UPDATE family_turn_queue SET state='dispatching',updated_at=?,revision=revision+1 WHERE message_rowid=? AND state='held'")
      .run(new Date().toISOString(), messageRowId);
    return readQueueRow(database, chatJid, messageRowId)!;
  }).immediate();
}

/** Commit the persisted steering marker only after the active session accepted it. */
export function completeOwnedFamilySteer(chatJid: string, messageRowId: number, threadId: number | null): void {
  const database = getDb();
  database.transaction(() => {
    const row = readQueueRow(database, chatJid, messageRowId);
    if (!row || row.state !== "dispatching") throw new ChatAccessDenied();
    database.query("UPDATE messages SET is_steering_message=1,thread_id=COALESCE(?,thread_id) WHERE rowid=? AND chat_jid=?")
      .run(threadId, messageRowId, chatJid);
    database.query("UPDATE family_turn_queue SET state='steered',updated_at=?,revision=revision+1 WHERE message_rowid=? AND state='dispatching'")
      .run(new Date().toISOString(), messageRowId);
  }).immediate();
}

/** A verified non-streaming session converts a steer request back into ordinary ordered work. */
export function releaseOwnedFamilySteer(chatJid: string, messageRowId: number): FamilyTurnQueueRow {
  const database = getDb();
  return database.transaction(() => {
    const row = readQueueRow(database, chatJid, messageRowId);
    if (!row || row.state !== "dispatching") throw new ChatAccessDenied();
    database.query("UPDATE family_turn_queue SET state='held',updated_at=?,revision=revision+1 WHERE message_rowid=? AND state='dispatching'")
      .run(new Date().toISOString(), messageRowId);
    activateNextFamilyTurn(database, chatJid);
    return readQueueRow(database, chatJid, messageRowId)!;
  }).immediate();
}

/** Clear run markers and advance the durable queue as one SQLite transaction. */
export function completeFamilyTurnRun(chatJid: string): FamilyTurnQueueRow | null {
  const database = getDb();
  return database.transaction(() => {
    const cursor = database.query("SELECT inflight_message_id FROM chat_cursors WHERE chat_jid=?")
      .get(chatJid) as { inflight_message_id: string | null } | null;
    const row = cursor?.inflight_message_id ? readFamilyTurnQueueByMessageId(chatJid, cursor.inflight_message_id) : null;
    if (!row || row.state !== "ready") throw new ChatAccessDenied();
    endChatRun(chatJid);
    database.query("UPDATE family_turn_queue SET state='completed',updated_at=?,revision=revision+1 WHERE message_rowid=? AND state='ready'")
      .run(new Date().toISOString(), row.message_rowid);
    return activateNextFamilyTurn(database, chatJid);
  }).immediate();
}

/** Recovery terminalized a selected turn after its run marker was cleared. */
export function settleRecoveredFamilyTurn(chatJid: string, messageId: string): { settled: boolean; next: FamilyTurnQueueRow | null } {
  const database = getDb();
  const row = readFamilyTurnQueueByMessageId(chatJid, messageId);
  if (!row || row.state !== "ready" || chatHasRunBarrier(database, chatJid)) return { settled: false, next: null };
  database.query("UPDATE family_turn_queue SET state='completed',updated_at=?,revision=revision+1 WHERE message_rowid=? AND state='ready'")
    .run(new Date().toISOString(), row.message_rowid);
  return { settled: true, next: activateNextFamilyTurn(database, chatJid) };
}

export function skipFamilyTurn(database: Database, chatJid: string, messageRowId: number): FamilyTurnQueueRow | null {
  const row = readQueueRow(database, chatJid, messageRowId);
  if (!row || row.state !== "ready") throw new ChatAccessDenied();
  database.query("UPDATE family_turn_queue SET state='skipped',updated_at=?,revision=revision+1 WHERE message_rowid=? AND state='ready'")
    .run(new Date().toISOString(), messageRowId);
  clearFailedRun(chatJid);
  return activateNextFamilyTurn(database, chatJid);
}

/** SQL fragment used only in family mode: hidden held/removed work stays out of ordinary timeline reads. */
export function familyTurnTimelineFilter(database: Database, alias = "messages"): string {
  if (!database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='family_turn_queue'").get()) return "";
  return `AND NOT EXISTS (SELECT 1 FROM family_turn_queue fq WHERE fq.message_rowid=${alias}.rowid
    AND fq.message_id=${alias}.id AND fq.chat_jid=${alias}.chat_jid AND fq.state IN ('held','dispatching','removed'))`;
}

export function isFamilyTurnHidden(chatJid: string, messageRowId: number): boolean {
  const row = readQueueRow(getDb(), chatJid, messageRowId);
  return Boolean(row && ["held", "dispatching", "removed"].includes(row.state));
}
