import type Database from "bun:sqlite";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AuthenticatedPrincipal } from "../core/access-types.js";
import { readAccessConfig } from "../core/config-access.js";
import { FAMILY_WEB_TOOLS } from "../core/family-workspace-policy.js";
import { createUuid } from "../utils/ids.js";
import { requireAccountActor } from "./account-administration.js";
import { consumeFamilyScheduledOccurrence, inspectConsumedFamilyScheduledOccurrence, type FamilyScheduledLease } from "./family-scheduled-occurrences.js";
import { ChatAccessDenied, resolveAuthorisedChat } from "./session-ownership.js";
import { getUser } from "./users.js";
import { readAccountPreferences } from "./account-preferences.js";
import { readAccountModelDefaults } from "./account-model-defaults.js";
import type { ExecutionIdentity } from "../core/execution-context.js";

const TTL = 15 * 60_000;
interface Execution {
  id: string; occurrence_id: string; grant_id: string; task_id: string; attempt: number; occurrence_version: number;
  owner_user_id: string; initiated_by_user_id: string; execution_service: string; chat_jid: string; root_chat_jid: string;
  target_branch_id: string; root_branch_id: string;
  owner_username: string; owner_display_name: string; prompt_hash: string; allowed_tools: string; settlement_token_hash: string;
  created_at: number; expires_at: number;
}
interface ResultRow { execution_id: string; status: "success" | "error"; text: string; payload_hash: string; created_at: number }
export interface FamilySettlementCapability { readonly execution_id: string; readonly token: string }
export interface FamilyScheduledResultInput { status: "success" | "error"; text: string }

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function now(): number {
  if (readAccessConfig().mode !== "family-shared") throw new ChatAccessDenied();
  const value = Date.now();
  if (!Number.isSafeInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER - TTL) throw new ChatAccessDenied();
  return value;
}
function exact(input: unknown, fields: string[]): asserts input is Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || Reflect.ownKeys(input).length !== fields.length
    || Reflect.ownKeys(input).some(key => typeof key !== "string" || !fields.includes(key) || !("value" in Object.getOwnPropertyDescriptor(input, key)!))) throw new ChatAccessDenied();
}
function identifier(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new ChatAccessDenied();
}
function resultHash(value: FamilyScheduledResultInput): string {
  exact(value, ["status", "text"]);
  if (!["success", "error"].includes(value.status) || typeof value.text !== "string" || value.text.includes("\0")
    || Buffer.byteLength(value.text, "utf8") > 100 * 1024) throw new ChatAccessDenied();
  return hash(JSON.stringify([value.status, value.text]));
}
function allowedTools(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || new Set(parsed).size !== parsed.length || parsed.some(name => !(FAMILY_WEB_TOOLS as readonly unknown[]).includes(name))) throw new ChatAccessDenied();
  return FAMILY_WEB_TOOLS.filter(name => parsed.includes(name));
}
function execution(database: Database, id: string, at: number): Execution {
  identifier(id);
  const row = database.query("SELECT * FROM family_scheduled_executions WHERE id=?").get(id) as Execution | null;
  if (!row || row.execution_service !== "scheduler" || row.owner_user_id !== row.initiated_by_user_id
    || !Number.isSafeInteger(row.created_at) || row.created_at < 0 || at < row.created_at || row.expires_at !== row.created_at + TTL
    || !/^[a-f0-9]{64}$/.test(row.settlement_token_hash) || !/^[a-f0-9]{64}$/.test(row.prompt_hash)) throw new ChatAccessDenied();
  allowedTools(row.allowed_tools);
  const event = database.query("SELECT created_at FROM family_scheduled_execution_events WHERE execution_id=? AND kind='begin'").get(id) as { created_at: number } | null;
  if (event?.created_at !== row.created_at) throw new ChatAccessDenied();
  return row;
}

