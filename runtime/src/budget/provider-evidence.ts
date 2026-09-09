import { createHash } from "node:crypto";
import type Database from "bun:sqlite";

import type { ProviderUsageSnapshot, ProviderUsageWindow } from "../agent-pool/provider-usage.js";
import { getDb } from "../db/connection.js";
import type { BudgetCap, BudgetProviderEvidence } from "./types.js";

export interface ProviderBudgetCapability {
  providerId: ProviderUsageSnapshot["provider"];
  dimensions: string[];
  attribution: "shared_account";
  nativeWindows: boolean;
}

export const PROVIDER_BUDGET_CAPABILITIES: readonly ProviderBudgetCapability[] = [
  { providerId: "openai-codex", dimensions: ["primary.percent_used", "secondary.percent_used", "credits.remaining"], attribution: "shared_account", nativeWindows: true },
  { providerId: "github-copilot", dimensions: ["primary.percent_used", "secondary.percent_used"], attribution: "shared_account", nativeWindows: true },
  { providerId: "openrouter", dimensions: ["key.usd.used"], attribution: "shared_account", nativeWindows: true },
  { providerId: "zai", dimensions: ["primary.percent_used", "secondary.percent_used"], attribution: "shared_account", nativeWindows: true },
] as const;

export function getProviderBudgetCapability(providerId: string): ProviderBudgetCapability | null {
  return PROVIDER_BUDGET_CAPABILITIES.find((entry) => entry.providerId === providerId) ?? null;
}

function windowEvidence(window: ProviderUsageWindow | null): { value: number | null; resetsAt: string | null } {
  return { value: window?.used_percent ?? null, resetsAt: window?.resets_at ?? null };
}

export function providerSnapshotToEvidence(input: {
  cap: BudgetCap;
  snapshot: ProviderUsageSnapshot | null;
  accountRef: string;
  now?: Date;
  maxAgeMs?: number;
}): BudgetProviderEvidence {
  const now = input.now ?? new Date();
  const maxAgeMs = input.maxAgeMs ?? 120_000;
  const snapshot = input.snapshot;
  let nativeValue: number | null = null;
  let resetsAt: string | null = null;
  if (snapshot) {
    if (input.cap.quota_dimension === "primary.percent_used") ({ value: nativeValue, resetsAt } = windowEvidence(snapshot.primary));
    else if (input.cap.quota_dimension === "secondary.percent_used") ({ value: nativeValue, resetsAt } = windowEvidence(snapshot.secondary));
    else if (input.cap.quota_dimension === "credits.remaining") nativeValue = snapshot.credits_unlimited ? Number.MAX_SAFE_INTEGER / 1_000_000 : snapshot.credits_remaining;
    else if (input.cap.quota_dimension === "key.usd.used") {
      nativeValue = snapshot.key_usage_usd;
      resetsAt = snapshot.key_limit_reset;
    }
  }
  const fetchedAt = snapshot?.fetched_at ?? now.toISOString();
  const age = now.getTime() - new Date(fetchedAt).getTime();
  const stale = snapshot?.stale === true || !Number.isFinite(age) || age < 0 || age > maxAgeMs;
  return {
    capId: input.cap.id,
    providerId: input.cap.provider_id || "unknown",
    accountRef: input.accountRef,
    quotaDimension: input.cap.quota_dimension || "unknown",
    windowId: `${input.cap.provider_id}:${input.cap.quota_dimension}:${resetsAt ?? "unreported"}`,
    fetchedAt,
    resetsAt,
    stale,
    availability: snapshot?.availability ?? "temporary_failure",
    valueMicros: nativeValue == null || !Number.isFinite(nativeValue) ? null : Math.round(nativeValue * 1_000_000),
    source: snapshot?.source ?? "unavailable",
  };
}

export function persistProviderEvidence(evidence: BudgetProviderEvidence, database: Database = getDb()): string {
  const canonical = JSON.stringify(evidence);
  const id = `provider-evidence:${createHash("sha256").update(canonical).digest("hex")}`;
  const metricIsRemaining = evidence.quotaDimension === "credits.remaining";
  database.prepare(`INSERT OR IGNORE INTO budget_provider_evidence (
    evidence_id,provider_id,account_ref,quota_dimension,unit,used_micros,remaining_micros,limit_micros,
    window_id,resets_at,fetched_at,stale,availability,source
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id,
    evidence.providerId,
    evidence.accountRef,
    evidence.quotaDimension,
    evidence.quotaDimension.includes("percent") ? "percent_micros" : evidence.quotaDimension.includes("usd") ? "usd_micros" : "credits_micros",
    metricIsRemaining ? null : evidence.valueMicros,
    metricIsRemaining ? evidence.valueMicros : null,
    null,
    evidence.windowId,
    evidence.resetsAt,
    evidence.fetchedAt,
    evidence.stale ? 1 : 0,
    evidence.availability,
    evidence.source,
  );
  return id;
}
