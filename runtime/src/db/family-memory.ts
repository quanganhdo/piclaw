import type Database from 'bun:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import type { AuthenticatedPrincipal } from '../core/access-types.js';
import { readAccessConfig } from '../core/config-access.js';
import { getExecutionIdentity } from '../core/execution-context.js';
import { requireAccountActor } from './account-administration.js';
import { ChatAccessDenied, resolveAuthorisedChat } from './session-ownership.js';

type Source = { chat_jid: string; message_rowid: number; message_id: string };
type PublicationInput = Source & { request_id: string; source_hash: string; text: string; confirm: true };
interface Publication {
  publication_id: string; owner_user_id: string; request_id: string; login_session_id: string;
  publisher_username: string; publisher_display_name: string;
  source_chat_jid: string; source_message_rowid: number; source_message_id: string; source_hash: string;
  text: string; text_hash: string; published_at: string;
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const wellFormed = (text: string) => Buffer.from(text, 'utf8').toString('utf8') === text;
const identifier = (value: unknown, max = 256): value is string => typeof value === 'string' && value.length > 0
  && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);

function exact(value: unknown, keys: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length
    || Object.keys(value).some(key => !keys.includes(key))) throw new ChatAccessDenied();
}
function authority(database: Database, actor: AuthenticatedPrincipal, recent = false) {
  // These are control-plane APIs, never a model tool, Dream hook or durable service grant.
  if (getExecutionIdentity() || readAccessConfig().mode !== 'family-shared') throw new ChatAccessDenied();
  return requireAccountActor(database, actor, { recent });
}
function source(database: Database, actor: AuthenticatedPrincipal, input: Source) {
  if (!identifier(input.chat_jid) || !identifier(input.message_id) || !Number.isSafeInteger(input.message_rowid)
    || input.message_rowid <= 0) throw new ChatAccessDenied();
  const owned = resolveAuthorisedChat(database, actor, input.chat_jid, 'session.read');
  // Bound allocation in SQL before returning text; media, thinking and structured blocks are never read.
  const row = database.query(`SELECT m.rowid,m.id,m.chat_jid,m.content,m.timestamp,m.sender,m.sender_name,
    m.is_from_me,m.is_bot_message,m.is_terminal_agent_reply,m.is_steering_message,m.thread_id,b.branch_id
    FROM messages m JOIN chat_branches b ON b.chat_jid=m.chat_jid
    WHERE m.rowid=? AND m.id=? AND m.chat_jid=? AND length(CAST(m.content AS BLOB)) BETWEEN 1 AND 102400`)
    .get(input.message_rowid, input.message_id, input.chat_jid) as { content: string; branch_id: string } | null;
  if (!row || row.content.includes('\0') || !wellFormed(row.content)) throw new ChatAccessDenied();
  return { text: row.content, source_hash: hash(JSON.stringify({ root: owned.rootBranchId, owner: owned.ownerUserId, row })) };
}
function find(database: Database, id: string): Publication {
  if (!uuid(id)) throw new ChatAccessDenied();
  const row = database.query('SELECT * FROM family_memory_publications WHERE publication_id=?').get(id) as Publication | null;
  if (!row || !digest(row.text_hash) || hash(row.text) !== row.text_hash) throw new ChatAccessDenied();
  return row;
}
function withdrawn(database: Database, id: string): boolean {
  return !!database.query('SELECT 1 FROM family_memory_withdrawals WHERE publication_id=?').get(id);
}
function shared(row: Publication) {
  return { publication_id: row.publication_id, publisher: { user_id: row.owner_user_id,
    username: row.publisher_username, display_name: row.publisher_display_name }, source_kind: 'message-excerpt' as const,
    text: row.text, published_at: row.published_at };
}

const FAMILY_MEMORY_PROMPT_MAX_ITEMS = 20;
const FAMILY_MEMORY_PROMPT_MAX_BYTES = 32768;
const deceptiveControls = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
const json = (value:unknown) => JSON.stringify(value).replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029');

