import type { Database } from "bun:sqlite";
import { admitSqliteWrite } from "../db/sqlite-async-admission.js";
/** Generic, durable local dispatch provenance. Not a review store or execution policy bypass. */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { getDb } from "../db/connection.js";
import { readAccessConfig } from "../core/config-access.js";

const TYPE = "addon_local_dispatch";
const ADDON_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,63})$/;
const INTENT_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

export interface AddonLocalAuthorityReference {
  readonly addonId: string;
  readonly intentId: string;
}

interface Dispatch {
  id: string;
  chatJid: string;
  incarnation: string;
  digest: string;
  reference?: AddonLocalAuthorityReference;
  admission?: { validate: () => void; signal?: AbortSignal };
}

const dispatchScope = new AsyncLocalStorage<Dispatch>();
const requests = new WeakMap<Request, Dispatch>();
const digest = (content: string) => createHash("sha256").update(content).digest("hex");

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseAddonLocalAuthorityReference(value: unknown): AddonLocalAuthorityReference | null {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Authority reference must be an object.");
  const addonId = text((value as { addonId?: unknown }).addonId);
  const intentId = text((value as { intentId?: unknown }).intentId);
  if (!ADDON_ID_PATTERN.test(addonId) || Buffer.byteLength(addonId) > 64) {
    throw new Error("Authority reference addonId is invalid.");
  }
  if (!INTENT_ID_PATTERN.test(intentId) || Buffer.byteLength(intentId) > 128) {
    throw new Error("Authority reference intentId is invalid.");
  }
  return Object.freeze({ addonId, intentId });
}

