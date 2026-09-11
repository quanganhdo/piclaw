import { formatBudgetStatus, getBudgetStatus } from "../../src/budget/status.js";
import { getBudgetSettingsState } from "../../src/budget/settings.js";
import {
  closeDatabase,
  ensureBudgetWork,
  getDb,
  initDatabase,
  saveBudgetCap,
  storeTokenUsage,
} from "../../src/db.js";

const now = new Date("2026-09-09T12:00:00Z");
initDatabase();
ensureBudgetWork({ id: "settings:restart", chatJid: "web:restart", executionKind: "interactive" });
storeTokenUsage({
  chat_jid: "web:restart", run_at: now.toISOString(), input_tokens: 1, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
  total_tokens: 1, cost_input: 0.25, cost_output: 0, cost_cache_read: 0, cost_cache_write: 0, cost_total: 0.25,
  catalogue_cost_total: 0.25, work_id: "settings:restart", invocation_id: "restart:invocation", usage_event_id: "restart:usage",
  api_equivalent_cost_microusd: 250_000, api_equivalent_cost_known: true, valuation_provenance: "catalogue_estimate", execution_kind: "interactive",
});
saveBudgetCap({ id: "cap:restart", scope: "instance_daily", metric: "api_usd_micros", amount: 1_000_000, timezone: "UTC" }, getDb(), now);
const before = getBudgetSettingsState("web:restart", getDb(), now) as any;
const slashBefore = formatBudgetStatus(getBudgetStatus("web:restart", "settings:restart"));
closeDatabase();
initDatabase();
const after = getBudgetSettingsState("web:restart", getDb(), now) as any;
const slashAfter = formatBudgetStatus(getBudgetStatus("web:restart", "settings:restart"));
console.log(JSON.stringify({ before: before.caps[0], after: after.caps[0], slashBefore, slashAfter }));
closeDatabase();
