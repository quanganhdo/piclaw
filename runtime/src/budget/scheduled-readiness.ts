import type Database from "bun:sqlite";
import { getDb } from "../db/connection.js";
import { listBudgetCaps } from "../db/budget-limits.js";
import { evaluateScheduledBudget } from "./evaluator.js";
import { latestProviderEvidence } from "./status.js";
import type { BudgetBlocker } from "./types.js";

export interface ScheduledBudgetReadiness {
  mode: "no_task_cap" | "disabled_task_cap" | "zero_task_cap" | "capped" | "not_applicable";
  status: "allowed" | "blocked" | "check_at_run" | "not_applicable";
  checked_at: string;
  summary: string;
  blockers: BudgetBlocker[];
  applicable_cap_ids: string[];
  next_steps: string[];
  recheck_at_run: true;
}

/** Read-only snapshot for a NEW occurrence; never inherits an interactive allowance. */
export function scheduledBudgetReadiness(task: { id: string; task_kind?: string | null; model?: string | null }, database: Database = getDb(), now = new Date()): ScheduledBudgetReadiness {
  const base = { checked_at: now.toISOString(), blockers: [] as BudgetBlocker[], applicable_cap_ids: [] as string[], next_steps: [] as string[], recheck_at_run: true as const };
  if (task.task_kind && task.task_kind !== "agent") return { ...base, mode: "not_applicable", status: "not_applicable", summary: "Per-run agent budget does not apply to this task kind." };
  const allCaps = listBudgetCaps({}, database);
  const taskCaps = allCaps.filter(cap => cap.scope === "scheduled_run" && cap.scheduled_task_id === task.id);
  const enabledTaskCaps = taskCaps.filter(cap => cap.enabled);
  const mode = enabledTaskCaps.some(cap => cap.amount === 0) ? "zero_task_cap" : enabledTaskCaps.length ? "capped" : taskCaps.length ? "disabled_task_cap" : "no_task_cap";
  const slash = task.model?.indexOf("/") ?? -1;
  const providerId = slash > 0 ? task.model!.slice(0, slash) : undefined;
  // An inherited/short model name is resolved at execution. Do not label another
  // provider's missing quota evidence as a known blocker for this schedule.
  const unresolvedProvider = !providerId && allCaps.some(c => c.enabled && c.scope === "provider_window");
  const decision = evaluateScheduledBudget({ scheduledTaskId: task.id, providerId: providerId ?? "", providerEvidence: latestProviderEvidence(database, now), now }, database);
  const blockers = decision.blockers;
  const status = blockers.length ? "blocked" : unresolvedProvider ? "check_at_run" : "allowed";
  const next_steps: string[] = [...new Set(blockers.map(b => b.scope === "scheduled_run"
    ? "Set a positive task cap, or explicitly disable the task cap if authorised; zero is not unbudgeted."
    : b.scope === "provider_window"
      ? "Refresh provider quota evidence or ask the operator to review the configured provider limit."
      : "Wait for the configured instance window to reset, or ask the operator to review its cap; adding a task cap cannot bypass it."))];
  if (unresolvedProvider) next_steps.push("The inherited model/provider is resolved and its limits checked when the task runs.");
  const summary = status === "blocked" ? "Budget blocked now; the schedule is stored but cannot pass the current budget check."
    : status === "check_at_run" ? "No known dollar-cap blocker; provider budget readiness will be checked at run time."
      : decision.applicableCapIds.length === 0 ? "Budget permits execution: no applicable enabled limits. No budget approval or positive task cap is required."
        : "Budget permits a fresh run at this check; applicable limits are rechecked at execution.";
  return { ...base, mode, status, summary, blockers, applicable_cap_ids: decision.applicableCapIds, next_steps };
}
