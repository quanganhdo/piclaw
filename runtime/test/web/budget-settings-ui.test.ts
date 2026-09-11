import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  budgetEvidenceState,
  buildBudgetSaveRequest,
  capToBudgetDraft,
  formatBudgetAmount,
  normalizeBudgetCapDraft,
} from "../../web/src/ui/budget-settings-model.js";

const runtimeRoot = join(import.meta.dir, "../..");
const api = readFileSync(join(runtimeRoot, "web/src/api.ts"), "utf8");
const classic = readFileSync(join(runtimeRoot, "web/src/components/settings/budget.ts"), "utf8");
const classicDialog = readFileSync(join(runtimeRoot, "web/src/components/settings-dialog.ts"), "utf8");
const visual = readFileSync(join(runtimeRoot, "web/static/visual/frontend/src/panels/settings/BudgetSection.tsx"), "utf8");
const visualTasks = readFileSync(join(runtimeRoot, "web/static/visual/frontend/src/panels/settings/ScheduledTasksSection.tsx"), "utf8");
const visualPanel = readFileSync(join(runtimeRoot, "web/static/visual/frontend/src/panels/SettingsPanel.tsx"), "utf8");

test("shared budget model formats exact millionths and provider evidence states", () => {
  expect(formatBudgetAmount(1_250_000)).toBe("$1.25");
  expect(formatBudgetAmount(80_000_000, "provider_percent_used_micros")).toBe("80%");
  expect(budgetEvidenceState({ scope: "provider_window", evidence: null })).toEqual({ state: "unknown", label: "No provider evidence" });
  expect(budgetEvidenceState({ scope: "provider_window", evidence: { availability: "available", stale: true, value_micros: 10 } })).toEqual({ state: "stale", label: "Provider evidence stale" });
});

test("shared budget model derives provider metric and requires explicit revision on edits", () => {
  const payload = { timezone: "Europe/Lisbon", provider_capabilities: [{ provider_id: "openai-codex", dimensions: ["primary.percent_used", "credits.remaining"] }] };
  const normalized = normalizeBudgetCapDraft({ scope: "provider_window", provider_id: "openai-codex", quota_dimension: "credits.remaining" }, payload);
  expect(normalized.metric).toBe("provider_credits_remaining_micros");
  const draft = capToBudgetDraft({ id: "cap:one", scope: "instance_daily", metric: "api_usd_micros", amount: 2_000_000, timezone: "UTC", revision: 3 }, payload);
  expect(buildBudgetSaveRequest(draft, payload)).toEqual({ action: "save_cap", id: "cap:one", scope: "instance_daily", metric: "api_usd_micros", amount: "2", confirm_revision: 3, timezone: "UTC" });
  expect(() => buildBudgetSaveRequest({ ...draft, amount: "1.0000001" }, payload)).toThrow("at most six decimal places");
});

test("classic Settings registers and lazy-loads the native Budget pane", () => {
  expect(classicDialog).toContain("budget: () => import('./settings/budget.js').then(mod => mod.BudgetSection)");
  expect(classicDialog).toContain("{ id: 'budget', label: 'Budget'");
  expect(classicDialog).toContain("case 'budget'");
  expect(api).toContain("/agent/settings/budget");
  expect(classic).toContain("getBudgetSettings");
  expect(classic).toContain("updateBudgetSettings");
  expect(classic).toContain("continuation message");
  expect(classic).toContain("Best effort at boundaries Piclaw controls");
  expect(classic).toContain("Open Scheduled Tasks");
  expect(classic).not.toContain("account_ref");
});

test("visual Settings registers native Budget and Scheduled Tasks panes", () => {
  expect(visualPanel).toContain('import "./settings/BudgetSection"');
  expect(visualPanel).toContain('import "./settings/ScheduledTasksSection"');
  expect(visual).toContain('id: "budget"');
  expect(visual).toContain("/agent/settings/budget/action");
  expect(visual).toContain("Best effort at boundaries Piclaw controls");
  expect(visual).toContain("Open Scheduled Tasks");
  expect(visual).not.toContain("account_ref");
  expect(visualTasks).toContain('id: "scheduled-tasks"');
  expect(visualTasks).toContain('action("set_budget"');
  expect(visualTasks).toContain("single source of truth");
});