/** Consume the lease and bind an execution record in the same transaction. Never invokes a model. */
export function beginFamilyScheduledExecution(database: Database, lease: FamilyScheduledLease): FamilySettlementCapability {
  return database.transaction(() => {
    now();
    const consumed = consumeFamilyScheduledOccurrence(database, lease);
    const verified = inspectConsumedFamilyScheduledOccurrence(database, consumed.occurrenceId), owner = getUser(database, consumed.ownerUserId)!;
    const at = verified.consumedAt;
    const branches = database.query("SELECT target_branch_id,root_branch_id FROM family_scheduled_grants WHERE id=?").get(verified.grantId) as { target_branch_id: string; root_branch_id: string };
    const id = createUuid("family-execution"), token = randomBytes(32).toString("base64url");
    database.query(`INSERT INTO family_scheduled_executions(id,occurrence_id,grant_id,task_id,attempt,occurrence_version,
      owner_user_id,initiated_by_user_id,execution_service,chat_jid,root_chat_jid,owner_username,owner_display_name,prompt_hash,
      allowed_tools,settlement_token_hash,created_at,expires_at,target_branch_id,root_branch_id) VALUES (?,?,?,?,?,?,?,?,'scheduler',?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id,verified.occurrenceId,verified.grantId,verified.taskId,verified.attempt,verified.version,verified.ownerUserId,verified.initiatedByUserId,
        verified.chatJid,verified.rootChatJid,owner.username,owner.display_name,hash(verified.prompt),JSON.stringify(verified.allowedTools),hash(token),at,at+TTL,branches.target_branch_id,branches.root_branch_id);
    database.query("INSERT INTO family_scheduled_execution_events VALUES (?,'begin',?)").run(id,at);
    return Object.freeze({ execution_id: id, token });
  }).immediate();
}

/** Durable result settlement only. Exact retries acknowledge the existing row; no external delivery. */
export function settleFamilyScheduledExecution(database: Database, capability: FamilySettlementCapability, input: FamilyScheduledResultInput) {
  return database.transaction(() => {
    const at = now(), { row } = validateCapability(database, capability, at);
    const payloadHash = resultHash(input);
    const existing = result(database,row);
    if (existing) {
      if (existing.payload_hash !== payloadHash || existing.status !== input.status || existing.text !== input.text) throw new ChatAccessDenied();
      return { execution_id: row.id, created: false };
    }
    database.query("INSERT INTO family_scheduled_results(execution_id,status,text,payload_hash,created_at) VALUES (?,?,?,?,?)")
      .run(row.id,input.status,input.text,payloadHash,at);
    database.query("INSERT INTO family_scheduled_execution_events VALUES (?,'settle',?)").run(row.id,at);
    return { execution_id: row.id, created: true };
  }).immediate();
}

function validateCapability(database: Database, capability: FamilySettlementCapability, at: number) {
    exact(capability, ["execution_id", "token"]);
    if (typeof capability.token !== "string" || !/^[\w-]{43}$/.test(capability.token)) throw new ChatAccessDenied();
    const row = execution(database, capability.execution_id, at);
    if (at >= row.expires_at || !timingSafeEqual(Buffer.from(hash(capability.token), "hex"),Buffer.from(row.settlement_token_hash,"hex"))) throw new ChatAccessDenied();
    const current = inspectConsumedFamilyScheduledOccurrence(database,row.occurrence_id);
    const branches = database.query("SELECT target_branch_id,root_branch_id FROM family_scheduled_grants WHERE id=?").get(row.grant_id) as { target_branch_id: string; root_branch_id: string } | null;
    if (current.grantId !== row.grant_id || current.taskId !== row.task_id || current.attempt !== row.attempt || current.version !== row.occurrence_version
      || current.ownerUserId !== row.owner_user_id || current.initiatedByUserId !== row.initiated_by_user_id || current.chatJid !== row.chat_jid
      || current.rootChatJid !== row.root_chat_jid || current.consumedAt !== row.created_at || hash(current.prompt) !== row.prompt_hash
      || branches?.target_branch_id !== row.target_branch_id || branches.root_branch_id !== row.root_branch_id
      || allowedTools(row.allowed_tools).some(name => !current.allowedTools.includes(name))) throw new ChatAccessDenied();
    return { row, current };
}

/** Trusted dispatcher preflight/revalidation; the raw token never enters execution identity. */
export function readFamilyScheduledDispatch(database: Database, capability: FamilySettlementCapability) {
  return database.transaction(() => {
    const { row, current } = validateCapability(database,capability,now());
    if (result(database,row)) throw new ChatAccessDenied();
    const user=getUser(database,row.owner_user_id)!;
    const allowed=Object.freeze(allowedTools(row.allowed_tools));
    const identity: ExecutionIdentity=Object.freeze({
      mode:"family-shared",username:user.username,displayName:user.display_name,role:user.role,rootChatJid:current.rootChatJid,
      provenance:Object.freeze({actorUserId:user.id,ownerUserId:user.id,chatJid:current.chatJid,kind:"scheduled",executionId:row.id}),
      toolPolicy:Object.freeze({revision:current.toolPolicy.revision,allowed,denied:Object.freeze(FAMILY_WEB_TOOLS.filter(name=>!allowed.includes(name)))}),
      preferences:readAccountPreferences(database,user.id),modelDefaults:readAccountModelDefaults(database,user.id),
    });
    return Object.freeze({identity,prompt:current.prompt,expiresAt:row.expires_at});
  })();
}

/** Atomic one-time admission, before hydration. A started execution is never implicitly retried. */
export function startFamilyScheduledDispatch(database: Database, capability: FamilySettlementCapability) {
  return database.transaction(() => {
    const descriptor=readFamilyScheduledDispatch(database,capability);
    database.query("INSERT INTO family_scheduled_dispatches(execution_id,started_at) VALUES (?,?)").run(capability.execution_id,now());
    return descriptor;
  }).immediate();
}

function result(database: Database, row: Execution): ResultRow | null {
  const value = database.query("SELECT * FROM family_scheduled_results WHERE execution_id=?").get(row.id) as ResultRow | null;
  const event = database.query("SELECT created_at FROM family_scheduled_execution_events WHERE execution_id=? AND kind='settle'").get(row.id) as { created_at: number } | null;
  if (!value) { if (event) throw new ChatAccessDenied(); return null; }
  if (!Number.isSafeInteger(value.created_at) || value.created_at < row.created_at || value.created_at >= row.expires_at || event?.created_at !== value.created_at
    || value.payload_hash !== resultHash({ status: value.status, text: value.text })) throw new ChatAccessDenied();
  return value;
}

/** Live owner-only retrieval, including historic results after grant revocation. No token is returned. */
export function readOwnFamilyScheduledResult(database: Database, actor: AuthenticatedPrincipal, executionId: string) {
  return database.transaction(() => {
    const at = now(); requireAccountActor(database,actor);
    identifier(executionId);
    if (!database.query("SELECT 1 FROM family_scheduled_executions WHERE id=? AND owner_user_id=?").get(executionId,actor.userId)) throw new ChatAccessDenied();
    const row = execution(database,executionId,at), target = resolveAuthorisedChat(database,actor,row.chat_jid,"session.read");
    const binding = database.query(`SELECT g.root_branch_id,g.target_branch_id,b.branch_id FROM family_scheduled_grants g
      JOIN chat_branches b ON b.chat_jid=g.chat_jid WHERE g.id=? AND g.owner_user_id=? AND g.chat_jid=?`).get(row.grant_id,actor.userId,row.chat_jid) as
      { root_branch_id: string; target_branch_id: string; branch_id: string } | null;
    if (target.rootChatJid !== row.root_chat_jid || target.rootBranchId !== row.root_branch_id || binding?.root_branch_id !== row.root_branch_id
      || binding.target_branch_id !== row.target_branch_id || binding.branch_id !== row.target_branch_id) throw new ChatAccessDenied();
    const stored = result(database,row);
    if (stored && stored.created_at > at) throw new ChatAccessDenied();
    return { execution_id: row.id, chat_jid: target.chatJid, owner_user_id: row.owner_user_id,
      initiated_by_user_id: row.initiated_by_user_id, service: "scheduler" as const,
      owner_username: row.owner_username, owner_display_name: row.owner_display_name,
      publication_recorded: Boolean(database.query("SELECT 1 FROM family_scheduled_publications WHERE execution_id=?").get(row.id)),
      state: stored ? "settled" as const : at >= row.expires_at ? "expired-unsettled" as const : "unsettled" as const,
      result: stored ? { status: stored.status, text: stored.text, created_at: stored.created_at } : null };
  })();
}

/** Metadata only, limited before per-target validation; never read another owner's result payload. */
export function listOwnFamilyScheduledResults(database: Database, actor: AuthenticatedPrincipal) {
  return database.transaction(() => {
    const at = now(); requireAccountActor(database, actor);
    const rows = database.query(`SELECT e.id,e.chat_jid,e.root_chat_jid,e.target_branch_id,e.root_branch_id,e.created_at,e.expires_at,
      g.target_branch_id AS grant_target,g.root_branch_id AS grant_root,b.branch_id AS current_branch,
      EXISTS(SELECT 1 FROM family_scheduled_results r WHERE r.execution_id=e.id) AS settled,
      EXISTS(SELECT 1 FROM family_scheduled_publications p WHERE p.execution_id=e.id) AS published
      FROM family_scheduled_executions e
      LEFT JOIN family_scheduled_grants g ON g.id=e.grant_id AND g.owner_user_id=e.owner_user_id AND g.chat_jid=e.chat_jid
      LEFT JOIN chat_branches b ON b.chat_jid=e.chat_jid
      WHERE e.owner_user_id=? ORDER BY e.created_at DESC,e.id DESC LIMIT 50`).all(actor.userId) as Array<{
        id:string;chat_jid:string;root_chat_jid:string;target_branch_id:string;root_branch_id:string;created_at:number;expires_at:number;
        grant_target:string|null;grant_root:string|null;current_branch:string|null;settled:number;published:number;
      }>;
    const items = rows.flatMap(row => {
      try {
        identifier(row.id);
        const target=resolveAuthorisedChat(database,actor,row.chat_jid,"session.read");
        if (target.rootChatJid!==row.root_chat_jid || target.rootBranchId!==row.root_branch_id || row.grant_root!==row.root_branch_id
          || row.grant_target!==row.target_branch_id || row.current_branch!==row.target_branch_id
          || !Number.isSafeInteger(row.created_at) || row.created_at<0 || row.created_at>at || row.expires_at!==row.created_at+TTL) throw new ChatAccessDenied();
        return [{execution_id:row.id,chat_jid:row.chat_jid,created_at:row.created_at,
          state:row.settled?"settled":at>=row.expires_at?"expired-unsettled":"unsettled",publication_recorded:row.published===1}];
      } catch(error) { if(error instanceof ChatAccessDenied)return []; throw error; }
    });
    return { owner_user_id:actor.userId,window_size:50,items };
  })();
}