/** Trusted family-bootstrap projection. No private source, request or login metadata. */
export function readFamilyMemoryPromptSnapshot(database: Database, validate: () => void): string {
  validate();
  const rows = database.transaction(() => {
    validate();
    const value = database.query(`SELECT p.publication_id,p.owner_user_id,p.publisher_username,p.publisher_display_name,p.text,p.text_hash,p.published_at
      FROM family_memory_publications p WHERE NOT EXISTS
      (SELECT 1 FROM family_memory_withdrawals w WHERE w.publication_id=p.publication_id)
      ORDER BY p.published_at DESC,p.publication_id DESC LIMIT ?`).all(FAMILY_MEMORY_PROMPT_MAX_ITEMS) as
      Pick<Publication,'publication_id'|'owner_user_id'|'publisher_username'|'publisher_display_name'|'text'|'text_hash'|'published_at'>[];
    validate(); return value;
  })();
  for(const row of rows){
    validate();
    if(!uuid(row.publication_id)||!identifier(row.owner_user_id,128)||!identifier(row.publisher_username,64)
      ||!identifier(row.publisher_display_name,256)||deceptiveControls.test(row.owner_user_id+row.publisher_username+row.publisher_display_name)
      ||typeof row.text!=='string'||row.text.includes('\0')||!wellFormed(row.text)||Buffer.byteLength(row.text)>16384
      ||!digest(row.text_hash)||hash(row.text)!==row.text_hash
      ||!Number.isFinite(Date.parse(row.published_at))||new Date(row.published_at).toISOString()!==row.published_at)throw new ChatAccessDenied();
  }
  const entries:string[]=[];let bytes=0;
  for(const row of rows){
    validate();
    const entry=[`### Shared copy ${json(row.publication_id)}`,
      `Publisher snapshot: ${json({user_id:row.owner_user_id,username:row.publisher_username,display_name:row.publisher_display_name})}`,
      `Published at: ${json(row.published_at)}`,`Reference text (JSON string): ${json(row.text)}`].join('\n');
    const size=Buffer.byteLength(entry)+(entries.length?2:0);if(bytes+size>FAMILY_MEMORY_PROMPT_MAX_BYTES)break;
    entries.push(entry);bytes+=size;
  }
  validate();
  return entries.join('\n\n');
}

/** Exact owned text preview for a future confirmation UI. No mutation, source discovery or fallback. */
export function previewOwnFamilyMemorySource(database: Database, actor: AuthenticatedPrincipal, input: Source) {
  return database.transaction(() => {
    authority(database, actor, true); exact(input, ['chat_jid', 'message_rowid', 'message_id']);
    const preview = source(database, actor, input);
    authority(database, actor, true);
    return { ...input, ...preview };
  })();
}

