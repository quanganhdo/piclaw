import type Database from "bun:sqlite";

import { getRuntimeTimingConfig } from "../core/config.js";
import {
  ensureBudgetCapWindow,
  getActiveBudgetWorkForChat,
  listBudgetCaps,
} from "../db/budget-limits.js";
import { getDb } from "../db/connection.js";
import { evaluateBudget } from "./evaluator.js";
import { PROVIDER_BUDGET_CAPABILITIES } from "./provider-evidence.js";
import type { BudgetCap, BudgetProviderEvidence } from "./types.js";

interface UsageTotal {
  known_usage: number;
  unknown_events: number;
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
  const row = database.prepare(`SELECT
    COALESCE(SUM(CASE
      WHEN api_equivalent_cost_known=1 THEN COALESCE(api_equivalent_cost_microusd,0)
      WHEN valuation_provenance IS NULL AND catalogue_cost_total>0 THEN CAST(ROUND(catalogue_cost_total*1000000) AS INTEGER)
      ELSE 0 END),0) AS known_usage,
    COALESCE(SUM(CASE
      WHEN total_tokens>0 AND NOT (
        api_equivalent_cost_known=1 OR (valuation_provenance IS NULL AND catalogue_cost_total>0)
      ) THEN 1 ELSE 0 END),0) AS unknown_events
    FROM token_usage ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`).get(...values as any[]) as UsageTotal;
  return { known_usage: Number(row.known_usage), unknown_events: Number(row.unknown_events) };
}

function descendantIds(workId: string, database: Database): string[] {
  return (database.prepare(`WITH RECURSIVE descendants(id) AS (
    SELECT id FROM budget_work WHERE id=?
    UNION ALL SELECT work.id FROM budget_work work JOIN descendants ON work.parent_work_id=descendants.id
  ) SELECT id FROM descendants`).all(workId) as Array<{ id: string }>).map((row) => row.id);
}

function latestEvidence(cap: BudgetCap, database: Database, now: Date): BudgetProviderEvidence | null {
  const row = database.prepare(`SELECT * FROM budget_provider_evidence
    WHERE provider_id=? AND quota_dimension=? AND account_ref=? ORDER BY fetched_at DESC,evidence_id DESC LIMIT 1`)
    .get(cap.provider_id, cap.quota_dimension, cap.account_ref) as Record<string, unknown> | undefined;
  if (!row) return null;
  const fetchedAt = String(row.fetched_at ?? "");
  return {
    capId: cap.id,
    providerId: cap.provider_id || "unknown",
    accountRef: String(row.account_ref ?? "unavailable"),
    quotaDimension: cap.quota_dimension || "unknown",
    windowId: String(row.window_id ?? "provider:unknown"),
    fetchedAt,
    resetsAt: typeof row.resets_at === "string" ? row.resets_at : null,
    stale: row.stale !== 0 || !Number.isFinite(Date.parse(fetchedAt)) || now.getTime() - Date.parse(fetchedAt) > 120_000,
    availability: String(row.availability ?? "temporary_failure"),
    valueMicros: typeof row.used_micros === "number" ? row.used_micros : typeof row.remaining_micros === "number" ? row.remaining_micros : null,
    source: String(row.source ?? "unavailable"),
  };
}

