import type Database from "bun:sqlite";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { FAMILY_WEB_TOOLS } from "../core/family-workspace-policy.js";
import { createUuid } from "../utils/ids.js";
import { inspectFamilyScheduledGrant } from "./family-scheduled-grants.js";
import { ChatAccessDenied } from "./session-ownership.js";

const LEASE_MS = 60_000;
const MAX = Number.MAX_SAFE_INTEGER;
type Grant = ReturnType<typeof inspectFamilyScheduledGrant>;
interface Occurrence {
  id: string; grant_id: string; task_id: string; owner_user_id: string; scheduled_for: string;
  state: "claimed" | "consumed"; attempt: number; version: number; worker_id: string;
  token_hash: string | null; first_claim_at: number; updated_at: number; lease_expires_at: number | null; allowed_tools: string;
}

/** The token is a short-lived internal capability. Never persist or expose it in a message/audit. */
export interface FamilyScheduledLease {
  readonly occurrence_id: string;
  readonly grant_id: string;
  /** Internal worker correlation label, not an authenticated user or independent authority. */
  readonly worker_id: string;
  readonly attempt: number;
  readonly version: number;
  readonly token: string;
}

function identifier(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9:_-]{1,128}$/.test(value)) throw new ChatAccessDenied();
}
function workerLabel(value: unknown): asserts value is string {
  // A complete 43-character token cannot be used accidentally as an audit label.
  if (typeof value !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(value)) throw new ChatAccessDenied();
}
function timestamp(): number {
  const now = Date.now();
  if (!Number.isSafeInteger(now) || now < 0 || now > MAX - LEASE_MS) throw new ChatAccessDenied();
  return now;
}
function tokenHash(token: string): string { return createHash("sha256").update(token).digest("hex"); }
function snapshotTools(row: Occurrence): string[] {
  const value: unknown = JSON.parse(row.allowed_tools);
  if (!Array.isArray(value) || value.length > FAMILY_WEB_TOOLS.length || new Set(value).size !== value.length
    || value.some(name => typeof name !== "string" || !(FAMILY_WEB_TOOLS as readonly string[]).includes(name))) throw new ChatAccessDenied();
  return FAMILY_WEB_TOOLS.filter(name => value.includes(name));
}

function readOccurrence(database: Database, grant: Grant, now: number): Occurrence | null {
  const row = database.query("SELECT * FROM family_scheduled_occurrences WHERE grant_id=?").get(grant.grantId) as Occurrence | null;
  if (!row) return null;
  identifier(row.id); workerLabel(row.worker_id);
  if (row.task_id !== grant.taskId || row.owner_user_id !== grant.ownerUserId || row.scheduled_for !== grant.scheduledFor
    || !Number.isSafeInteger(row.attempt) || row.attempt < 1 || !Number.isSafeInteger(row.version) || row.version < row.attempt
    || !Number.isSafeInteger(row.first_claim_at) || !Number.isSafeInteger(row.updated_at) || row.first_claim_at < Date.parse(grant.scheduledFor)
    || row.updated_at < row.first_claim_at || now < row.updated_at) throw new ChatAccessDenied();
  if (row.state === "claimed") {
    if (typeof row.token_hash !== "string" || !/^[a-f0-9]{64}$/.test(row.token_hash) || !Number.isSafeInteger(row.lease_expires_at)
      || row.lease_expires_at! <= row.updated_at || row.lease_expires_at! > row.updated_at + LEASE_MS) throw new ChatAccessDenied();
  } else if (row.state !== "consumed" || row.token_hash !== null || row.lease_expires_at !== null) throw new ChatAccessDenied();
  snapshotTools(row);
  const history = database.query(`SELECT count(*) n,min(version) first,max(version) last FROM family_scheduled_occurrence_events WHERE occurrence_id=?`).get(row.id) as { n: number; first: number; last: number };
  if (history.n !== row.version || history.first !== 1 || history.last !== row.version) throw new ChatAccessDenied();
  const event = database.query("SELECT * FROM family_scheduled_occurrence_events WHERE occurrence_id=? ORDER BY version DESC LIMIT 1").get(row.id) as
    { version: number; attempt: number; worker_id: string; kind: string; created_at: number } | null;
  if (!event || event.version !== row.version || event.attempt !== row.attempt || event.worker_id !== row.worker_id || event.created_at !== row.updated_at
    || (row.state === "consumed" ? event.kind !== "consume" : !["claim", "reclaim", "renew"].includes(event.kind))) throw new ChatAccessDenied();
  return row;
}

