import type Database from "bun:sqlite";
import { resolveCalendarWindow } from "./calendar.js";

import { ensureBudgetCapWindow, getBudgetWork, listBudgetCaps } from "../db/budget-limits.js";
import { getDb } from "../db/connection.js";
import type { BudgetBlocker, BudgetCap, BudgetDecision, BudgetDecisionAction, BudgetProviderEvidence, BudgetWorkStatus } from "./types.js";

type UsageTotal = { known_usage: number; unknown_events: number };

export interface BudgetPendingRequest {
  amountMicros: number | null;
}

/** Outstanding requests reserve capacity across all calendar windows until settled.
 * This deliberately overblocks rollover rather than losing an uncertain charge. */
function pendingUsage(workIds: string[] | undefined, excludeId: string | undefined, database: Database): UsageTotal {
  const where = ["state IN ('reserved','dispatched','unresolved')"];
  const values: unknown[] = [];
  if (workIds) {
    if (workIds.length === 0) return { known_usage: 0, unknown_events: 0 };
    where.push(`work_id IN (${workIds.map(() => '?').join(',')})`); values.push(...workIds);
  }
  if (excludeId) { where.push('id<>?'); values.push(excludeId); }
  const row = database.prepare(`SELECT
    COALESCE(SUM(amount_microusd),0) AS known_usage,
    COALESCE(SUM(CASE WHEN state='unresolved' OR amount_microusd IS NULL THEN 1 ELSE 0 END),0) AS unknown_events
    FROM budget_request_reservations WHERE ${where.join(' AND ')}`).get(...values as any[]) as UsageTotal;
  const known = Number(row.known_usage), unknown = Number(row.unknown_events);
  if (!Number.isSafeInteger(known) || known < 0 || !Number.isSafeInteger(unknown) || unknown < 0) throw new Error('Outstanding model request totals exceed safe integer accounting.');
  return { known_usage: known, unknown_events: unknown };
}

function ancestorIds(workId: string, database: Database): string[] {
  return (database.prepare(`WITH RECURSIVE ancestors(id,parent_work_id,depth) AS (
    SELECT id,parent_work_id,0 FROM budget_work WHERE id=?
    UNION ALL
    SELECT work.id,work.parent_work_id,ancestors.depth+1 FROM budget_work work JOIN ancestors ON work.id=ancestors.parent_work_id
  ) SELECT id FROM ancestors ORDER BY depth`).all(workId) as Array<{ id: string }>).map((row) => row.id);
}

function descendantIds(workId: string, database: Database): string[] {
  return (database.prepare(`WITH RECURSIVE descendants(id) AS (
    SELECT id FROM budget_work WHERE id=?
    UNION ALL
    SELECT work.id FROM budget_work work JOIN descendants ON work.parent_work_id=descendants.id
  ) SELECT id FROM descendants`).all(workId) as Array<{ id: string }>).map((row) => row.id);
}

function usageTotal(input: { workIds?: string[]; startsAt?: string; endsAt?: string }, database: Database): UsageTotal {
  const where: string[] = [];
  const values: unknown[] = [];
  if (input.workIds) {
    if (input.workIds.length === 0) return { known_usage: 0, unknown_events: 0 };
    where.push(`work_id IN (${input.workIds.map(() => "?").join(",")})`);
    values.push(...input.workIds);
  }
  if (input.startsAt) { where.push("run_at >= ?"); values.push(input.startsAt); }
  if (input.endsAt) { where.push("run_at < ?"); values.push(input.endsAt); }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const row = database.prepare(`SELECT
    COALESCE(SUM(CASE
      WHEN api_equivalent_cost_known=1 THEN COALESCE(api_equivalent_cost_microusd,0)
      WHEN valuation_provenance IS NULL AND catalogue_cost_total>0 THEN CAST(ROUND(catalogue_cost_total*1000000) AS INTEGER)
      ELSE 0 END),0) AS known_usage,
    COALESCE(SUM(CASE
      WHEN total_tokens>0 AND NOT (
        api_equivalent_cost_known=1 OR (valuation_provenance IS NULL AND catalogue_cost_total>0)
      ) THEN 1 ELSE 0 END),0) AS unknown_events
    FROM token_usage ${clause}`).get(...values as any[]) as UsageTotal;
  return { known_usage: Number(row.known_usage), unknown_events: Number(row.unknown_events) };
}

function allowanceFor(cap: BudgetCap, windowId: string, inheritableWorkIds: string[], now: string, database: Database): number {
  if (inheritableWorkIds.length === 0) return 0;
  const row = database.prepare(`SELECT COALESCE(SUM(amount),0) AS amount FROM budget_allowances
    WHERE cap_id=? AND cap_revision=? AND window_id=? AND revoked_at IS NULL AND expires_at>?
      AND work_id IN (${inheritableWorkIds.map(() => "?").join(",")})`).get(
    cap.id, cap.revision, windowId, now, ...inheritableWorkIds,
  ) as { amount: number };
  return Number(row.amount);
}

