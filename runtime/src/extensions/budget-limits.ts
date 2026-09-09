import type { ExtensionAPI, ExtensionFactory, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { getBudgetWorkContext } from "../budget/context.js";
import { evaluateBudgetStatus, formatBudgetStatus, getBudgetStatus } from "../budget/status.js";
import { formatBudgetDecision } from "../budget/admission.js";
import { resolveProviderUsageAccountRef } from "../agent-pool/provider-usage.js";
import { getChatContext } from "../core/chat-context.js";
import { getRuntimeTimingConfig } from "../core/config.js";
import { readAccessConfig } from "../core/config-access.js";
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
  persistBudgetDecision,
} from "../db.js";
import { getDb } from "../db/connection.js";

function decimalMicros(value: string): number {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) throw new Error("Amount must be a non-negative decimal with at most six places");
  const [whole, fraction = ""] = value.split(".");
  const micros = BigInt(whole) * 1_000_000n + BigInt((fraction + "000000").slice(0, 6));
  if (micros > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Amount is too large");
  return Number(micros);
}

function parseTokens(args: string): { words: string[]; options: Record<string, string> } {
  const words: string[] = [];
  const options: Record<string, string> = {};
  for (const token of args.trim().split(/\s+/).filter(Boolean)) {
    const equals = token.indexOf("=");
    if (equals > 0) options[token.slice(0, equals).toLowerCase()] = token.slice(equals + 1);
    else words.push(token);
  }
  return { words, options };
}

function activeWork(chatJid: string) {
  return getActiveBudgetWorkForChat(chatJid);
}

function latestBlocker(workId: string, capId: string): { capRevision: number; windowId: string } | null {
  const row = getDb().prepare("SELECT blockers_json FROM budget_decisions WHERE work_id=? ORDER BY created_at DESC,id DESC LIMIT 1").get(workId) as { blockers_json: string } | undefined;
  if (!row) return null;
  const blockers = JSON.parse(row.blockers_json) as Array<Record<string, unknown>>;
  const blocker = blockers.find((item) => item.capId === capId);
  return blocker ? { capRevision: Number(blocker.capRevision), windowId: String(blocker.windowId) } : null;
}