function audit(database: Database, row: Occurrence, kind: "claim" | "reclaim" | "renew" | "consume"): void {
  database.query("INSERT INTO family_scheduled_occurrence_events(occurrence_id,version,attempt,worker_id,kind,created_at) VALUES (?,?,?,?,?,?)")
    .run(row.id, row.version, row.attempt, row.worker_id, kind, row.updated_at);
}
function lease(row: Occurrence, token: string): FamilyScheduledLease {
  return Object.freeze({ occurrence_id: row.id, grant_id: row.grant_id, worker_id: row.worker_id, attempt: row.attempt, version: row.version, token });
}
function narrow(row: Occurrence, grant: Grant): string[] {
  return snapshotTools(row).filter(name => grant.toolPolicy.allowed.includes(name));
}

/** Read a terminal reservation with full live grant and audit validation; never authorises a model call. */
export function inspectConsumedFamilyScheduledOccurrence(database: Database, occurrenceId: string) {
  return database.transaction(() => {
    identifier(occurrenceId);
    const ref = database.query("SELECT grant_id FROM family_scheduled_occurrences WHERE id=?").get(occurrenceId) as { grant_id: string } | null;
    if (!ref) throw new ChatAccessDenied();
    const now = timestamp(), grant = inspectFamilyScheduledGrant(database, ref.grant_id), row = readOccurrence(database, grant, now);
    if (!row || row.state !== "consumed" || row.id !== occurrenceId) throw new ChatAccessDenied();
    return Object.freeze({ ...grant, occurrenceId: row.id, attempt: row.attempt, version: row.version, consumedAt: row.updated_at,
      allowedTools: Object.freeze(narrow(row, grant)) });
  })();
}

/** Trusted internal reservation API only. No user/transport route and no execution side effects. */
export function claimFamilyScheduledOccurrence(database: Database, grantId: string, workerId: string): FamilyScheduledLease {
  return database.transaction(() => {
    identifier(grantId); workerLabel(workerId);
    const now = timestamp(), grant = inspectFamilyScheduledGrant(database, grantId);
    if (Date.parse(grant.scheduledFor) > now) throw new ChatAccessDenied();
    const previous = readOccurrence(database, grant, now);
    if (previous && (previous.state !== "claimed" || previous.lease_expires_at! > now || previous.attempt >= MAX || previous.version >= MAX)) throw new ChatAccessDenied();
    const token = randomBytes(32).toString("base64url");
    const row: Occurrence = {
      id: previous?.id ?? createUuid("family-occurrence"), grant_id: grant.grantId, task_id: grant.taskId, owner_user_id: grant.ownerUserId,
      scheduled_for: grant.scheduledFor, state: "claimed", attempt: (previous?.attempt ?? 0) + 1, version: (previous?.version ?? 0) + 1,
      worker_id: workerId, token_hash: tokenHash(token), first_claim_at: previous?.first_claim_at ?? now, updated_at: now,
      lease_expires_at: now + LEASE_MS, allowed_tools: JSON.stringify(previous ? narrow(previous, grant) : grant.toolPolicy.allowed),
    };
    if (!previous) {
      database.query(`INSERT INTO family_scheduled_occurrences(id,grant_id,task_id,owner_user_id,scheduled_for,state,attempt,version,worker_id,
        token_hash,first_claim_at,updated_at,lease_expires_at,allowed_tools) VALUES (?,?,?,?,?,'claimed',?,?,?,?,?,?,?,?)`)
        .run(row.id,row.grant_id,row.task_id,row.owner_user_id,row.scheduled_for,row.attempt,row.version,row.worker_id,row.token_hash,row.first_claim_at,row.updated_at,row.lease_expires_at,row.allowed_tools);
    } else {
      const changed = database.query(`UPDATE family_scheduled_occurrences SET attempt=?,version=?,worker_id=?,token_hash=?,updated_at=?,lease_expires_at=?,allowed_tools=?
        WHERE id=? AND state='claimed' AND attempt=? AND version=? AND lease_expires_at<=?`)
        .run(row.attempt,row.version,row.worker_id,row.token_hash,now,row.lease_expires_at,row.allowed_tools,row.id,previous.attempt,previous.version,now);
      if (changed.changes !== 1) throw new ChatAccessDenied();
    }
    audit(database, row, previous ? "reclaim" : "claim");
    return lease(row, token);
  }).immediate();
}

