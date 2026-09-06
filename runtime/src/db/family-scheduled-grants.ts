import type Database from "bun:sqlite";
import type { AuthenticatedPrincipal } from "../core/access-types.js";
import type { FamilyToolPolicy } from "../core/family-tool-restrictions.js";
import { readAccessConfig } from "../core/config-access.js";
import { FAMILY_WEB_TOOLS, isFamilyWebToolAllowed } from "../core/family-workspace-policy.js";
import { hashCanonicalRequest } from "../service-effects/contracts/common.js";
import { decodeTaskSnapshot } from "../service-effects/current-piclaw/scheduled-run-values.js";
import type { ScheduledTask } from "../types.js";
import { createUuid } from "../utils/ids.js";
import { requireAccountActor } from "./account-administration.js";
import { readFamilyToolPolicy } from "./family-tool-restrictions.js";
import { ChatAccessDenied, resolveAuthorisedChat } from "./session-ownership.js";
import { createTask } from "./tasks.js";
import { getUser } from "./users.js";

interface GrantRow {
  id: string; task_id: string; task_revision: number; owner_user_id: string; initiated_by_user_id: string;
  execution_service: string; execution_kind: string; target_branch_id: string; root_branch_id: string; chat_jid: string;
  payload_hash: string; authority_hash: string; allowed_tools: string; login_session_id: string; created_at: string;
}

function tools(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > FAMILY_WEB_TOOLS.length || new Set(value).size !== value.length
    || value.some(name => typeof name !== "string" || !isFamilyWebToolAllowed(name))) throw new ChatAccessDenied();
  return FAMILY_WEB_TOOLS.filter(name => value.includes(name));
}

/** Includes actual payload: EF-S07's hash binds a payload reference, not the prompt bytes. */
function payloadHash(task: ScheduledTask): string {
  return hashCanonicalRequest({ id: task.id, revision: task.revision, chat_jid: task.chat_jid, prompt: task.prompt,
    model: task.model ?? null, task_kind: task.task_kind ?? null, command: task.command ?? null, cwd: task.cwd ?? null,
    timeout_sec: task.timeout_sec ?? null, notify_on_complete: task.notify_on_complete === false || task.notify_on_complete === 0 ? false : true,
    schedule_type: task.schedule_type, schedule_value: task.schedule_value, created_at: task.created_at });
}

function taskById(database: Database, id: string): ScheduledTask {
  const task = database.query("SELECT * FROM scheduled_tasks WHERE id=?").get(id) as ScheduledTask | null;
  if (!task) throw new ChatAccessDenied();
  return task;
}

/** Owner-only creation. No adoption of legacy tasks, caller IDs, model override or shell payload. */
export function createFamilyScheduledTask(database: Database, actor: AuthenticatedPrincipal, chatJid: string,
  input: { prompt: string; scheduled_for: string; allowed_tools: string[] }): { task_id: string; grant_id: string } {
  return database.transaction(() => {
    if (readAccessConfig().mode !== "family-shared") throw new ChatAccessDenied();
    const owner = requireAccountActor(database, actor, { recent: true });
    const target = resolveAuthorisedChat(database, actor, chatJid, "session.write");
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 3
      || Object.keys(input).some(key => !["prompt", "scheduled_for", "allowed_tools"].includes(key))
      || typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.includes("\0") || Buffer.byteLength(input.prompt, "utf8") > 100 * 1024
      || typeof input.scheduled_for !== "string") throw new ChatAccessDenied();
    const due = Date.parse(input.scheduled_for), now = Date.now();
    if (!Number.isFinite(due) || new Date(due).toISOString() !== input.scheduled_for || due <= now || due > now + 366 * 86400_000) throw new ChatAccessDenied();
    const allowed = tools(input.allowed_tools), policy = readFamilyToolPolicy(database, owner.id);
    if (allowed.some(name => !policy.allowed.includes(name))) throw new ChatAccessDenied();
    const branch = database.query("SELECT branch_id FROM chat_branches WHERE chat_jid=? AND handle_owner_id=?").get(target.chatJid, owner.id) as { branch_id: string } | null;
    if (!branch) throw new ChatAccessDenied();
    const taskId = createUuid("family-task"), grantId = createUuid("scheduled-grant"), createdAt = new Date(now).toISOString();
    createTask({ id: taskId, chat_jid: target.chatJid, prompt: input.prompt, model: null, task_kind: "agent", command: null, cwd: null,
      timeout_sec: null, notify_on_complete: false, schedule_type: "once", schedule_value: input.scheduled_for, next_run: input.scheduled_for,
      status: "paused", created_at: createdAt }, database);
    const task = taskById(database, taskId);
    const authority = database.query("SELECT config_hash FROM service_effect_s07_task_revisions WHERE task_id=? AND revision=1").get(taskId) as { config_hash: string };
    database.query(`INSERT INTO family_scheduled_grants(id,task_id,task_revision,owner_user_id,initiated_by_user_id,execution_service,execution_kind,
      target_branch_id,root_branch_id,chat_jid,payload_hash,authority_hash,allowed_tools,login_session_id,created_at)
      VALUES (?,?,1,?,?,'scheduler','scheduled',?,?,?,?,?,?,?,?)`).run(grantId, taskId, owner.id, owner.id, branch.branch_id, target.rootBranchId,
      target.chatJid, payloadHash(task), authority.config_hash, JSON.stringify(allowed), actor.authentication.sessionId!, createdAt);
    return { task_id: taskId, grant_id: grantId };
  }).immediate();
}

