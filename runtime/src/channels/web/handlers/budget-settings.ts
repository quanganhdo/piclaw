import type { WebChannelLike } from "../core/web-channel-contracts.js";
import { parseBudgetDecimalMicros } from "../../../budget/amount.js";
import { getBudgetSettingsState } from "../../../budget/settings.js";
import type { BudgetCapInput, BudgetMetric, BudgetCapScope } from "../../../budget/types.js";
import { getRuntimeTimingConfig } from "../../../core/config.js";
import { readAccessConfig } from "../../../core/config-access.js";
import {
  getActiveBudgetWorkForChat,
  getBudgetCap,
  getBudgetWork,
  grantBudgetAllowance,
  resumeBudgetWork,
  saveBudgetCap,
  setBudgetCapEnabled,
  setBudgetWarningsOnly,
  setBudgetWorkStatus,
} from "../../../db.js";
import { getDb } from "../../../db/connection.js";

const ALLOWED_KEYS = new Map<string, Set<string>>([
  ["save_cap", new Set(["action", "id", "scope", "metric", "amount", "provider_id", "quota_dimension", "timezone", "confirm_revision"])],
  ["set_cap_enabled", new Set(["action", "id", "enabled", "confirm_revision"])],
  ["grant_allowance", new Set(["action", "work_id", "cap_id", "amount", "expires_at"])],
  ["warnings_only", new Set(["action", "work_id", "expires_at"])],
  ["resume_work", new Set(["action", "work_id"])],
  ["cancel_work", new Set(["action", "work_id"])],
]);

function json(channel: WebChannelLike, body: Record<string, unknown>, status = 200): Response {
  return channel.json(body, status);
}

