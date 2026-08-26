import { AsyncLocalStorage } from "node:async_hooks";

export const OPENROUTER_DEFAULT_MAX_TOKENS = 32_768;
export const OPENROUTER_MIN_ADAPTIVE_MAX_TOKENS = 1_024;
const OPENROUTER_MAX_PARSED_TOKENS = 10_000_000;

export type OpenRouterOutputTokenField = "max_tokens" | "max_completion_tokens";

export interface OpenRouterOutputBudgetState {
  chatJid: string;
  turnId: string | null;
  requestAttempt: number;
  adaptiveRetryAttempted: boolean;
  adaptiveLimit: number | null;
  lastAppliedLimit: number | null;
  lastOriginalLimit: number | null;
  lastTokenField: OpenRouterOutputTokenField | null;
}

export interface OpenRouterAffordabilityError {
  requested: number;
  affordable: number;
}

export type OpenRouterAffordabilityDecision =
  | { kind: "not_applicable" }
  | { kind: "retry"; requested: number; affordable: number; appliedLimit: number; detail: string }
  | { kind: "terminal"; requested?: number; affordable?: number; detail: string; reason: string };

const outputBudgetStorage = new AsyncLocalStorage<OpenRouterOutputBudgetState>();

export function createOpenRouterOutputBudgetState(chatJid: string, turnId?: string | null): OpenRouterOutputBudgetState {
  return {
    chatJid,
    turnId: turnId ?? null,
    requestAttempt: 0,
    adaptiveRetryAttempted: false,
    adaptiveLimit: null,
    lastAppliedLimit: null,
    lastOriginalLimit: null,
    lastTokenField: null,
  };
}

export function withOpenRouterOutputBudgetState<T>(
  state: OpenRouterOutputBudgetState,
  callback: () => T,
): T {
  return outputBudgetStorage.run(state, callback);
}

export function getOpenRouterOutputBudgetState(): OpenRouterOutputBudgetState | undefined {
  return outputBudgetStorage.getStore();
}

export function beginOpenRouterRequestAttempt(state: OpenRouterOutputBudgetState): number {
  state.requestAttempt += 1;
  return state.requestAttempt;
}

function parseBoundedPositiveInteger(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > OPENROUTER_MAX_PARSED_TOKENS) return null;
  return parsed;
}

export function isOpenRouterHttp402(errorText: string | null | undefined): boolean {
  const value = String(errorText || "").trim();
  return /^(?:openrouter\s+)?(?:http\s*)?402\b/i.test(value)
    || /\bHTTP\s+402\b/i.test(value);
}

/** Parse only OpenRouter's bounded max-token affordability sentence. */
export function parseOpenRouterAffordabilityError(errorText: string | null | undefined): OpenRouterAffordabilityError | null {
  const value = String(errorText || "").trim().slice(0, 16_384);
  if (!isOpenRouterHttp402(value)) return null;
  const match = /This request requires more credits, or fewer max_tokens\.\s*You requested up to\s+(\d+)\s+tokens, but can only afford\s+(\d+)\b/i.exec(value);
  if (!match) return null;
  const requested = parseBoundedPositiveInteger(match[1] ?? "");
  const affordable = parseBoundedPositiveInteger(match[2] ?? "");
  if (requested === null || affordable === null) return null;
  return { requested, affordable };
}

export function sanitizeOpenRouterProviderErrorText(
  errorText: string,
  modelLabel: string | null,
): string {
  if (!modelLabel?.startsWith("openrouter/") || !isOpenRouterHttp402(errorText)) return errorText;
  const parsed = parseOpenRouterAffordabilityError(errorText.slice(0, 16_384));
  if (!parsed) return "OpenRouter rejected the request with HTTP 402; provider response details were omitted.";
  return `OpenRouter output budget rejected (HTTP 402): requested ${parsed.requested} tokens; affordable ${parsed.affordable} tokens.`;
}

export function decideOpenRouterAffordabilityRetry(
  errorText: string | null | undefined,
  modelLabel: string | null,
  state: OpenRouterOutputBudgetState | undefined,
): OpenRouterAffordabilityDecision {
  if (!modelLabel?.startsWith("openrouter/") || !isOpenRouterHttp402(errorText)) {
    return { kind: "not_applicable" };
  }

  const parsed = parseOpenRouterAffordabilityError(errorText);
  if (!parsed) {
    return {
      kind: "terminal",
      reason: "malformed_affordability_response",
      detail: "OpenRouter rejected the request with HTTP 402; no usable structured affordability limit was provided.",
    };
  }

  const detailPrefix = `OpenRouter output budget rejected (HTTP 402): requested ${parsed.requested} tokens; affordable ${parsed.affordable} tokens.`;
  if (!state || state.lastAppliedLimit === null || parsed.requested !== state.lastAppliedLimit) {
    return {
      kind: "terminal",
      requested: parsed.requested,
      affordable: parsed.affordable,
      reason: "request_limit_mismatch",
      detail: `${detailPrefix} The reported request limit did not match the active turn-scoped limit.`,
    };
  }
  if (state.adaptiveRetryAttempted) {
    return {
      kind: "terminal",
      requested: parsed.requested,
      affordable: parsed.affordable,
      reason: "adaptive_retry_exhausted",
      detail: `${detailPrefix} The single adaptive retry was exhausted.`,
    };
  }

  const appliedLimit = Math.min(state.lastAppliedLimit, Math.floor(parsed.affordable * 0.9));
  if (!Number.isSafeInteger(appliedLimit) || appliedLimit < OPENROUTER_MIN_ADAPTIVE_MAX_TOKENS) {
    return {
      kind: "terminal",
      requested: parsed.requested,
      affordable: parsed.affordable,
      reason: "adaptive_limit_too_small",
      detail: `${detailPrefix} The safe adaptive limit would be below ${OPENROUTER_MIN_ADAPTIVE_MAX_TOKENS} tokens.`,
    };
  }
  if (appliedLimit >= state.lastAppliedLimit) {
    return {
      kind: "terminal",
      requested: parsed.requested,
      affordable: parsed.affordable,
      reason: "adaptive_limit_not_reducing",
      detail: `${detailPrefix} The reported affordable limit would not reduce the request.`,
    };
  }

  state.adaptiveRetryAttempted = true;
  state.adaptiveLimit = appliedLimit;
  return {
    kind: "retry",
    requested: parsed.requested,
    affordable: parsed.affordable,
    appliedLimit,
    detail: `${detailPrefix} Retrying once with a ${appliedLimit}-token ceiling.`,
  };
}
