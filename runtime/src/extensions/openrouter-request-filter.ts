/** OpenRouter-only output-budget shaping for provider requests. */
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

import { getToolsIntegrationConfig } from "../core/config-tools.js";
import {
  getOpenRouterOutputBudgetState,
  type OpenRouterOutputBudgetState,
  type OpenRouterOutputTokenField,
} from "../core/openrouter-output-budget.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("extensions.openrouter-request-filter");

type PayloadRecord = Record<string, unknown>;

export interface OpenRouterBudgetDiagnostic {
  provider: "openrouter";
  modelId: string | null;
  originalLimit: number | null;
  appliedLimit: number;
  reason: "initial_default" | "initial_clamp" | "adaptive_retry";
  attempt: number;
  field: OpenRouterOutputTokenField;
}

export interface OpenRouterRequestFilterOptions {
  configuredDefaultMaxTokens: number;
  state?: OpenRouterOutputBudgetState;
  onApplied?: (diagnostic: OpenRouterBudgetDiagnostic) => void;
}

function isPayloadRecord(value: unknown): value is PayloadRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readPositiveInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function selectOutputTokenField(payload: PayloadRecord): OpenRouterOutputTokenField {
  if (Object.prototype.hasOwnProperty.call(payload, "max_tokens")) return "max_tokens";
  if (Object.prototype.hasOwnProperty.call(payload, "max_completion_tokens")) return "max_completion_tokens";
  return "max_tokens";
}

/** Return the original payload when no rewrite is needed; otherwise shallow-clone it. */
export function filterOpenRouterRequestPayload(
  payload: unknown,
  provider: string | null | undefined,
  modelId: string | null | undefined,
  options: OpenRouterRequestFilterOptions,
): unknown {
  if (provider !== "openrouter" || !isPayloadRecord(payload)) return payload;

  const field = selectOutputTokenField(payload);
  const explicitLimit = readPositiveInteger(payload[field]);
  const configuredLimit = Math.max(1, Math.floor(options.configuredDefaultMaxTokens));
  const activeLimit = options.state?.adaptiveLimit ?? configuredLimit;
  const appliedLimit = explicitLimit === null ? activeLimit : Math.min(explicitLimit, activeLimit);

  if (options.state) {
    options.state.lastOriginalLimit = explicitLimit;
    options.state.lastAppliedLimit = appliedLimit;
    options.state.lastTokenField = field;
  }

  const adaptiveRetry = options.state?.adaptiveLimit !== null && options.state?.adaptiveLimit !== undefined;
  const changed = explicitLimit === null || explicitLimit > activeLimit;
  if (!changed) return payload;

  const reason: OpenRouterBudgetDiagnostic["reason"] = adaptiveRetry
    ? "adaptive_retry"
    : explicitLimit === null
      ? "initial_default"
      : "initial_clamp";
  options.onApplied?.({
    provider: "openrouter",
    modelId: modelId ?? null,
    originalLimit: explicitLimit,
    appliedLimit,
    reason,
    attempt: Math.max(1, options.state?.requestAttempt ?? 1),
    field,
  });
  return { ...payload, [field]: appliedLimit };
}

export const openRouterRequestFilter: ExtensionFactory = (pi) => {
  pi.on("before_provider_request", async (event, ctx) => filterOpenRouterRequestPayload(
    event.payload,
    ctx.model?.provider,
    ctx.model?.id,
    {
      configuredDefaultMaxTokens: getToolsIntegrationConfig().openRouterDefaultMaxTokens,
      state: getOpenRouterOutputBudgetState(),
      onApplied: (diagnostic) => {
        log.info("Applied OpenRouter output budget", {
          operation: "openrouter.output_budget_applied",
          ...diagnostic,
        });
      },
    },
  ));
};