function hasWarningsOnly(workIds: string[], now: string, database: Database): boolean {
  if (workIds.length === 0) return false;
  const row = database.prepare(`SELECT 1 AS present FROM budget_overrides
    WHERE revoked_at IS NULL AND expires_at>? AND work_id IN (${workIds.map(() => "?").join(",")}) LIMIT 1`)
    .get(now, ...workIds) as { present: number } | undefined;
  return row?.present === 1;
}

function applicableCaps(workId: string, ancestors: string[], scheduledTaskId: string | null, providerId: string | undefined, database: Database): BudgetCap[] {
  return listBudgetCaps({ enabledOnly: true }, database).filter((cap) => {
    if (cap.scope === "task") return cap.work_id != null && ancestors.includes(cap.work_id);
    if (cap.scope === "scheduled_run") return scheduledTaskId != null && cap.scheduled_task_id === scheduledTaskId;
    if (cap.scope === "provider_window") return providerId === undefined || cap.provider_id === providerId;
    return true;
  });
}

function providerBlocker(cap: BudgetCap, evidence: BudgetProviderEvidence | undefined, allowance: number, now: Date): BudgetBlocker | null {
  const base = {
    capId: cap.id, capRevision: cap.revision, scope: cap.scope, metric: cap.metric,
    windowId: evidence?.windowId ?? "provider:unknown", limit: cap.amount, allowance,
    knownUsage: evidence?.valueMicros ?? 0, remaining: null, unknownEvents: evidence?.valueMicros == null ? 1 : 0,
  };
  if (!evidence || evidence.availability !== "available") return { ...base, reason: "missing_provider_evidence", detail: "Required provider quota evidence is unavailable." };
  if (evidence.accountRef !== cap.account_ref) return { ...base, reason: "provider_account_mismatch", detail: "Provider evidence belongs to a different credential/account." };
  if (evidence.stale) return { ...base, reason: "stale_provider_evidence", detail: "Provider evidence is stale and cannot authorise work." };
  if (evidence.resetsAt && new Date(evidence.resetsAt).getTime() <= now.getTime()) return { ...base, reason: "provider_window_expired", detail: "Provider window expired without a fresh balance." };
  if (evidence.valueMicros == null) return { ...base, reason: "missing_provider_evidence", detail: "Provider did not report the configured quota dimension." };
  const threshold = cap.amount + allowance;
  const exhausted = cap.metric === "provider_credits_remaining_micros"
    ? evidence.valueMicros < Math.max(0, cap.amount - allowance)
    : evidence.valueMicros >= threshold;
  if (!exhausted) return null;
  return {
    ...base,
    remaining: cap.metric === "provider_credits_remaining_micros"
      ? evidence.valueMicros - Math.max(0, cap.amount - allowance)
      : threshold - evidence.valueMicros,
    reason: "exhausted",
    detail: "Provider quota guard is exhausted.",
  };
}

export function evaluateBudget(input: {
  workId: string;
  now?: Date;
  providerEvidence?: BudgetProviderEvidence[];
  providerId?: string;
  /** Host-only prospective spend; never accept a child/tool-provided ceiling. */
  pendingRequest?: BudgetPendingRequest;
  excludeReservationId?: string;
}, database: Database = getDb()): BudgetDecision {
  if (input.pendingRequest && input.pendingRequest.amountMicros !== null
    && (!Number.isSafeInteger(input.pendingRequest.amountMicros) || input.pendingRequest.amountMicros < 0)) throw new Error('Invalid prospective model request cost.');
  const work = getBudgetWork(input.workId, database);
  if (!work) throw new Error(`Unknown budget work: ${input.workId}`);
  const ancestors = ancestorIds(work.id, database);
  const descendants = descendantIds(work.id, database);
  // A delegated child inherits the scheduled occurrence's cap and its whole
  // subtree, never a fresh per-child allowance or another scheduled run's spend.
  const scheduledRoot = ancestors.map(id => getBudgetWork(id, database)).find(ancestor => ancestor?.scheduled_task_id);
  return evaluateWork(input, { ...work, scheduled_task_id: scheduledRoot?.scheduled_task_id ?? work.scheduled_task_id,
    scheduledBudgetWorkId: scheduledRoot?.id ?? work.id }, ancestors, descendants, database, false);
}

/** Advisory check for a fresh scheduled run; never creates work, windows or allowances. */
export function evaluateScheduledBudget(input: {
  scheduledTaskId: string;
  now?: Date;
  providerEvidence?: BudgetProviderEvidence[];
  providerId?: string;
}, database: Database = getDb()): BudgetDecision {
  const work = { id: `scheduled-preview:${input.scheduledTaskId}`, execution_kind: "scheduled", scheduled_task_id: input.scheduledTaskId };
  return evaluateWork(input, work, [], [], database, true);
}