/** Atomic explicit verbatim copy; no files, FTS, model, queue, timeline or notification writes. */
export function publishOwnFamilyMemory(database: Database, actor: AuthenticatedPrincipal, input: PublicationInput) {
  return database.transaction(() => {
    const user = authority(database, actor, true);
    exact(input, ['chat_jid', 'message_rowid', 'message_id', 'request_id', 'source_hash', 'text', 'confirm']);
    if (!uuid(input.request_id) || !digest(input.source_hash) || input.confirm !== true || typeof input.text !== 'string'
      || !input.text.trim() || input.text.includes('\0') || Buffer.byteLength(input.text) > 16384 || !wellFormed(input.text)) throw new ChatAccessDenied();
    const existing = database.query('SELECT publication_id FROM family_memory_publications WHERE owner_user_id=? AND request_id=?')
      .get(user.id, input.request_id) as { publication_id: string } | null;
    if (existing) {
      const row = find(database, existing.publication_id);
      if (row.owner_user_id !== user.id || row.source_chat_jid !== input.chat_jid || row.source_message_rowid !== input.message_rowid
        || row.source_message_id !== input.message_id || row.source_hash !== input.source_hash || row.text !== input.text
        || withdrawn(database, row.publication_id)) throw new ChatAccessDenied();
      authority(database, actor, true);
      return { publication_id: row.publication_id, created: false };
    }
    const preview = source(database, actor, input);
    if (preview.source_hash !== input.source_hash || !preview.text.includes(input.text)) throw new ChatAccessDenied();
    const counts = database.query(`SELECT count(*) total,coalesce(sum(owner_user_id=?),0) owned FROM family_memory_publications`)
      .get(user.id) as { total: number; owned: number };
    if (counts.owned >= 100 || counts.total >= 1000) throw new ChatAccessDenied();
    const id = randomUUID();
    database.query(`INSERT INTO family_memory_publications VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,user.id,input.request_id,
      actor.authentication.sessionId!,user.username,user.display_name,input.chat_jid,input.message_rowid,input.message_id,
      input.source_hash,input.text,hash(input.text),new Date().toISOString());
    authority(database, actor, true);
    return { publication_id: id, created: true };
  }).immediate();
}

/** Metadata-only complete bounded owner history for uncertain-response reconciliation. */
export function listOwnFamilyMemoryPublications(database: Database, actor: AuthenticatedPrincipal) {
  return database.transaction(() => {
    const user = authority(database, actor);
    const rows = database.query(`SELECT p.publication_id,p.request_id,p.published_at,
      EXISTS(SELECT 1 FROM family_memory_withdrawals w WHERE w.publication_id=p.publication_id) AS withdrawn
      FROM family_memory_publications p WHERE p.owner_user_id=? ORDER BY p.published_at DESC,p.publication_id DESC LIMIT 100`)
      .all(user.id) as { publication_id: string; request_id: string; published_at: string; withdrawn: number }[];
    authority(database, actor);
    return { owner_user_id: user.id, window_size: 100, items: rows.map(row => ({ ...row, withdrawn: Boolean(row.withdrawn) })) };
  })();
}

/** Historical owner receipt remains inspectable after source archival/deletion. */
export function readOwnFamilyMemoryPublication(database: Database, actor: AuthenticatedPrincipal, id: string) {
  return database.transaction(() => {
    const user = authority(database, actor), row = find(database, id);
    if (row.owner_user_id !== user.id) throw new ChatAccessDenied();
    const result = { ...shared(row), request_id: row.request_id, source: { chat_jid: row.source_chat_jid,
      message_rowid: row.source_message_rowid, message_id: row.source_message_id, source_hash: row.source_hash }, withdrawn: withdrawn(database, id) };
    authority(database, actor);
    return result;
  })();
}

/** Withdrawal affects future shared reads; it cannot retract prior copies or provider context. */
export function withdrawOwnFamilyMemory(database: Database, actor: AuthenticatedPrincipal, id: string, input: { confirm: true }) {
  return database.transaction(() => {
    const user = authority(database, actor, true); exact(input, ['confirm']);
    if (input.confirm !== true) throw new ChatAccessDenied();
    const row = find(database, id);
    if (row.owner_user_id !== user.id) throw new ChatAccessDenied();
    const created = !withdrawn(database, id);
    if (created) database.query('INSERT INTO family_memory_withdrawals VALUES (?,?,?,?)')
      .run(id,user.id,actor.authentication.sessionId!,new Date().toISOString());
    authority(database, actor, true);
    return { publication_id: id, withdrawn: true, created };
  }).immediate();
}

/** Bounded shared copy view, never private source IDs/hashes, login IDs, request IDs or attachments. */
export function listSharedFamilyMemory(database: Database, actor: AuthenticatedPrincipal) {
  return database.transaction(() => {
    authority(database, actor);
    const rows = database.query(`SELECT p.* FROM family_memory_publications p WHERE NOT EXISTS
      (SELECT 1 FROM family_memory_withdrawals w WHERE w.publication_id=p.publication_id)
      ORDER BY p.published_at DESC,p.publication_id DESC LIMIT 20`).all() as Publication[];
    for (const row of rows) if (hash(row.text) !== row.text_hash) throw new ChatAccessDenied();
    authority(database, actor);
    return { items: rows.map(shared), window_size: 20 };
  })();
}