function database() {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS addon_local_dispatch_authorities (
    id TEXT PRIMARY KEY, chat_jid TEXT NOT NULL, incarnation TEXT NOT NULL,
    content_sha256 TEXT NOT NULL, message_id TEXT, addon_id TEXT, intent_id TEXT,
    created_at TEXT NOT NULL
  ) STRICT`);
  const columns = new Set(
    (db.query(`PRAGMA table_info(addon_local_dispatch_authorities)`).all() as Array<{ name: string }>).map((row) => row.name),
  );
  if (!columns.has("addon_id")) {
    db.exec(`ALTER TABLE addon_local_dispatch_authorities ADD COLUMN addon_id TEXT`);
    columns.add("addon_id");
  }
  if (!columns.has("intent_id")) db.exec(`ALTER TABLE addon_local_dispatch_authorities ADD COLUMN intent_id TEXT`);
  return db;
}

function storedReference(row: { addon_id: string | null; intent_id: string | null }): AddonLocalAuthorityReference | undefined {
  if (row.addon_id === null && row.intent_id === null) return undefined;
  const reference = parseAddonLocalAuthorityReference({ addonId: row.addon_id, intentId: row.intent_id });
  return reference ?? undefined;
}

/** Called by the localContext operator-only queue method, never with wire metadata. */
export function withAddonLocalDispatch<T>(target: { chatJid: string; incarnation: string }, content: string, run: () => Promise<T>): Promise<T>;
export function withAddonLocalDispatch<T>(target: { chatJid: string; incarnation: string }, content: string, reference: AddonLocalAuthorityReference | null, run: () => Promise<T>): Promise<T>;
export function withAddonLocalDispatch<T>(target: { chatJid: string; incarnation: string }, content: string, reference: AddonLocalAuthorityReference | null, run: () => Promise<T>, admission: { validate: () => void; signal?: AbortSignal }): Promise<T>;
export async function withAddonLocalDispatch<T>(
  target: { chatJid: string; incarnation: string },
  content: string,
  referenceOrRun: AddonLocalAuthorityReference | null | (() => Promise<T>),
  maybeRun?: () => Promise<T>,
  admission?: { validate: () => void; signal?: AbortSignal },
): Promise<T> {
  const run = typeof referenceOrRun === "function" ? referenceOrRun : maybeRun;
  if (typeof run !== "function") throw new Error("Addon local dispatch requires a callback.");
  const reference = typeof referenceOrRun === "function" ? null : parseAddonLocalAuthorityReference(referenceOrRun);
  admission?.validate();
  const dispatch: Dispatch = { id: randomUUID(), ...target, digest: digest(content), ...(reference ? { reference } : {}), ...(admission ? { admission } : {}) };
  const db = getDb();
  await admitSqliteWrite(db, () => {
  database().query(`
    INSERT INTO addon_local_dispatch_authorities(
      id, chat_jid, incarnation, content_sha256, message_id, addon_id, intent_id, created_at
    ) VALUES(?,?,?,?,NULL,?,?,?)
  `).run(
    dispatch.id,
    target.chatJid,
    target.incarnation,
    dispatch.digest,
    dispatch.reference?.addonId ?? null,
    dispatch.reference?.intentId ?? null,
    new Date().toISOString(),
  );
  }, () => {
    if (getDb() !== db) throw Error("Local dispatch database changed");
    admission?.validate();
  }, admission?.signal);
  return dispatchScope.run(dispatch, run);
}

/** Fresh scope authority is separate from durable provenance blocks. */
export function captureAddonLocalDispatchAdmission(chatJid: string, content: string): { validate: () => void; signal?: AbortSignal } | null {
  const dispatch = dispatchScope.getStore();
  if (!dispatch) return null;
  if (dispatch.chatJid !== chatJid || dispatch.digest !== digest(content) || !dispatch.admission) throw Error('Local dispatch admission mismatch.');
  dispatch.admission.validate();
  return dispatch.admission;
}

/** Internal enqueue bridge brands its actual Request rather than serialising an authority field. */
export function bindAddonLocalDispatchRequest(req: Request, chatJid: string, content: string): void {
  const dispatch = dispatchScope.getStore();
  if (dispatch?.chatJid === chatJid && dispatch.digest === digest(content)) requests.set(req, dispatch);
}

/** Called after public content-block sanitisation, never trusts body-supplied metadata. */
export function getAddonLocalDispatchBlock(req: Request, chatJid: string, content: string): Record<string, unknown> | null {
  const dispatch = requests.get(req);
  requests.delete(req);
  if (!dispatch || dispatch.chatJid !== chatJid || dispatch.digest !== digest(content)) return null;
  return { type: TYPE, dispatch_id: dispatch.id };
}

type LocalMessage = { id?: string; content?: string; content_blocks?: unknown[] };
type LocalProof = { incarnation: string; reference?: AddonLocalAuthorityReference };
type DispatchRow = { id: string; chat_jid: string; incarnation: string; content_sha256: string; message_id: string | null; addon_id?: string | null; intent_id?: string | null };

function localCandidate(db: Database, chatJid: string, message: LocalMessage): { row: DispatchRow; proof: LocalProof } | null {
  if (readAccessConfig().mode !== "single-user" || typeof message.id !== "string" || !message.id) return null;
  const blocks = Array.isArray(message.content_blocks) ? message.content_blocks : [];
  if (blocks.some(b => b && typeof b === "object" && (b as { type?: string }).type === "peer_message")) return null;
  const marks = blocks.filter(b => b && typeof b === "object" && (b as { type?: string }).type === TYPE) as { dispatch_id?: unknown }[];
  if (marks.length !== 1 || typeof marks[0]?.dispatch_id !== "string") return null;
  // Verification never creates/migrates a schema for an untrusted marker.
  if (!(db.query("PRAGMA table_info(addon_local_dispatch_authorities)").all()).length) return null;
  const row = db.query("SELECT * FROM addon_local_dispatch_authorities WHERE id=?").get(marks[0].dispatch_id) as DispatchRow | null;
  if (!row || row.chat_jid !== chatJid || row.content_sha256 !== digest(message.content ?? "") ||
    (row.message_id !== null && row.message_id !== message.id)) return null;
  let reference: AddonLocalAuthorityReference | undefined;
  try { reference = storedReference({ addon_id: row.addon_id ?? null, intent_id: row.intent_id ?? null }); } catch { return null; }
  return { row, proof: { incarnation: row.incarnation, ...(reference ? { reference } : {}) } };
}

/** Bind only inside the actual message transaction. Existing exact bindings are reads. */
export function bindAddonLocalMessage(chatJid: string, message: LocalMessage, db: Database = getDb()): LocalProof | null {
  const candidate = localCandidate(db, chatJid, message);
  if (!candidate) return null;
  if (candidate.row.message_id === message.id) return candidate.proof;
  if (!db.inTransaction) throw Error("Local message binding requires its message transaction");
  db.query("UPDATE addon_local_dispatch_authorities SET message_id=? WHERE id=? AND message_id IS NULL").run(message.id!, candidate.row.id);
  return candidate.proof;
}

/** Retained/unbound legacy markers reconcile once; normal prompt reads take no writer. */
export async function verifyAddonLocalMessage(chatJid: string, message: LocalMessage): Promise<LocalProof | null> {
  const captured: LocalMessage = { id: message.id, content: message.content, content_blocks: structuredClone(message.content_blocks) };
  const db = getDb(), candidate = localCandidate(db, chatJid, captured);
  if (!candidate || candidate.row.message_id === captured.id) return candidate?.proof ?? null;
  return admitSqliteWrite(db, () => bindAddonLocalMessage(chatJid, captured, db), () => {
    if (getDb() !== db) throw Error("Local dispatch database changed");
  });
}