function verify(database: Database, input: FamilyScheduledLease, now: number): { row: Occurrence; grant: Grant } {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 6
    || Object.keys(input).some(key => !["occurrence_id", "grant_id", "worker_id", "attempt", "version", "token"].includes(key))) throw new ChatAccessDenied();
  identifier(input.grant_id); identifier(input.occurrence_id); workerLabel(input.worker_id);
  if (typeof input.token !== "string" || !/^[a-zA-Z0-9_-]{43}$/.test(input.token)) throw new ChatAccessDenied();
  const grant = inspectFamilyScheduledGrant(database, input.grant_id), row = readOccurrence(database, grant, now);
  if (!row || row.id !== input.occurrence_id || row.worker_id !== input.worker_id || row.attempt !== input.attempt || row.version !== input.version
    || row.version >= MAX || row.state !== "claimed" || row.lease_expires_at! <= now
    || !timingSafeEqual(Buffer.from(row.token_hash!, "hex"), Buffer.from(tokenHash(input.token), "hex"))) throw new ChatAccessDenied();
  return { row, grant };
}

export function renewFamilyScheduledOccurrence(database: Database, input: FamilyScheduledLease): FamilyScheduledLease {
  return database.transaction(() => {
    const now = timestamp(), { row, grant } = verify(database, input, now), token = randomBytes(32).toString("base64url");
    const next: Occurrence = { ...row, version: row.version + 1, token_hash: tokenHash(token), updated_at: now,
      lease_expires_at: now + LEASE_MS, allowed_tools: JSON.stringify(narrow(row, grant)) };
    const changed = database.query(`UPDATE family_scheduled_occurrences SET version=?,token_hash=?,updated_at=?,lease_expires_at=?,allowed_tools=?
      WHERE id=? AND state='claimed' AND attempt=? AND version=? AND worker_id=? AND token_hash=? AND lease_expires_at>?`)
      .run(next.version,next.token_hash,now,next.lease_expires_at,next.allowed_tools,row.id,row.attempt,row.version,row.worker_id,row.token_hash,now);
    if (changed.changes !== 1) throw new ChatAccessDenied();
    audit(database, next, "renew");
    return lease(next, token);
  }).immediate();
}

/** Terminal reservation consumption, not model execution. No retry after uncertain delivery of this result. */
export function consumeFamilyScheduledOccurrence(database: Database, input: FamilyScheduledLease) {
  return database.transaction(() => {
    const now = timestamp(), { row, grant } = verify(database, input, now), allowed = narrow(row, grant);
    const next: Occurrence = { ...row, state: "consumed", version: row.version + 1, token_hash: null, lease_expires_at: null,
      updated_at: now, allowed_tools: JSON.stringify(allowed) };
    const changed = database.query(`UPDATE family_scheduled_occurrences SET state='consumed',version=?,token_hash=NULL,lease_expires_at=NULL,updated_at=?,allowed_tools=?
      WHERE id=? AND state='claimed' AND attempt=? AND version=? AND worker_id=? AND token_hash=? AND lease_expires_at>?`)
      .run(next.version,now,next.allowed_tools,row.id,row.attempt,row.version,row.worker_id,row.token_hash,now);
    if (changed.changes !== 1) throw new ChatAccessDenied();
    audit(database, next, "consume");
    return Object.freeze({ occurrenceId: row.id, attempt: row.attempt, grantId: grant.grantId, taskId: grant.taskId,
      ownerUserId: grant.ownerUserId, initiatedByUserId: grant.initiatedByUserId, service: grant.service, kind: grant.kind,
      chatJid: grant.chatJid, rootChatJid: grant.rootChatJid, prompt: grant.prompt,
      toolPolicy: Object.freeze({ revision: grant.toolPolicy.revision, allowed: Object.freeze(allowed),
        denied: Object.freeze(FAMILY_WEB_TOOLS.filter(name => !allowed.includes(name))) }) });
  }).immediate();
}
