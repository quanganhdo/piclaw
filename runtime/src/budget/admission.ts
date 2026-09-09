import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

import { getProviderUsage, resolveProviderUsageAccountRef } from "../agent-pool/provider-usage.js";
import { listBudgetCaps, persistBudgetDecision } from "../db/budget-limits.js";
import { evaluateBudget } from "./evaluator.js";
import type { BudgetDecision } from "./types.js";
import { persistProviderEvidence, providerSnapshotToEvidence } from "./provider-evidence.js";

export const BUDGET_BLOCKED_PREFIX = "PICLAW-BUDGET-BLOCKED:";

export function formatBudgetDecision(decision: BudgetDecision): string {
  const entries = decision.action === "warn" ? decision.warnings : decision.blockers;
  if (entries.length === 0) return "Budget check passed.";
  const heading = decision.action === "stop"
    ? "Budget limit stopped background work."
    : decision.action === "pause"
      ? "Budget limit paused this work before another paid model call."
      : "Budget warning: warnings-only is active for this work.";
  return [heading, ...entries.map((item) => {
    const remaining = item.remaining == null ? "unknown" : String(item.remaining);
    return `- ${item.capId} (${item.scope}/${item.metric}, ${item.reason}): used ${item.knownUsage}, limit ${item.limit}, allowance ${item.allowance}, remaining ${remaining}; window ${item.windowId}.`;
  })].join("\n");
}

export async function admitBudgetBoundary(input: {
  workId: string;
  boundary: string;
  prompt?: string;
  modelRuntime: Pick<ModelRuntime, "getAuth">;
  providerId?: string;
  now?: Date;
}): Promise<{ decision: BudgetDecision; message: string | null }> {
  const now = input.now ?? new Date();
  const providerCaps = listBudgetCaps({ enabledOnly: true }).filter((cap) =>
    cap.scope === "provider_window" && (!input.providerId || cap.provider_id === input.providerId));
  const evidence = await Promise.all(providerCaps.map(async (cap) => {
    const [snapshot, accountRef] = await Promise.all([
      getProviderUsage(input.modelRuntime, cap.provider_id || ""),
      resolveProviderUsageAccountRef(input.modelRuntime, cap.provider_id || ""),
    ]);
    const item = providerSnapshotToEvidence({ cap, snapshot, accountRef: accountRef ?? "unavailable", now });
    persistProviderEvidence(item);
    return item;
  }));
  const decision = evaluateBudget({ workId: input.workId, now, providerEvidence: evidence, providerId: input.providerId });
  if (decision.action === "allow") return { decision, message: null };
  const message = formatBudgetDecision(decision);
  persistBudgetDecision({
    decision,
    boundary: input.boundary,
    continuation: decision.action === "pause" ? { prompt: input.prompt ?? null } : undefined,
    notificationKey: decision.action === "stop" ? `budget-stop:${input.workId}:${input.boundary}` : null,
  });
  return { decision, message };
}