function projectCap(cap: BudgetCap, database: Database, now: Date) {
  let window: { id: string; starts_at?: string; ends_at?: string } | null = null;
  let knownUsage: number | null = null;
  let unknownEvents = 0;
  let evidence: ReturnType<typeof latestEvidence> = null;

  if (cap.scope === "instance_daily" || cap.scope === "instance_monthly") {
    const row = cap.enabled
      ? ensureBudgetCapWindow(cap, database, now)
      : database.prepare(`SELECT * FROM budget_cap_windows WHERE cap_id=?
          ORDER BY created_at DESC,cap_revision DESC,window_id DESC LIMIT 1`).get(cap.id) as ReturnType<typeof ensureBudgetCapWindow> | undefined;
    if (row) {
      window = { id: row.window_id, starts_at: row.starts_at, ends_at: row.ends_at };
      const total = usageTotal({ startsAt: row.starts_at, endsAt: row.ends_at }, database);
      knownUsage = total.known_usage;
      unknownEvents = total.unknown_events;
    }
  } else if (cap.scope === "task" && cap.work_id) {
    window = { id: `work:${cap.work_id}:r${cap.revision}` };
    const total = usageTotal({ workIds: descendantIds(cap.work_id, database) }, database);
    knownUsage = total.known_usage;
    unknownEvents = total.unknown_events;
  } else if (cap.scope === "provider_window") {
    evidence = latestEvidence(cap, database, now);
    window = evidence ? { id: evidence.windowId, ends_at: evidence.resetsAt ?? undefined } : null;
    knownUsage = evidence?.valueMicros ?? null;
    unknownEvents = evidence?.valueMicros == null ? 1 : 0;
  }

  const remaining = knownUsage == null || unknownEvents > 0
    ? null
    : cap.metric === "provider_credits_remaining_micros"
      ? knownUsage - cap.amount
      : cap.amount - knownUsage;

  return {
    id: cap.id,
    scope: cap.scope,
    metric: cap.metric,
    amount: cap.amount,
    enabled: Boolean(cap.enabled),
    work_id: cap.work_id,
    scheduled_task_id: cap.scheduled_task_id,
    provider_id: cap.provider_id,
    quota_dimension: cap.quota_dimension,
    timezone: cap.timezone,
    revision: cap.revision,
    created_at: cap.created_at,
    updated_at: cap.updated_at,
    known_usage: knownUsage,
    remaining,
    unknown_events: unknownEvents,
    window,
    evidence: evidence ? {
      fetched_at: evidence.fetchedAt,
      resets_at: evidence.resetsAt,
      stale: evidence.stale,
      availability: evidence.availability,
      source: evidence.source,
      value_micros: evidence.valueMicros,
    } : null,
  };
}

export function getBudgetSettingsState(
  chatJid: string,
  database: Database = getDb(),
  now = new Date(),
): Record<string, unknown> {
  const caps = listBudgetCaps({}, database);
  const work = getActiveBudgetWorkForChat(chatJid, database);
  const projectedCaps = caps.map((cap) => projectCap(cap, database, now));
  const providerEvidence = caps.filter((cap) => cap.enabled && cap.scope === "provider_window")
    .map((cap) => latestEvidence(cap, database, now)).filter((item): item is BudgetProviderEvidence => Boolean(item));
  const decision = work && caps.some((cap) => cap.enabled)
    ? evaluateBudget({ workId: work.id, providerEvidence, now }, database)
    : null;
  const override = work ? database.prepare(`SELECT mode,expires_at,created_at FROM budget_overrides
    WHERE work_id=? AND revoked_at IS NULL AND expires_at>?`).get(work.id, now.toISOString()) as Record<string, unknown> | undefined : undefined;
  const allowances = work ? database.prepare(`SELECT a.id,a.cap_id,a.cap_revision,a.window_id,a.amount,a.expires_at,a.created_at
    FROM budget_allowances a WHERE a.work_id=? AND a.revoked_at IS NULL AND a.expires_at>? ORDER BY a.created_at,a.id`)
    .all(work.id, now.toISOString()) as Record<string, unknown>[] : [];

  return {
    message: projectedCaps.length === 0 ? "No limits configured." : work ? "Budget policy and current work loaded." : "Budget policy loaded; no active work is bound to this chat.",
    timezone: getRuntimeTimingConfig().timezone,
    enforcement: "best_effort_boundaries",
    pricing_notice: "API-equivalent USD is an estimate, not an invoice or subscription balance.",
    reservation_notice: "Budget limits v1 does not reserve spend and never selects a cheaper model automatically.",
    caps: projectedCaps,
    work: work ? {
      id: work.id,
      chat_jid: work.chat_jid,
      execution_kind: work.execution_kind,
      status: work.status,
      last_boundary: work.last_boundary,
      blocking: work.blocking_json ? JSON.parse(work.blocking_json) : null,
      updated_at: work.updated_at,
    } : null,
    decision,
    override: override ?? null,
    allowances,
    provider_capabilities: PROVIDER_BUDGET_CAPABILITIES.map((capability) => ({
      provider_id: capability.providerId,
      dimensions: [...capability.dimensions],
      attribution: capability.attribution,
      native_windows: capability.nativeWindows,
    })),
    scheduled_task_settings_section: "scheduled-tasks",
    audit: {
      cap_revision_count: Number((database.prepare("SELECT COUNT(*) AS count FROM budget_cap_revisions").get() as { count: number }).count),
      decision_count: Number((database.prepare("SELECT COUNT(*) AS count FROM budget_decisions").get() as { count: number }).count),
    },
  };
}
