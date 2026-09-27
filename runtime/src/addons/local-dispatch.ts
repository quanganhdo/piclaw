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
export async function withAddonLocalDispatch<T>(
  target: { chatJid: string; incarnation: string },
  content: string,
  referenceOrRun: AddonLocalAuthorityReference | null | (() => Promise<T>),
  maybeRun?: () => Promise<T>,
): Promise<T> {
  const run = typeof referenceOrRun === "function" ? referenceOrRun : maybeRun;
  if (typeof run !== "function") throw new Error("Addon local dispatch requires a callback.");
  const reference = typeof referenceOrRun === "function" ? null : parseAddonLocalAuthorityReference(referenceOrRun);
  const dispatch: Dispatch = { id: randomUUID(), ...target, digest: digest(content), ...(reference ? { reference } : {}) };
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
  return dispatchScope.run(dispatch, run);
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

/** Replay is bound to one persisted message ID; queue restart preserves the original marker. */
export function verifyAddonLocalMessage(chatJid: string, message: {
  id?: string; content?: string; content_blocks?: unknown[];
}): { incarnation: string; reference?: AddonLocalAuthorityReference } | null {
  if (readAccessConfig().mode !== "single-user" || !message.id) return null;
  const blocks = Array.isArray(message.content_blocks) ? message.content_blocks : [];
  if (blocks.some((b) => b && typeof b === "object" && (b as { type?: string }).type === "peer_message")) return null;
  const marks = blocks.filter((b) => b && typeof b === "object" && (b as { type?: string }).type === TYPE) as Array<{ dispatch_id?: unknown }>;
  if (marks.length !== 1 || typeof marks[0]?.dispatch_id !== "string") return null;
  const db = database();
  const record = db.transaction(() => {
    const row = db.query(`SELECT * FROM addon_local_dispatch_authorities WHERE id=?`).get(marks[0]!.dispatch_id as string) as {
      id: string;
      chat_jid: string;
      incarnation: string;
      content_sha256: string;
      message_id: string | null;
      addon_id: string | null;
      intent_id: string | null;
    } | null;
    if (
      !row ||
      row.chat_jid !== chatJid ||
      row.content_sha256 !== digest(message.content ?? "") ||
      (row.message_id !== null && row.message_id !== message.id)
    ) return null;
    let reference: AddonLocalAuthorityReference | undefined;
    try {
      reference = storedReference(row);
    } catch {
      return null;
    }
    db.query(`UPDATE addon_local_dispatch_authorities SET message_id=? WHERE id=? AND message_id IS NULL`).run(message.id!, row.id);
    return { incarnation: row.incarnation, ...(reference ? { reference } : {}) };
  }).immediate();
  return record ?? null;
}
