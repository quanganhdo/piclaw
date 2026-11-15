// Historical opaque-string regression oracle, excluded from production.
// Original: fc587de57 runtime/src/agent-pool/recovery-classification.ts.
// Its 57 moved physical / 51 nonblank lines receive no reduction credit.
import { isOrphanFunctionCallOutputError } from "../../src/utils/provider-payload-errors.js";
import type { AgentFailureCategory } from "../../src/agent-pool/contracts.js";

export function isContextPressureFailure(errorText: string | null | undefined): boolean {
  if (!errorText) return false;
  return /context(?: window| length)?|maximum context length|context_length|token limit|too many tokens|prompt too long|reduce (?:the )?length|overflow|request too large/i.test(errorText);
}

export function isTransientFailure(errorText: string | null | undefined): boolean {
  if (!errorText) return false;
  return /timed out|timeout|before finalization|connection (?:error|ended|closed|lost)|websocket.*(?:closed|ended|1006)|fetch failed|socket hang up|econnreset|econnrefused|etimedout|enotfound|eai_again|getaddrinfo|dns lookup|502|503|504|temporary|temporarily unavailable|try again|rate limit|too many requests|\b429\b|overloaded|server error/i.test(errorText);
}

export function isLengthStopFailure(errorText: string | null | undefined): boolean {
  if (!errorText || isContextPressureFailure(errorText)) return false;
  return /finish[_ -]?reason\s*:?\s*length|stop\s*reason\s*:?\s*length|\bstopReason\s*:?\s*length|max(?:imum)? output (?:tokens?|length)|output token limit|hit (?:the )?(?:maximum )?output/i.test(errorText);
}

export function isProviderAuthConfigFailure(errorText: string | null | undefined): boolean {
  if (!errorText) return false;
  return /no api key for provider|no api key found|token refresh failed\s*:\s*401|authentication failed|credentials may have expired|re-authenticate|unauthorized|\b401\b|\b403\b|invalid.*api.*key|api.*key.*invalid|token.*expired|oauth.*expired|refresh.*token|provider login required|auth.*expired|missing provider credential|missing provider config|provider is not configured|provider\.getApiKey is not a function/i.test(errorText);
}

export function isNonRecoverableFailure(errorText: string | null | undefined): boolean {
  if (!errorText) return false;
  return isOrphanFunctionCallOutputError(errorText)
    || /request was aborted|\baborted\b|no model selected|select a model|use \/model|use \/login|model not found|deployment.*not found|policy|safety|blocked by policy|invalid_request_error|malformed|schema|unsupported model|capability mismatch|permission denied|missing required file|file not found/i.test(errorText);
}

/**
 * Classify opaque provider/runtime errors once, at the boundary where only a
 * string is available. Downstream recovery and UI code consume the resulting
 * enum and never reinterpret assistant result prose.
 */
export function classifyOpaqueAgentFailure(errorText: string | null | undefined): AgentFailureCategory {
  const value = String(errorText || "").trim();
  if (!value) return "unknown";
  // Match the credential facade's static boundary before provider/auth heuristics.
  if (/Model credential (?:storage|resolution) unavailable\./.test(value)) return "credential_storage";
  if (value.startsWith("PICLAW-BUDGET-BLOCKED:")) return "provider_budget";
  if (/stale-progress watchdog/i.test(value)) return "stalled_work";
  if (isOrphanFunctionCallOutputError(value)) return "session_corruption";
  // A 5xx response reached the provider and failed transiently; even during
  // OAuth refresh, it is not evidence that credentials have expired.
  if (/\b5\d\d\b|bad gateway|service unavailable|gateway timeout|overloaded|server error/i.test(value)) return "network";
  if (isProviderAuthConfigFailure(value)) return "auth_config";
  if (isContextPressureFailure(value)) return "context_pressure";
  if (isLengthStopFailure(value)) return "output_limit";
  if (/rate limit|too many requests|\b429\b/i.test(value)) return "rate_limit";
  if (/request was aborted|\baborterror\b|\baborted\b/i.test(value)) return "aborted";
  if (/timed out|timeout/i.test(value)) return "timeout";
  if (/connection (?:error|ended|closed|lost)|websocket.*(?:closed|ended|1006)|fetch failed|socket hang up|econnreset|econnrefused|etimedout|enotfound|eai_again|getaddrinfo|dns lookup|502|503|504|temporary|temporarily unavailable|overloaded|server error/i.test(value)) return "network";
  if (/already processing/i.test(value)) return "already_processing";
  if (/no api provider/i.test(value)) return "provider_unavailable";
  if (isNonRecoverableFailure(value)) return "non_recoverable";
  return "provider";
}