function evaluateWork(input: { now?: Date; providerEvidence?: BudgetProviderEvidence[]; providerId?: string; pendingRequest?: BudgetPendingRequest; excludeReservationId?: string },
  work: { id: string; execution_kind: string; scheduled_task_id: string | null; scheduledBudgetWorkId?: string },
  ancestors: string[], descendants: string[], database: Database, readOnly: boolean): BudgetDecision {
  const nowDate = input.now ?? new Date();
  const now = nowDate.toISOString();
  const caps = applicableCaps(work.id, ancestors, work.scheduled_task_id, input.providerId, database);
  const warningsOnly = hasWarningsOnly(ancestors, now, database);
  const blockers: BudgetBlocker[] = [];

  for (const cap of caps) {
    let windowId: string;
    let total: UsageTotal;
    if (cap.scope === "instance_daily" || cap.scope === "instance_monthly") {
      if (readOnly) {
        const window = resolveCalendarWindow(cap.scope === "instance_daily" ? "daily" : "monthly", cap.timezone || "UTC", nowDate);
        windowId = window.id;
        total = usageTotal({ startsAt: window.startsAt, endsAt: window.endsAt }, database);
      } else {
        const window = ensureBudgetCapWindow(cap, database, nowDate);
        windowId = window.window_id;
        total = usageTotal({ startsAt: window.starts_at, endsAt: window.ends_at }, database);
      }
    } else if (cap.scope === "task") {
      windowId = `work:${cap.work_id}:r${cap.revision}`;
      total = usageTotal({ workIds: descendantIds(cap.work_id!, database) }, database);
    } else if (cap.scope === "scheduled_run") {
      const scheduledWorkId = work.scheduledBudgetWorkId ?? work.id;
      windowId = `run:${scheduledWorkId}:r${cap.revision}`;
      total = usageTotal({ workIds: descendantIds(scheduledWorkId, database) }, database);
    } else {
      const evidence = input.providerEvidence?.find((item) => item.capId === cap.id);
      const evidenceWindow = evidence?.windowId ?? "provider:unknown";
      const allowance = allowanceFor(cap, evidenceWindow, ancestors, now, database);
      const blocker = providerBlocker(cap, evidence, allowance, nowDate);
      if (blocker) blockers.push(blocker);
      continue;
    }
    const pendingWorkIds = cap.scope === 'task' ? descendantIds(cap.work_id!, database)
      : cap.scope === 'scheduled_run' ? descendantIds(work.scheduledBudgetWorkId ?? work.id, database) : undefined;
    const pending = pendingUsage(pendingWorkIds, input.excludeReservationId, database);
    total.known_usage += pending.known_usage;
    total.unknown_events += pending.unknown_events;
    if (input.pendingRequest) {
      total.known_usage += input.pendingRequest.amountMicros ?? 0;
      if (input.pendingRequest.amountMicros === null) total.unknown_events += 1;
    }
    const allowance = allowanceFor(cap, windowId, ancestors, now, database);
    if (!Number.isSafeInteger(total.known_usage) || !Number.isSafeInteger(cap.amount + allowance)) throw new Error('Budget totals exceed safe integer accounting.');
    if (total.unknown_events > 0) {
      blockers.push({
        capId: cap.id, capRevision: cap.revision, scope: cap.scope, metric: cap.metric, windowId,
        limit: cap.amount, allowance, knownUsage: total.known_usage, remaining: null,
        unknownEvents: total.unknown_events, reason: "unknown_pricing",
        detail: `${total.unknown_events} usage or outstanding request outcome(s) lack complete API-equivalent pricing.`,
      });
      continue;
    }
    const remaining = cap.amount + allowance - total.known_usage;
    const beforeRequest = cap.amount + allowance - total.known_usage + (input.pendingRequest?.amountMicros ?? 0);
    if (input.pendingRequest ? remaining < 0 || beforeRequest <= 0 : remaining <= 0) {
      blockers.push({
        capId: cap.id, capRevision: cap.revision, scope: cap.scope, metric: cap.metric, windowId,
        limit: cap.amount, allowance, knownUsage: total.known_usage, remaining,
        unknownEvents: 0, reason: "exhausted", detail: "Configured API-equivalent spend cap is exhausted.",
      });
    }
  }

  if (blockers.length === 0) return { action: "allow", workId: work.id, checkedAt: now, blockers: [], warnings: [], applicableCapIds: caps.map((cap) => cap.id), warningsOnly };
  if (warningsOnly) return { action: "warn", workId: work.id, checkedAt: now, blockers: [], warnings: blockers, applicableCapIds: caps.map((cap) => cap.id), warningsOnly: true };
  const background = work.execution_kind === "scheduled" || work.execution_kind === "background";
  return { action: background ? "stop" : "pause", workId: work.id, checkedAt: now, blockers, warnings: [], applicableCapIds: caps.map((cap) => cap.id), warningsOnly: false };
}

export function terminalStatusForBudgetDecision(action: BudgetDecisionAction): BudgetWorkStatus | null {
  return action === "pause" ? "paused" : action === "stop" ? "stopped" : null;
}