export function revokeFamilyScheduledGrant(database: Database, actor: AuthenticatedPrincipal, grantId: string): void {
  database.transaction(() => {
    if (readAccessConfig().mode !== "family-shared") throw new ChatAccessDenied();
    requireAccountActor(database, actor, { recent: true });
    const grant = database.query("SELECT id FROM family_scheduled_grants WHERE id=? AND owner_user_id=?").get(grantId, actor.userId);
    if (!grant) throw new ChatAccessDenied();
    database.query("INSERT OR IGNORE INTO family_scheduled_grant_revocations(grant_id,actor_user_id,reason,created_at) VALUES (?,?,'owner_revoked',?)")
      .run(grantId, actor.userId, new Date().toISOString());
  }).immediate();
}

/** Internal preflight only. Does not grant a due occurrence, lease, model run or result delivery. */
export function inspectFamilyScheduledGrant(database: Database, grantId: string): {
  grantId: string; taskId: string; ownerUserId: string; initiatedByUserId: string; service: "scheduler"; kind: "scheduled";
  chatJid: string; rootChatJid: string; prompt: string; scheduledFor: string; toolPolicy: FamilyToolPolicy;
} {
  return database.transaction(() => {
    if (readAccessConfig().mode !== "family-shared") throw new ChatAccessDenied();
    const grant = database.query(`SELECT * FROM family_scheduled_grants WHERE id=? AND NOT EXISTS
      (SELECT 1 FROM family_scheduled_grant_revocations WHERE grant_id=family_scheduled_grants.id)`).get(grantId) as GrantRow | null;
    if (!grant || grant.execution_service !== "scheduler" || grant.execution_kind !== "scheduled" || grant.task_revision !== 1
      || grant.owner_user_id !== grant.initiated_by_user_id) throw new ChatAccessDenied();
    const user = getUser(database, grant.owner_user_id);
    if (!user?.enabled) throw new ChatAccessDenied();
    const actor: AuthenticatedPrincipal = { kind: "user", userId: user.id, username: user.username, displayName: user.display_name,
      role: user.role, mode: "family-shared", homeChatJid: user.home_chat_jid, authentication: { method: "scheduled-preflight", sessionId: null, expiresAt: null } };
    const target = resolveAuthorisedChat(database, actor, grant.chat_jid, "session.write");
    const branch = database.query("SELECT branch_id FROM chat_branches WHERE chat_jid=? AND handle_owner_id=?").get(grant.chat_jid, user.id) as { branch_id: string } | null;
    if (target.rootBranchId !== grant.root_branch_id || branch?.branch_id !== grant.target_branch_id) throw new ChatAccessDenied();
    const task = taskById(database, grant.task_id);
    if (task.status !== "paused" || task.revision !== grant.task_revision || task.task_kind !== "agent" || task.schedule_type !== "once"
      || task.next_run !== task.schedule_value || task.last_run !== null || payloadHash(task) !== grant.payload_hash) throw new ChatAccessDenied();
    const head = database.query(`SELECT h.current_revision,h.status,h.next_run_at,r.config_hash,r.snapshot_json FROM service_effect_s07_tasks h
      JOIN service_effect_s07_task_revisions r ON r.task_id=h.task_id AND r.revision=h.current_revision WHERE h.task_id=?`).get(task.id) as
      { current_revision: number; status: string; next_run_at: string | null; config_hash: string; snapshot_json: string } | null;
    if (!head || head.current_revision !== grant.task_revision || head.status !== "paused" || head.next_run_at !== task.next_run
      || head.config_hash !== grant.authority_hash) throw new ChatAccessDenied();
    const snapshot = decodeTaskSnapshot(JSON.parse(head.snapshot_json));
    if (!snapshot || snapshot.configHash !== grant.authority_hash || snapshot.taskId !== task.id || snapshot.revision !== task.revision
      || snapshot.chatJid !== task.chat_jid || snapshot.payloadRef !== `scheduled_task:${task.id}:revision:${task.revision}`) throw new ChatAccessDenied();
    const ceiling = tools(JSON.parse(grant.allowed_tools)), live = readFamilyToolPolicy(database, user.id);
    const allowed = FAMILY_WEB_TOOLS.filter(name => ceiling.includes(name) && live.allowed.includes(name));
    return Object.freeze({ grantId: grant.id, taskId: task.id, ownerUserId: user.id, initiatedByUserId: grant.initiated_by_user_id,
      service: "scheduler" as const, kind: "scheduled" as const, chatJid: target.chatJid, rootChatJid: target.rootChatJid,
      prompt: task.prompt, scheduledFor: task.schedule_value,
      toolPolicy: Object.freeze({ revision: live.revision, allowed: Object.freeze(allowed), denied: Object.freeze(FAMILY_WEB_TOOLS.filter(name => !allowed.includes(name))) }) });
  })();
}
