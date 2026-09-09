import type Database from "bun:sqlite";

import { getActiveBudgetWorkForChat, listBudgetCaps } from "../db/budget-limits.js";
import { getDb } from "../db/connection.js";
import { evaluateBudget } from "./evaluator.js";
import type { BudgetProviderEvidence } from "./types.js";

function latestProviderEvidence(database: Database): BudgetProviderEvidence[] {
  const caps = listBudgetCaps({ enabledOnly: true }, database).filter((cap) => cap.scope === "provider_window");
  return caps.map((cap) => {
    const row = database.prepare(`SELECT * FROM budget_provider_evidence
      WHERE provider_id=? AND quota_dimension=? ORDER BY fetched_at DESC,evidence_id DESC LIMIT 1`)
      .get(cap.provider_id, cap.quota_dimension) as Record<string, unknown> | undefined;
    return {
      capId: cap.id,
      providerId: cap.provider_id || "unknown",
      accountRef: String(row?.account_ref ?? "unavailable"),
      quotaDimension: cap.quota_dimension || "unknown",
      windowId: String(row?.window_id ?? "provider:unknown"),
      fetchedAt: String(row?.fetched_at ?? new Date(0).toISOString()),
      resetsAt: typeof row?.resets_at === "string" ? row.resets_at : null,
      stale: row?.stale !== 0
        || !Number.isFinite(Date.parse(String(row?.fetched_at ?? "")))
        || Date.now() - Date.parse(String(row?.fetched_at ?? "")) > 120_000,
      availability: String(row?.availability ?? "temporary_failure"),
      valueMicros: typeof row?.used_micros === "number"
        ? row.used_micros
        : typeof row?.remaining_micros === "number"
          ? row.remaining_micros
          : null,
      source: String(row?.source ?? "unavailable"),
    };
  });
}

export function getBudgetStatus(chatJid: string, workId?: string | null, database: Database = getDb()): Record<string, unknown> {
  const caps = listBudgetCaps({}, database);
  const enabledCaps = caps.filter((cap) => Boolean(cap.enabled));
  const work = workId
    ? database.prepare("SELECT * FROM budget_work WHERE id=?").get(workId) as Record<string, unknown> | undefined
    : getActiveBudgetWorkForChat(chatJid, database) as unknown as Record<string, unknown> | null;
  const safeCaps = caps.map((cap) => ({
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
  }));
  if (!work || enabledCaps.length === 0) {
    return { message: enabledCaps.length === 0 ? "No limits configured." : "Limits are configured; no active work is bound to this chat.", work: work ?? null, caps: safeCaps, decision: null };
  }
  const decision = evaluateBudget({ workId: String(work.id), providerEvidence: latestProviderEvidence(database) }, database);
  return { message: decision.action === "allow" ? "Budget check passed." : `Budget decision: ${decision.action}.`, work, caps: safeCaps, decision };
}

export function evaluateBudgetStatus(chatJid: string, workId?: string | null, database: Database = getDb(), providerId?: string) {
  const caps = listBudgetCaps({ enabledOnly: true }, database);
  if (caps.length === 0) return null;
  const work = workId ? { id: workId } : getActiveBudgetWorkForChat(chatJid, database);
  if (!work) return null;
  return evaluateBudget({ workId: work.id, providerEvidence: latestProviderEvidence(database), providerId }, database);
}

export function formatBudgetStatus(status: Record<string, unknown>): string {
  const lines = [String(status.message ?? "Budget status unavailable.")];
  const work = status.work as Record<string, unknown> | null;
  if (work) lines.push(`Work ${work.id} — ${work.execution_kind}, ${work.status}.`);
  const caps = Array.isArray(status.caps) ? status.caps as Array<Record<string, unknown>> : [];
  for (const cap of caps) {
    lines.push(`- ${cap.id}: ${cap.enabled ? "enabled" : "disabled"} ${cap.scope}/${cap.metric} limit ${cap.amount} (revision ${cap.revision}).`);
  }
  const decision = status.decision as Record<string, unknown> | null;
  const blockers = Array.isArray(decision?.blockers) ? decision.blockers as Array<Record<string, unknown>> : [];
  const warnings = Array.isArray(decision?.warnings) ? decision.warnings as Array<Record<string, unknown>> : [];
  for (const item of [...blockers, ...warnings]) lines.push(`  ${item.capId}: ${item.reason}; remaining ${item.remaining ?? "unknown"}; window ${item.windowId}.`);
  return lines.join("\n");
}
