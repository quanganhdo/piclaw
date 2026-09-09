import type Database from "bun:sqlite";

import { createUuid } from "../utils/ids.js";
import { resolveCalendarWindow } from "../budget/calendar.js";
import { getProviderBudgetCapability } from "../budget/provider-evidence.js";
import type { BudgetCap, BudgetCapInput, BudgetDecision, BudgetExecutionKind, BudgetUsageAttribution, BudgetWorkStatus } from "../budget/types.js";
import { getDb } from "./connection.js";

export interface BudgetWorkRecord {
  id: string;
  chat_jid: string;
  execution_kind: BudgetExecutionKind;
  parent_work_id: string | null;
  scheduled_task_id: string | null;
  status: BudgetWorkStatus;
  blocking_json: string | null;
  last_boundary: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface BudgetUsageEventInput extends BudgetUsageAttribution {
  tokenUsageId: number;
  chatJid: string;
  accountedAt: string;
  apiUsdMicros: number | null;
  apiUsdKnown: boolean;
  valuationProvenance: "catalogue_estimate" | "documented_free" | "unavailable";
  usageSource: string;
}

export interface BudgetCapWindowRecord {
  cap_id: string;
  cap_revision: number;
  window_id: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  created_at: string;
}

function validateCapInput(input: BudgetCapInput): void {
  if (!Number.isSafeInteger(input.amount) || input.amount < 0) {
    throw new Error("Budget cap amount must be a finite non-negative integer in millionths");
  }
  const dollarScope = input.scope === "task" || input.scope === "scheduled_run"
    || input.scope === "instance_daily" || input.scope === "instance_monthly";
  if (dollarScope && input.metric !== "api_usd_micros") {
    throw new Error(`Budget metric ${input.metric} is unsupported for ${input.scope}`);
  }
  if (input.scope === "provider_window" && input.metric === "api_usd_micros") {
    throw new Error("API-equivalent dollar caps use task, scheduled-run, daily or monthly scope");
  }
  if (input.scope === "task" && !input.workId?.trim()) throw new Error("Task caps require workId");
  if (input.scope === "scheduled_run" && !input.scheduledTaskId?.trim()) throw new Error("Scheduled-run caps require scheduledTaskId");
  if ((input.scope === "instance_daily" || input.scope === "instance_monthly") && !input.timezone?.trim()) {
    throw new Error("Instance calendar caps require an IANA timezone");
  }
  if (input.scope === "provider_window") {
    if (!input.providerId?.trim() || !input.quotaDimension?.trim() || !input.accountRef?.trim()) {
      throw new Error("Provider-window caps require providerId, quotaDimension and accountRef");
    }
    const capability = getProviderBudgetCapability(input.providerId!);
    if (!capability || !capability.dimensions.includes(input.quotaDimension!)) {
      throw new Error(`Provider ${input.providerId} does not support quota dimension ${input.quotaDimension}`);
    }
  }
}

export function saveBudgetCap(input: BudgetCapInput, database: Database = getDb(), nowInput: Date = new Date()): BudgetCap {
  validateCapInput(input);
  const now = nowInput.toISOString();
  const id = input.id?.trim() || createUuid("budget-cap");
  return database.transaction(() => {
    const prior = database.prepare("SELECT * FROM budget_caps WHERE id=?").get(id) as BudgetCap | undefined;
    const revision = prior ? prior.revision + 1 : 1;
    database.prepare(`INSERT INTO budget_caps (
      id,scope,metric,amount,enabled,work_id,scheduled_task_id,provider_id,quota_dimension,account_ref,timezone,revision,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      scope=excluded.scope,metric=excluded.metric,amount=excluded.amount,enabled=excluded.enabled,
      work_id=excluded.work_id,scheduled_task_id=excluded.scheduled_task_id,provider_id=excluded.provider_id,
      quota_dimension=excluded.quota_dimension,account_ref=excluded.account_ref,timezone=excluded.timezone,
      revision=excluded.revision,updated_at=excluded.updated_at`).run(
      id,
      input.scope,
      input.metric,
      input.amount,
      input.enabled === false ? 0 : 1,
      input.workId?.trim() || null,
      input.scheduledTaskId?.trim() || null,
      input.providerId?.trim() || null,
      input.quotaDimension?.trim() || null,
      input.accountRef?.trim() || null,
      input.timezone?.trim() || null,
      revision,
      prior?.created_at ?? now,
      now,
    );
    const cap = database.prepare("SELECT * FROM budget_caps WHERE id=?").get(id) as BudgetCap;
    if (cap.enabled && (cap.scope === "instance_daily" || cap.scope === "instance_monthly")) {
      ensureBudgetCapWindow(cap, database, nowInput);
    }
    return cap;
  }).immediate();
}

export function getBudgetCap(id: string, database: Database = getDb()): BudgetCap | null {
  return (database.prepare("SELECT * FROM budget_caps WHERE id=?").get(id) as BudgetCap | undefined) ?? null;
}

export function listBudgetCaps(options: { enabledOnly?: boolean } = {}, database: Database = getDb()): BudgetCap[] {
  const sql = options.enabledOnly ? "SELECT * FROM budget_caps WHERE enabled=1 ORDER BY created_at,id" : "SELECT * FROM budget_caps ORDER BY created_at,id";
  return database.prepare(sql).all() as BudgetCap[];
}

export function setBudgetCapEnabled(id: string, enabled: boolean, database: Database = getDb(), now = new Date()): BudgetCap {
  const existing = getBudgetCap(id, database);
  if (!existing) throw new Error(`Unknown budget cap: ${id}`);
  return saveBudgetCap({
    id,
    scope: existing.scope,
    metric: existing.metric,
    amount: existing.amount,
    enabled,
    workId: existing.work_id,
    scheduledTaskId: existing.scheduled_task_id,
    providerId: existing.provider_id,
    quotaDimension: existing.quota_dimension,
    accountRef: existing.account_ref,
    timezone: existing.timezone,
  }, database, now);
}

export function ensureBudgetCapWindow(cap: BudgetCap, database: Database = getDb(), now = new Date()): BudgetCapWindowRecord {
  if (cap.scope !== "instance_daily" && cap.scope !== "instance_monthly") {
    throw new Error(`Cap ${cap.id} has no local calendar window`);
  }
  const window = resolveCalendarWindow(cap.scope === "instance_daily" ? "daily" : "monthly", cap.timezone || "UTC", now);
  const createdAt = now.toISOString();
  database.prepare(`INSERT OR IGNORE INTO budget_cap_windows (
    cap_id,cap_revision,window_id,starts_at,ends_at,timezone,created_at
  ) VALUES (?,?,?,?,?,?,?)`).run(cap.id, cap.revision, window.id, window.startsAt, window.endsAt, window.timezone, createdAt);
  return database.prepare("SELECT * FROM budget_cap_windows WHERE cap_id=? AND cap_revision=? AND window_id=?")
    .get(cap.id, cap.revision, window.id) as BudgetCapWindowRecord;
}

export function ensureBudgetWork(input: {
  id: string;
  chatJid: string;
  executionKind: BudgetExecutionKind;
  parentWorkId?: string | null;
  scheduledTaskId?: string | null;
  now?: string;
}, database: Database = getDb()): BudgetWorkRecord {
  const now = input.now ?? new Date().toISOString();
  database.prepare(`INSERT OR IGNORE INTO budget_work (
    id,chat_jid,execution_kind,parent_work_id,scheduled_task_id,status,created_at,updated_at
  ) VALUES (?,?,?,?,?,'active',?,?)`).run(
    input.id,
    input.chatJid,
    input.executionKind,
    input.parentWorkId ?? null,
    input.scheduledTaskId ?? null,
    now,
    now,
  );
  const existing = database.prepare("SELECT * FROM budget_work WHERE id=?").get(input.id) as BudgetWorkRecord;
  if (existing.chat_jid !== input.chatJid || existing.execution_kind !== input.executionKind
    || existing.parent_work_id !== (input.parentWorkId ?? null)
    || existing.scheduled_task_id !== (input.scheduledTaskId ?? null)) {
    throw new Error(`Budget work identity conflict: ${input.id}`);
  }
  return existing;
}

export function getBudgetWork(id: string, database: Database = getDb()): BudgetWorkRecord | null {
  return (database.prepare("SELECT * FROM budget_work WHERE id=?").get(id) as BudgetWorkRecord | undefined) ?? null;
}

export function getActiveBudgetWorkForChat(chatJid: string, database: Database = getDb()): BudgetWorkRecord | null {
  return (database.prepare(`SELECT * FROM budget_work WHERE chat_jid=? AND status IN ('active','paused')
    ORDER BY updated_at DESC,id DESC LIMIT 1`).get(chatJid) as BudgetWorkRecord | undefined) ?? null;
}

export function setBudgetWorkStatus(
  id: string,
  status: BudgetWorkStatus,
  input: { blocking?: unknown; boundary?: string | null; now?: string } = {},
  database: Database = getDb(),
): void {
  const now = input.now ?? new Date().toISOString();
  const closedAt = status === "completed" || status === "cancelled" || status === "stopped" ? now : null;
  const result = database.prepare(`UPDATE budget_work SET status=?,blocking_json=?,last_boundary=?,updated_at=?,closed_at=? WHERE id=?`).run(
    status,
    input.blocking === undefined ? null : JSON.stringify(input.blocking),
    input.boundary ?? null,
    now,
    closedAt,
    id,
  );
  if (result.changes !== 1) throw new Error(`Unknown budget work: ${id}`);
  if (closedAt) {
    database.prepare("UPDATE budget_overrides SET revoked_at=? WHERE work_id=? AND revoked_at IS NULL").run(now, id);
    database.prepare("UPDATE budget_allowances SET revoked_at=? WHERE work_id=? AND revoked_at IS NULL").run(now, id);
  }
}

export function persistBudgetDecision(input: {
  decision: BudgetDecision;
  boundary: string;
  continuation?: unknown;
  notificationKey?: string | null;
}, database: Database = getDb()): string {
  const id = createUuid("budget-decision");
  database.transaction(() => {
    database.prepare(`INSERT INTO budget_decisions (
      id,work_id,boundary,decision,blockers_json,continuation_json,notification_key,notification_status,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?)`).run(
      id,
      input.decision.workId,
      input.boundary,
      input.decision.action,
      JSON.stringify(input.decision.blockers.length ? input.decision.blockers : input.decision.warnings),
      input.continuation === undefined ? null : JSON.stringify(input.continuation),
      input.notificationKey ?? null,
      input.notificationKey ? "pending" : null,
      input.decision.checkedAt,
    );
    const status = input.decision.action === "pause" ? "paused" : input.decision.action === "stop" ? "stopped" : null;
    if (status) setBudgetWorkStatus(input.decision.workId, status, {
      blocking: input.decision.blockers,
      boundary: input.boundary,
      now: input.decision.checkedAt,
    }, database);
  }).immediate();
  return id;
}

export function markBudgetDecisionNotified(id: string, database: Database = getDb()): void {
  const result = database.prepare("UPDATE budget_decisions SET notification_status='delivered' WHERE id=? AND notification_status='pending'").run(id);
  if (result.changes > 1) throw new Error(`Invalid budget notification update: ${id}`);
}

export function grantBudgetAllowance(input: {
  workId: string;
  capId: string;
  capRevision: number;
  windowId: string;
  amount: number;
  expiresAt: string;
  now?: string;
}, database: Database = getDb()): string {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error("Allowance amount must be a positive integer in millionths");
  const expires = new Date(input.expiresAt);
  const now = input.now ?? new Date().toISOString();
  if (Number.isNaN(expires.getTime()) || expires.toISOString() <= now) throw new Error("Allowance expiry must be in the future");
  const work = getBudgetWork(input.workId, database);
  if (!work || (work.status !== "active" && work.status !== "paused")) throw new Error("Allowance requires an active or paused work item");
  const cap = getBudgetCap(input.capId, database);
  if (!cap || !cap.enabled || cap.revision !== input.capRevision) throw new Error("Allowance cap revision is no longer active");
  const id = createUuid("budget-allowance");
  database.prepare(`INSERT INTO budget_allowances (
    id,work_id,cap_id,cap_revision,window_id,amount,expires_at,created_at
  ) VALUES (?,?,?,?,?,?,?,?)`).run(id, input.workId, input.capId, input.capRevision, input.windowId, input.amount, expires.toISOString(), now);
  return id;
}

export function setBudgetWarningsOnly(input: {
  workId: string;
  chatJid: string;
  expiresAt: string;
  now?: string;
}, database: Database = getDb()): void {
  const now = input.now ?? new Date().toISOString();
  const expires = new Date(input.expiresAt);
  if (Number.isNaN(expires.getTime()) || expires.toISOString() <= now) throw new Error("Warnings-only expiry must be in the future");
  const work = getBudgetWork(input.workId, database);
  if (!work || work.chat_jid !== input.chatJid || (work.status !== "active" && work.status !== "paused")) {
    throw new Error("Warnings-only requires the active work item in this chat");
  }
  database.prepare(`INSERT INTO budget_overrides (work_id,chat_jid,mode,expires_at,created_at,revoked_at)
    VALUES (?,?,'warnings_only',?,?,NULL)
    ON CONFLICT(work_id) DO UPDATE SET chat_jid=excluded.chat_jid,mode=excluded.mode,
      expires_at=excluded.expires_at,created_at=excluded.created_at,revoked_at=NULL`).run(
    input.workId, input.chatJid, expires.toISOString(), now,
  );
}

export function resumeBudgetWork(workId: string, database: Database = getDb(), now = new Date().toISOString()): void {
  const work = getBudgetWork(workId, database);
  if (!work || work.status !== "paused") throw new Error("Only paused budget work can be resumed");
  setBudgetWorkStatus(workId, "active", { now, boundary: "resume_pending" }, database);
}

export function insertBudgetUsageEvent(input: BudgetUsageEventInput, database: Database = getDb()): boolean {
  if (!input.usageEventId) return false;
  const result = database.prepare(`INSERT OR IGNORE INTO budget_usage_events (
    usage_event_id,token_usage_id,work_id,chat_jid,invocation_id,accounted_at,
    api_usd_micros,api_usd_known,valuation_provenance,usage_source
  ) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    input.usageEventId,
    input.tokenUsageId,
    input.workId,
    input.chatJid,
    input.invocationId,
    input.accountedAt,
    input.apiUsdMicros,
    input.apiUsdKnown ? 1 : 0,
    input.valuationProvenance,
    input.usageSource,
  );
  return result.changes === 1;
}