function fail(channel: WebChannelLike, error: string, status = 400): Response {
  return json(channel, { ok: false, error }, status);
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Budget request must be a JSON object.");
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, optional = false): string | null {
  if (value == null && optional) return null;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function revision(value: unknown, label = "confirm_revision"): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${label} must be a positive integer.`);
  return Number(value);
}

function expiry(value: unknown, now: Date): string {
  const raw = value == null ? new Date(now.getTime() + 3_600_000).toISOString() : text(value, "expires_at")!;
  const parsed = new Date(raw);
  const duration = parsed.getTime() - now.getTime();
  if (!Number.isFinite(parsed.getTime()) || duration <= 0 || duration > 24 * 3_600_000) {
    throw new Error("Expiry must be in the future and no more than 24 hours away.");
  }
  return parsed.toISOString();
}

function currentWork(chatJid: string, requested: unknown) {
  const work = getActiveBudgetWorkForChat(chatJid);
  const requestedId = requested == null ? null : text(requested, "work_id");
  if (!work || (requestedId && requestedId !== work.id)) throw new Error("No matching active or paused work is available in this chat.");
  return work;
}

function latestBlocker(workId: string, capId: string): { capRevision: number; windowId: string } | null {
  const row = getDb().prepare("SELECT blockers_json FROM budget_decisions WHERE work_id=? ORDER BY created_at DESC,id DESC LIMIT 1")
    .get(workId) as { blockers_json: string } | undefined;
  if (!row) return null;
  const blockers = JSON.parse(row.blockers_json) as Array<Record<string, unknown>>;
  const blocker = blockers.find((item) => item.capId === capId);
  return blocker ? { capRevision: Number(blocker.capRevision), windowId: String(blocker.windowId) } : null;
}

function mutationStatus(error: Error): number {
  if (/^Unknown budget cap:/.test(error.message)) return 404;
  if (/revision|Only paused|No matching|no longer active|current blocker/i.test(error.message)) return 409;
  return 400;
}

export function handleBudgetSettingsRead(
  channel: WebChannelLike,
  url: URL,
  options: { accessMode?: ReturnType<typeof readAccessConfig>["mode"] } = {},
): Response {
  if ((options.accessMode ?? readAccessConfig().mode) !== "single-user") return fail(channel, "Budget mutations and settings are unavailable in multi-user modes.", 403);
  const values = url.searchParams.getAll("chat_jid");
  if (values.length > 1) return fail(channel, "Duplicate chat_jid is not allowed.");
  const chatJid = values[0]?.trim() || "web:default";
  return json(channel, { ok: true, ...getBudgetSettingsState(chatJid) });
}

export async function handleBudgetSettingsAction(
  channel: WebChannelLike,
  req: Request,
  options: { accessMode?: ReturnType<typeof readAccessConfig>["mode"] } = {},
): Promise<Response> {
  if ((options.accessMode ?? readAccessConfig().mode) !== "single-user") return fail(channel, "Budget mutations are disabled until owner-bound controls are available.", 403);
  let body: Record<string, unknown>;
  try { body = objectBody(await req.json()); }
  catch (error) { return fail(channel, error instanceof Error ? error.message : "Invalid budget request."); }
  const action = typeof body.action === "string" ? body.action.trim() : "";
  const allowed = ALLOWED_KEYS.get(action);
  if (!allowed) return fail(channel, "Unsupported budget action.");
  if (Object.keys(body).some((key) => !allowed.has(key))) return fail(channel, "Budget request contains unsupported fields.");
  const now = new Date();
  const chatJid = new URL(req.url).searchParams.get("chat_jid")?.trim() || "web:default";

  try {
    if (action === "save_cap") {
      const id = text(body.id, "id", true);
      const scope = text(body.scope, "scope") as BudgetCapScope;
      if (!(["task", "instance_daily", "instance_monthly", "provider_window"] as string[]).includes(scope)) {
        throw new Error("Settings supports task, daily, monthly and provider caps; scheduled-run caps remain in Scheduled Tasks.");
      }
      const metric = text(body.metric, "metric") as BudgetMetric;
      const existing = id ? getBudgetCap(id) : null;
      if (existing && revision(body.confirm_revision) !== existing.revision) throw new Error("Cap revision changed; reload before confirming this update.");
      if (!existing && body.confirm_revision !== undefined) throw new Error("confirm_revision is only valid when revising an existing cap.");
      const input: BudgetCapInput = {
        ...(id ? { id } : {}),
        scope,
        metric,
        amount: parseBudgetDecimalMicros(body.amount),
        timezone: scope === "instance_daily" || scope === "instance_monthly"
          ? text(body.timezone, "timezone", true) ?? getRuntimeTimingConfig().timezone
          : null,
      };
      if (scope === "task") input.workId = currentWork(chatJid, null).id;
      if (scope === "provider_window") {
        input.providerId = text(body.provider_id, "provider_id")!;
        input.quotaDimension = text(body.quota_dimension, "quota_dimension")!;
        const resolver = channel.agentPool.resolveBudgetProviderAccountRef;
        if (typeof resolver !== "function") throw new Error("Provider credential binding is unavailable.");
        input.accountRef = await resolver.call(channel.agentPool, input.providerId);
        if (!input.accountRef) throw new Error("No active provider credential is available for this guard.");
      }
      saveBudgetCap(input);
    } else if (action === "set_cap_enabled") {
      const id = text(body.id, "id")!;
      const existing = getBudgetCap(id);
      if (!existing) return fail(channel, `Unknown budget cap: ${id}`, 404);
      if (revision(body.confirm_revision) !== existing.revision) throw new Error("Cap revision changed; reload before confirming this update.");
      if (typeof body.enabled !== "boolean") throw new Error("enabled must be a boolean.");
      setBudgetCapEnabled(id, body.enabled);
    } else if (action === "grant_allowance") {
      const work = currentWork(chatJid, body.work_id);
      if (work.status !== "paused") throw new Error("Only paused work can receive an allowance.");
      const capId = text(body.cap_id, "cap_id")!;
      const binding = latestBlocker(work.id, capId);
      if (!binding) throw new Error(`Cap ${capId} is not a current blocker for ${work.id}.`);
      grantBudgetAllowance({
        workId: work.id,
        capId,
        capRevision: binding.capRevision,
        windowId: binding.windowId,
        amount: parseBudgetDecimalMicros(body.amount, { positive: true }),
        expiresAt: expiry(body.expires_at, now),
      });
      resumeBudgetWork(work.id);
    } else if (action === "warnings_only") {
      const work = currentWork(chatJid, body.work_id);
      setBudgetWarningsOnly({ workId: work.id, chatJid, expiresAt: expiry(body.expires_at, now) });
      if (work.status === "paused") resumeBudgetWork(work.id);
    } else if (action === "resume_work") {
      const work = currentWork(chatJid, body.work_id);
      resumeBudgetWork(work.id);
    } else if (action === "cancel_work") {
      const workId = text(body.work_id, "work_id")!;
      const work = getBudgetWork(workId);
      if (!work || work.chat_jid !== chatJid || (work.status !== "active" && work.status !== "paused")) {
        throw new Error("No matching active or paused work is available in this chat.");
      }
      setBudgetWorkStatus(work.id, "cancelled");
    }
    return json(channel, {
      ok: true,
      action,
      continuation_required: action === "grant_allowance" || action === "warnings_only" || action === "resume_work",
      ...getBudgetSettingsState(chatJid),
    });
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    return fail(channel, normalized.message, mutationStatus(normalized));
  }
}