export function createBudgetLimitsExtension(options: { modelRuntime?: ModelRuntime; chatJid?: string } = {}): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    const chatJid = () => getChatContext()?.chatJid ?? options.chatJid ?? "web:default";
    const send = (content: string) => pi.sendMessage({ customType: "budget-limits", content, display: true });

    pi.registerTool({
      name: "budget_status",
      label: "budget_status",
      description: "Read current opt-in budget caps, work state, evidence and blockers. This tool cannot grant allowance or change enforcement.",
      promptSnippet: "budget_status: inspect current opt-in budget state; read-only and cannot approve spending.",
      parameters: Type.Object({ work_id: Type.Optional(Type.String({ description: "Optional durable work ID; defaults to current work/chat." })) }),
      async execute(_id, params) {
        const current = getBudgetWorkContext();
        const status = getBudgetStatus(chatJid(), params.work_id ?? current?.workId ?? null);
        return { content: [{ type: "text", text: formatBudgetStatus(status) }], details: status };
      },
    });

    pi.on("tool_call", (event) => {
      const current = getBudgetWorkContext();
      if (!current) return;
      // Tool execution does not consume provider quota itself. Provider guards
      // are checked again against the concrete route before the next model call.
      const decision = evaluateBudgetStatus(current.chatJid, current.workId, getDb(), "__tool_boundary__");
      if (!decision || decision.action === "allow" || decision.action === "warn") return;
      persistBudgetDecision({
        decision,
        boundary: `tool_call:${event.toolName}`,
        continuation: { toolCallId: event.toolCallId, toolName: event.toolName },
      });
      return { block: true, terminate: true, reason: formatBudgetDecision(decision) };
    });

    pi.registerCommand("budget", {
      description: "Budget status and authorised cap/allowance/override controls",
      handler: async (args: string) => {
        try {
          const parsed = parseTokens(args);
          const [command = "status", subcommand, third] = parsed.words;
          const chat = chatJid();
          if (command === "status") {
            send(formatBudgetStatus(getBudgetStatus(chat, subcommand ?? null)));
            return;
          }
          if (readAccessConfig().mode !== "single-user") {
            send("Budget mutations are disabled until owner-bound controls are available.");
            return;
          }
          if (command === "cap" && subcommand === "disable" && third) {
            const cap = setBudgetCapEnabled(third, false);
            send(`Disabled ${cap.id} at revision ${cap.revision}. Historical usage was retained.`);
            return;
          }
          if (command === "cap" && subcommand === "set") {
            const scopeAlias = third;
            const amountText = parsed.words[3];
            if (!scopeAlias || !amountText) throw new Error("Usage: /budget cap set <task|daily|monthly|scheduled|provider> <amount> [key=value]");
            const scope = scopeAlias === "daily" ? "instance_daily" : scopeAlias === "monthly" ? "instance_monthly" : scopeAlias === "scheduled" ? "scheduled_run" : scopeAlias === "provider" ? "provider_window" : scopeAlias;
            const existing = parsed.options.id ? getBudgetCap(parsed.options.id) : null;
            if (existing && parsed.options.confirm !== "true") throw new Error("Revising an existing cap requires confirm=true because the active window is retained");
            const work = activeWork(chat);
            const providerId = parsed.options.provider ?? null;
            const metricAlias = parsed.options.metric ?? (scope === "provider_window" ? "percent" : "usd");
            const metric = metricAlias === "percent" ? "provider_percent_used_micros" : metricAlias === "credits" ? "provider_credits_remaining_micros" : metricAlias === "key-usd" ? "provider_key_usd_micros" : "api_usd_micros";
            const accountRef = scope === "provider_window"
              ? parsed.options.account ?? (options.modelRuntime && providerId ? await resolveProviderUsageAccountRef(options.modelRuntime, providerId) : null)
              : null;
            const cap = saveBudgetCap({
              id: parsed.options.id,
              scope: scope as any,
              metric,
              amount: decimalMicros(amountText),
              workId: parsed.options.work ?? work?.id ?? null,
              scheduledTaskId: parsed.options.task ?? null,
              providerId,
              quotaDimension: parsed.options.dimension ?? null,
              accountRef,
              timezone: parsed.options.timezone ?? getRuntimeTimingConfig().timezone,
            });
            send(`Saved ${cap.id}: ${cap.scope}/${cap.metric} ${cap.amount} millionths, revision ${cap.revision}. Existing current-window spend remains included.`);
            return;
          }
          if (command === "allow" && subcommand && third) {
            const work = activeWork(chat);
            if (!work || work.status !== "paused") throw new Error("No paused work is available for allowance");
            const binding = latestBlocker(work.id, subcommand);
            if (!binding) throw new Error(`Cap ${subcommand} is not a current blocker for ${work.id}`);
            grantBudgetAllowance({
              workId: work.id,
              capId: subcommand,
              capRevision: binding.capRevision,
              windowId: binding.windowId,
              amount: decimalMicros(third),
              expiresAt: parsed.options.expires ?? new Date(Date.now() + 3_600_000).toISOString(),
            });
            resumeBudgetWork(work.id);
            send(`Granted bounded allowance for ${subcommand} to ${work.id}; send a continuation message to resume. Other blockers still apply.`);
            return;
          }
          if (command === "warnings-only") {
            const work = activeWork(chat);
            if (!work || (work.status !== "paused" && work.status !== "active")) throw new Error("No active or paused work is available in this chat");
            setBudgetWarningsOnly({ workId: work.id, chatJid: chat, expiresAt: parsed.options.expires ?? new Date(Date.now() + 3_600_000).toISOString() });
            if (work.status === "paused") resumeBudgetWork(work.id);
            send(`Warnings-only is bound to ${work.id} and its delegates until expiry or work completion/cancellation. Send a continuation message to resume.`);
            return;
          }
          if (command === "resume") {
            const work = activeWork(chat);
            if (!work || work.status !== "paused") throw new Error("No paused work is available in this chat");
            resumeBudgetWork(work.id);
            send(`Budget work ${work.id} is ready; send a continuation message. All caps will be rechecked before the next model call.`);
            return;
          }
          if (command === "cancel") {
            const work = subcommand ? getBudgetWork(subcommand) : activeWork(chat);
            if (!work || work.chat_jid !== chat) throw new Error("No matching work is available in this chat");
            setBudgetWorkStatus(work.id, "cancelled");
            send(`Cancelled ${work.id}. Charges were retained; allowances and warnings-only were revoked.`);
            return;
          }
          throw new Error("Usage: /budget [status [work-id] | cap set ... | cap disable <id> | allow <cap-id> <amount> | warnings-only [expires=ISO] | resume | cancel [work-id]]");
        } catch (error) {
          send(error instanceof Error ? error.message : String(error));
        }
      },
    });
  };
}
