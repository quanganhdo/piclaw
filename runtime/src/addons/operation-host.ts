import { markAddonOperationInputCommitted } from "../db/addon-operations.js";
import type { AgentOutput, RunAgentOptions } from "../agent-pool/contracts.js";
import { readAccessConfig } from "../core/config-access.js";
import { readOperationsConfig } from "../core/config-operations.js";
import { getBudgetWork, listBudgetCaps } from "../db/budget-limits.js";
import { evaluateBudget } from "../budget/evaluator.js";
import type { OperationHost } from "./operation-contracts.js";

/** Injectable AgentPool surface keeps operation tests provider-free. */
export interface OperationAgentPool {
  runAgent(
    prompt: string,
    chatJid: string,
    options: RunAgentOptions,
  ): Promise<AgentOutput>;
}
export function createOperationHost(
  pool: OperationAgentPool,
  readConfig = readOperationsConfig,
): OperationHost {
  const host: OperationHost = {
    authorize(principal, target, action) {
      if (readAccessConfig().mode !== "single-user")
        return { decision: "rejected" };
      const config = readConfig();
      const configured = config.grants.find(
        (g) =>
          g.enabled &&
          g.addonId === principal.addonId &&
          g.principalId === principal.principalId &&
          g.target === target,
      );
      if (!config.enabled || !configured) return { decision: "rejected" };
      if (action === "admit" && configured.approvalRequired)
        return { decision: "approval_required" };
      const { revision, allowedTools, timeoutMs, maxToolCalls, parentWorkId } =
        configured;
      const grant = {
        revision,
        target,
        allowedTools,
        timeoutMs,
        maxToolCalls,
        parentWorkId,
      };
      if (action !== "admit") return { decision: "allow", grant };
      const parent = configured.parentWorkId;
      if (parent) {
        const work = getBudgetWork(parent);
        if (!work || !["active", "paused"].includes(work.status))
          return { decision: "rejected" };
        if (action === "admit") {
          const decision = evaluateBudget({ workId: parent });
          if (decision.action === "pause" || decision.action === "stop")
            return { decision: "budget_blocked" };
        }
      } else if (
        action === "admit" &&
        listBudgetCaps({ enabledOnly: true }).some((c) => c.scope === "task")
      ) {
        // Task caps cannot be inherited without an operator-selected parent work.
        return { decision: "budget_blocked" };
      }
      return { decision: "allow", grant };
    },
    async execute(input) {
      const output = await pool.runAgent(input.text, input.chatJid, {
        turnId: input.operationId,
        budgetWorkId: input.workId,
        budgetParentWorkId: input.grant.parentWorkId,
        budgetExecutionKind: "background",
        timeoutMs: input.grant.timeoutMs,
        maxToolCalls: input.grant.maxToolCalls,
        toolCeilingFilter: (name) => input.grant.allowedTools.includes(name),
        requireToolCeiling: true,
        onOperationInputCommitted: () => markAddonOperationInputCommitted(input.operationId),
        abortSignal: input.signal,
        skipPrePromptCompaction: true,
        scheduleIdleAutoCompaction: false,
        executionAdmissionCheck: async () => {
          const decision = await host.authorize(
            input.principal,
            input.grant.target,
            "admit",
          );
          return (
            decision.decision === "allow" &&
            JSON.stringify(decision.grant) === JSON.stringify(input.grant)
          );
        },
      });
      if (output.failureCategory === "provider_budget")
        return { status: "budget_blocked", reason: "budget_boundary" };
      if (output.status === "error") {
        if (input.signal.aborted && output.failureCategory === "aborted")
          return { status: "cancelled", reason: "executor_cancelled" };
        return {
          status: "failed",
          reason:
            output.failureCategory === "timeout"
              ? "execution_timeout"
              : "execution_failed",
        };
      }
      if (output.requiresToolEnabledContinuation)
        return { status: "input_required", reason: "continuation_required" };
      return { status: "completed", output: output.result || "" };
    },
  };
  return host;
}
