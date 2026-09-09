/**
 * runtime/extensions/integrations/azure-openai.ts – Azure OpenAI / Foundry extension.
 *
 * This is the production integration layer for Azure-backed models in piclaw.
 * It does more than transport:
 *
 * - registers Azure OpenAI and Azure AI Foundry providers with custom API names
 * - acquires auth via managed identity or static API key
 * - normalizes/sanitizes replayed Responses input for Azure's stricter validation
 * - preserves GPT-5.3 Codex phase metadata across turns
 * - trims tool-heavy histories proactively to avoid Azure request-limit failures
 * - surfaces Azure-specific retry/throttle behavior in a user-friendly way
 *
 * Keep this file focused on Azure-specific behavior. Generic Responses helpers
 * belong in runtime/src/extensions/azure-openai-api.ts and generic trimming
 * utilities belong in runtime/src/utils/azure-tool-call-limit.ts.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Api, Model, Provider } from "@earendil-works/pi-ai";

type AzureProviderConfig = Parameters<ExtensionAPI["registerProvider"]>[1];
type AzureProviderConfigRegistrar = (name: string, config: AzureProviderConfig) => void;
type AzureNativeProviderRegistrar = (provider: Provider) => void;
import OpenAI from "openai";
import {
  AssistantMessageEventStream,
  getSupportedThinkingLevels,
  type AssistantMessage,
  type ToolCall,
  type ToolResultMessage,
} from "@earendil-works/pi-ai";
import {
  applySessionCorrelationHeaders,
  applyToolCallLimit,
  buildBaseOptions,
  clampReasoning,
  convertResponsesMessages,
  convertResponsesTools,
  processResponsesStream,
  resolveCacheSessionId,
} from "../../src/extensions/azure-openai-api.js";
import { estimateAzureRequestTokens } from "../../src/utils/azure-tool-call-limit.js";
import { streamSimple as streamSimpleOpenAICompletions } from "@earendil-works/pi-ai/api/openai-completions";
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const PROVIDER = "azure-openai";
const FOUNDRY_PROVIDER = "azure-foundry";
// Use custom API names so we don't override global handlers.
const AZURE_API = "azure-openai-responses-mi";
const FOUNDRY_API = "azure-foundry-openai-completions-mi";

// Pitfalls / guardrails:
// - Never use api: "openai-responses" or "openai-completions" here. That overrides the global
//   handlers and breaks other providers (e.g., GitHub Copilot). Always use AZURE_API/FOUNDRY_API.
// - Always set per-model `api` to the custom API names. If you omit it, the model will route
//   through the global handlers and fail with auth errors.
// - OpenAI SDK always injects `Authorization: Bearer <apiKey>`. Do not add Authorization/api-key
//   headers yourself or enable authHeader; Azure/Copilot will reject the request.
// - Managed identity only. AOAI_RESOURCE/FOUNDRY_RESOURCE must match the target resource or
//   tokens will be invalid (401/403).
// - MODEL_SPECS.reasoning=false will clamp thinking to off for that model.
// - Do not remove tool-call ID sanitization or TOOL_CALL_PROVIDERS; Azure Responses rejects
//   non-compliant IDs.
const MODEL_ID = process.env.AOAI_MODEL_ID || "gpt-5-2-codex";
const MODEL_NAME = process.env.AOAI_MODEL_NAME || `Azure ${MODEL_ID}`;
const MODEL_IDS = (process.env.AOAI_MODEL_IDS || MODEL_ID)
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const MODEL_NAMES = (process.env.AOAI_MODEL_NAMES || "")
  .split(",")
  .map((entry) => entry.trim());
const BASE_URL = process.env.AOAI_BASE_URL || "https://{RESOURCE_NAME}.openai.azure.com/openai/v1";
const FOUNDRY_BASE_URL =
  process.env.FOUNDRY_BASE_URL || "https://{FOUNDRY_RESOURCE}.cognitiveservices.azure.com/openai/v1";
// Secondary Azure OpenAI endpoint (e.g. a different region). Optional.
// AOAI2_BASE_URL, AOAI2_MODEL_IDS, AOAI2_MODEL_NAMES follow the same pattern as the primary.
const AOAI2_BASE_URL = process.env.AOAI2_BASE_URL || "";
const AOAI2_PROVIDER = "azure-openai-2";
const AOAI2_API = "azure-openai-responses-mi-2";
const AOAI2_MODEL_IDS = (process.env.AOAI2_MODEL_IDS || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const AOAI2_MODEL_NAMES = (process.env.AOAI2_MODEL_NAMES || "")
  .split(",")
  .map((entry) => entry.trim());
const FOUNDRY_MODEL_IDS = (process.env.FOUNDRY_MODEL_IDS || "mistral-large-3,flux-2-pro")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const FOUNDRY_MODEL_NAMES = (process.env.FOUNDRY_MODEL_NAMES || "")
  .split(",")
  .map((entry) => entry.trim());
const FOUNDRY_IMAGE_MODEL_ID = process.env.FOUNDRY_IMAGE_MODEL_ID || "flux-2-pro";
const FOUNDRY_TEXT_MODEL_IDS = FOUNDRY_MODEL_IDS.filter(
  (id) => id !== FOUNDRY_IMAGE_MODEL_ID && !id.startsWith("flux-")
);
// Auth: managed identity by default — fetches AAD tokens from the VM metadata service.
// When AOAI_API_KEY is set, uses the static key instead (proxy mode — a remote proxy
// handles MI auth and this instance just passes the shared secret as a Bearer token).
const IMDS_URL = "http://169.254.169.254/metadata/identity/oauth2/token";
const IMDS_API_VERSION = "2018-02-01";
const RESOURCE = process.env.AOAI_RESOURCE || process.env.FOUNDRY_RESOURCE || "https://cognitiveservices.azure.com/";
const ARM_RESOURCE = "https://management.azure.com/";
const ARM_API_VERSION = process.env.AOAI_ARM_API_VERSION || "2023-05-01";
const AOAI_ACCOUNT_NAME = process.env.AOAI_ACCOUNT_NAME || (() => {
  try {
    return new URL(BASE_URL).hostname.split(".")[0];
  } catch (error) {
    console.error("[azure-openai] Failed to derive AOAI account name from base URL:", error);
    return "";
  }
})();
const AOAI_RESOURCE_GROUP = process.env.AOAI_RESOURCE_GROUP || "";
const AOAI_SUBSCRIPTION_ID = process.env.AOAI_SUBSCRIPTION_ID || "";
const ENABLE_MODEL_CAPS = !/^(0|false|no)$/i.test(process.env.AOAI_ENABLE_MODEL_CAPS || "1");
const IMDS_METADATA_URL = "http://169.254.169.254/metadata/instance/compute";
const IMDS_METADATA_VERSION = "2021-02-01";
const CACHE_DIR = process.env.AOAI_TOKEN_CACHE_DIR || "/workspace/.piclaw/cache";
const CACHE_FILE = process.env.AOAI_TOKEN_CACHE_FILE || `${CACHE_DIR}/aoai-token.json`;
const SKEW_SECONDS = Number(process.env.AOAI_TOKEN_SKEW_SECONDS || "300");
// When AOAI_API_KEY is set, use it directly instead of fetching managed-identity tokens.
// This is used when connecting through a proxy that handles MI auth on our behalf.
const STATIC_API_KEY = process.env.AOAI_API_KEY || "";
const TOOL_CALL_PROVIDERS = new Set(["openai", "openai-codex", "opencode-zen", PROVIDER, FOUNDRY_PROVIDER, AOAI2_PROVIDER]);
const DISABLE_TOOLS = /^(1|true|yes)$/i.test(process.env.AOAI_DISABLE_TOOLS || "");
const DISABLE_REASONING = /^(1|true|yes)$/i.test(process.env.AOAI_DISABLE_REASONING || "");
const TOOL_CALL_LIMIT = parseInt(process.env.AOAI_MAX_TOOL_CALLS || "96", 10);
const TOOL_CALL_SUMMARY_MAX = parseInt(process.env.AOAI_TOOL_CALL_SUMMARY_MAX || "12", 10);
const TOOL_CALL_OUTPUT_CHARS = parseInt(process.env.AOAI_TOOL_CALL_OUTPUT_CHARS || "200", 10);
const DEDUPE_TOOL_OUTPUT_SEARCH = !/^(0|false|no)$/i.test(process.env.AOAI_DEDUPE_TOOL_OUTPUT_SEARCH || "1");
const MODEL_TOOL_CALL_LIMITS: Record<string, number> = {
  "gpt-5-4": 48,
  "gpt-5-4-pro": 32,
};

// Slice 1 — Responses-only models: these MUST use the Responses API and never
// fall through to chat completions. The extension already routes all Azure OpenAI
// models through Responses, so this is a guardrail assertion, not a routing change.
const RESPONSES_ONLY_MODELS = new Set([
  "gpt-5-4-pro",
]);

// Slice 2 — Per-model reasoning cap for tool-heavy flows.
// Harness evidence (2026-03-10): gpt-5-mini at reasoning=high fails ~50% of
// multi-round tool calls (missing_tool_call). Stable at minimal and medium.
// Cap tool-flow reasoning to 'medium' for affected models.
const MODEL_TOOL_FLOW_REASONING_CAP: Record<string, string> = {
  "gpt-5-mini": "medium",
};

const EFFORT_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/**
 * Cap reasoning effort for models with known tool-flow instability at higher levels.
 * Returns the original effort if no cap applies, or the capped value if it exceeds
 * the model's safe maximum for tool-heavy contexts.
 */
export function capToolFlowReasoning(modelId: string, effort: string, hasTools: boolean): string {
  if (!hasTools) return effort;
  const cap = MODEL_TOOL_FLOW_REASONING_CAP[modelId];
  if (!cap) return effort;
  const capIdx = EFFORT_ORDER.indexOf(cap as typeof EFFORT_ORDER[number]);
  const curIdx = EFFORT_ORDER.indexOf(effort as typeof EFFORT_ORDER[number]);
  if (capIdx >= 0 && curIdx > capIdx) return cap;
  return effort;
}

// Preflight input-budget guard:
// We proactively trim replayed tool history before sending when the estimated
// input size would consume too much of the deployment's per-minute TPM budget.
// When live deployment TPM is unavailable (common in proxy/static-key mode),
// do not let stale baked-in TPM defaults collapse a million-token model into a
// 65k replay budget. In that case, fall back to the model's registered context
// window with a reserved output headroom.
const MAX_TPM_SHARE = Math.min(0.95, Math.max(0.1, Number(process.env.AOAI_MAX_TPM_SHARE || "0.65")));
const ABSOLUTE_INPUT_TOKEN_CAP = Math.max(16000, Number(process.env.AOAI_ABSOLUTE_INPUT_TOKEN_CAP || "120000"));
const CONTEXT_AWARE_INPUT_TOKEN_CAP = Math.max(
  ABSOLUTE_INPUT_TOKEN_CAP,
  Number(process.env.AOAI_CONTEXT_AWARE_INPUT_TOKEN_CAP || "900000")
);
const CONTEXT_OUTPUT_RESERVE = Math.max(16000, Number(process.env.AOAI_CONTEXT_OUTPUT_RESERVE || "65536"));

export const AZURE_RATE_LIMIT_BACKOFF_MS = 15_000;

function getHeaderValue(headers: unknown, key: string): string | null {
  if (!headers || typeof headers !== "object") return null;
  const lookup = key.toLowerCase();
  const getter = (headers as { get?: unknown }).get;
  if (typeof getter === "function") {
    const value = getter.call(headers, key) ?? getter.call(headers, lookup);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const entries = typeof (headers as { entries?: unknown }).entries === "function"
    ? Array.from((headers as { entries: () => Iterable<[string, unknown]> }).entries())
    : Object.entries(headers as Record<string, unknown>);
  for (const [headerKey, value] of entries) {
    if (headerKey.toLowerCase() !== lookup) continue;
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const first = value.find((entry) => typeof entry === "string" && entry.trim());
      if (typeof first === "string") return first.trim();
    }
  }
  return null;
}

export function parseRetryAfterMs(retryAfter: string | null | undefined, nowMs = Date.now()): number | null {
  if (typeof retryAfter !== "string") return null;
  const trimmed = retryAfter.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return Math.max(0, Number.parseInt(trimmed, 10) * 1000);
  const absoluteMs = Date.parse(trimmed);
  if (!Number.isFinite(absoluteMs)) return null;
  return Math.max(0, absoluteMs - nowMs);
}

function getErrorStatus(error: unknown): number | null {
  const err = error as { status?: unknown; response?: { status?: unknown } } | null | undefined;
  const status = Number(err?.status ?? err?.response?.status);
  return Number.isFinite(status) ? status : null;
}

function getErrorHeaders(error: unknown): unknown {
  const err = error as { headers?: unknown; response?: { headers?: unknown } } | null | undefined;
  return err?.headers ?? err?.response?.headers;
}

function getErrorDetails(error: unknown): string {
  const err = error as { message?: unknown; name?: unknown; code?: unknown } | null | undefined;
  return [err?.name, err?.code, err?.message]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

export function isAzureRateLimitRequestError(error: unknown): boolean {
  return getErrorStatus(error) === 429 || /rate[ -]?limit|too many requests|ResourceExhausted/i.test(getErrorDetails(error));
}

export function isAzureRetryableRequestError(error: unknown): boolean {
  const status = getErrorStatus(error);
  if (status === 408 || status === 409 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || status === 524) {
    return true;
  }

  return /socket connection was closed(?: unexpectedly)?|ResourceExhausted/i.test(getErrorDetails(error));
}

export function resolveAzureRetryDelayMs(options: { attempt: number; error: unknown; nowMs?: number }): number | null {
  if (!isAzureRetryableRequestError(options.error)) return null;
  const retryAfterMs = parseRetryAfterMs(getHeaderValue(getErrorHeaders(options.error), "retry-after"), options.nowMs);
  if (retryAfterMs !== null) return retryAfterMs;
  const status = getErrorStatus(options.error);
  if (status === 503 || isAzureRateLimitRequestError(options.error)) return AZURE_RATE_LIMIT_BACKOFF_MS;
  return Math.max(2000, (options.attempt + 1) * 2000);
}

export function parseAzureDeploymentNameMap(value?: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!value) return map;
  for (const entry of value.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const [modelId, deploymentName] = trimmed.split("=", 2).map((part) => part?.trim());
    if (!modelId || !deploymentName) continue;
    map.set(modelId, deploymentName);
  }
  return map;
}

export function resolveAzureDeploymentName(modelId: string, mapValue?: string): string {
  const effectiveMap = mapValue ?? process.env.AOAI_DEPLOYMENT_NAME_MAP ?? process.env.AZURE_OPENAI_DEPLOYMENT_NAME_MAP ?? "";
  return parseAzureDeploymentNameMap(effectiveMap).get(modelId) || modelId;
}

export function resolveAzureModelIdForDeployment(deploymentName: string, mapValue?: string): string {
  const effectiveMap = mapValue ?? process.env.AOAI_DEPLOYMENT_NAME_MAP ?? process.env.AZURE_OPENAI_DEPLOYMENT_NAME_MAP ?? "";
  for (const [modelId, configuredDeployment] of parseAzureDeploymentNameMap(effectiveMap)) {
    if (configuredDeployment === deploymentName) return modelId;
  }
  return deploymentName;
}

export function formatAzureRetryDelay(delayMs: number | null | undefined): string | null {
  if (typeof delayMs !== "number" || !Number.isFinite(delayMs)) return null;
  const seconds = Math.max(0, Math.ceil(delayMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function hasRetryAfterHeader(error: unknown): boolean {
  return getHeaderValue(getErrorHeaders(error), "retry-after") !== null;
}

function describeAzureModel(modelId: string, deploymentName: string): string {
  return deploymentName && deploymentName !== modelId
    ? `model ${modelId} (deployment ${deploymentName})`
    : `model/deployment ${modelId}`;
}

export function formatAzureRateLimitMessage(options: {
  modelId: string;
  deploymentName: string;
  retryDelayMs?: number | null;
  retryAfterHonored?: boolean;
  exhausted?: boolean;
  streamingTpm?: boolean;
}): string {
  const wait = formatAzureRetryDelay(options.retryDelayMs);
  const waitPart = wait
    ? `Wait about ${wait} before retrying${options.retryAfterHonored ? " (from Azure Retry-After)" : ""}.`
    : "Wait before retrying.";
  const retryPart = options.exhausted ? "Retry budget exhausted. " : "";
  const limitKind = options.streamingTpm ? "per-minute token budget" : "rate limit";
  return `${retryPart}Azure ${limitKind} exceeded for ${describeAzureModel(options.modelId, options.deploymentName)}. ${waitPart} Reduce conversation history or switch to another model.`;
}

/**
 * Derive a context-window-based replay budget for Azure models.
 *
 * This is used when live deployment TPM is unavailable or untrustworthy, such
 * as proxy/static-key mode. It keeps a chunk of output headroom while allowing
 * long-context models to actually use their advertised window.
 */
export function getAzureContextInputBudget(modelId: string): number {
  const spec = MODEL_SPECS[modelId];
  if (!spec?.contextWindow) return ABSOLUTE_INPUT_TOKEN_CAP;
  const maxTokens = spec.maxTokens || DEFAULT_AZURE_SPEC.maxTokens;
  const reserve = Math.max(16000, Math.min(CONTEXT_OUTPUT_RESERVE, maxTokens || CONTEXT_OUTPUT_RESERVE));
  return Math.max(16000, Math.min(CONTEXT_AWARE_INPUT_TOKEN_CAP, spec.contextWindow - reserve));
}

/**
 * Derive the proactive preflight budget for one Azure model.
 *
 * Prefer live deployment TPM caps when available. When we only have baked-in
 * fallback rate defaults, prefer the model's context window instead of an
 * artificially tiny TPM-derived budget.
 */
export function getAzureMaxEstimatedInputTokens(modelId: string): number {
  const contextBudget = getAzureContextInputBudget(modelId);
  const tpm = MODEL_RATE_LIMITS[modelId]?.tpm;
  const rateLimitSource = MODEL_RATE_LIMIT_SOURCES[modelId];
  if (rateLimitSource !== "live") return contextBudget;
  if (!tpm || !Number.isFinite(tpm) || tpm <= 0) return contextBudget;
  return Math.max(16000, Math.min(contextBudget, Math.floor(tpm * MAX_TPM_SHARE)));
}

export function getAzureResponsesTextConfig(textVerbosity?: string): { format: { type: "text" }; verbosity: "low" | "medium" | "high" } {
  const verbosity = textVerbosity === "low" || textVerbosity === "high" || textVerbosity === "medium"
    ? textVerbosity
    : "medium";
  return {
    format: { type: "text" },
    verbosity,
  };
}

export function getAzureResponsesReasoningConfig(
  modelId: string,
  options?: { reasoningEffort?: string | null; reasoningSummary?: string | null },
  toolsEnabled = false,
): { effort: string; summary: "auto" | "concise" | "detailed" } | null {
  if (!options?.reasoningEffort && !options?.reasoningSummary) return null;

  let effort = options.reasoningEffort || "medium";
  effort = capToolFlowReasoning(modelId, effort, toolsEnabled);

  const summary = options.reasoningSummary === "auto"
    || options.reasoningSummary === "concise"
    || options.reasoningSummary === "detailed"
    ? options.reasoningSummary
    : "concise";

  return { effort, summary };
}
const DISABLE_REASONING_MODELS = new Set(
  (process.env.AOAI_DISABLE_REASONING_MODELS || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
);
// Debug helper: log phase replay/persistence details when troubleshooting gpt-5.3-codex.
const LOG_PHASES = /^(1|true|yes)$/i.test(process.env.AOAI_LOG_PHASES || "");

// Per-model overrides: contextWindow, maxTokens, reasoning
// Sources: Azure docs (learn.microsoft.com/azure/ai-services/openai/concepts/models),
//          OpenRouter /api/v1/models (2026-03-07).
// All GPT-5 series: 400K context (272K input + 128K output), 1.05M coming soon.
// Mistral Large 3 (25.12): 262K context, 16K max output.
const BASE_MODEL_SPECS: Record<string, { contextWindow?: number; maxTokens?: number; reasoning?: boolean }> = {
  "gpt-5-2-codex":      { contextWindow: 400000, maxTokens: 128000, reasoning: true },
  "gpt-5-3-codex":      { contextWindow: 400000, maxTokens: 128000, reasoning: true },
  "gpt-5-1-codex-mini": { contextWindow: 400000, maxTokens: 100000, reasoning: true },
  "gpt-5-1-codex-max":  { contextWindow: 400000, maxTokens: 128000, reasoning: true },
  "gpt-5-1-codex":      { contextWindow: 400000, maxTokens: 128000, reasoning: true },
  "gpt-5-1":            { contextWindow: 400000, maxTokens: 128000, reasoning: true },
  "gpt-5":              { contextWindow: 400000, maxTokens: 128000, reasoning: true },
  "gpt-5-pro":          { contextWindow: 400000, maxTokens: 128000, reasoning: true },
  "gpt-5-mini":         { contextWindow: 400000, maxTokens: 128000, reasoning: true },
  "gpt-5-nano":         { contextWindow: 400000, maxTokens: 128000, reasoning: true },
  "gpt-5-chat":         { contextWindow: 128000, maxTokens: 16384,  reasoning: true },
  "gpt-5-1-chat":       { contextWindow: 128000, maxTokens: 16384,  reasoning: true },
  "gpt-5-2":            { contextWindow: 400000, maxTokens: 128000, reasoning: true },
  "gpt-5-2-chat":       { contextWindow: 128000, maxTokens: 16384,  reasoning: true },
  "gpt-5-3-chat":       { contextWindow: 128000, maxTokens: 16384,  reasoning: true },
  "gpt-5-4":            { contextWindow: 1050000, maxTokens: 128000, reasoning: true },
  "gpt-5-4-pro":        { contextWindow: 1050000, maxTokens: 128000, reasoning: true },
  "gpt-5-6":            { contextWindow: 1050000, maxTokens: 128000, reasoning: true },
  "gpt-5.6":            { contextWindow: 1050000, maxTokens: 128000, reasoning: true },
  "gpt-5.6-luna":       { contextWindow: 1050000, maxTokens: 128000, reasoning: true },
  "gpt-5.6-sol":        { contextWindow: 1050000, maxTokens: 128000, reasoning: true },
  "gpt-5.6-terra":      { contextWindow: 1050000, maxTokens: 128000, reasoning: true },
  "gpt-5-5":            { contextWindow: 1050000, maxTokens: 128000, reasoning: true },
  "gpt-5-5-pro":        { contextWindow: 1050000, maxTokens: 128000, reasoning: true },
  "gpt-5.5":            { contextWindow: 1050000, maxTokens: 128000, reasoning: true },
  "gpt-5.5-pro":        { contextWindow: 1050000, maxTokens: 128000, reasoning: true },
  "gpt-4o":             { contextWindow: 128000, maxTokens: 16384,  reasoning: false },
  "gpt-4o-mini":        { contextWindow: 128000, maxTokens: 16384,  reasoning: false },
  "gpt-4.1":            { contextWindow: 1048576, maxTokens: 32768, reasoning: false },
  "gpt-4.1-mini":       { contextWindow: 1048576, maxTokens: 32768, reasoning: false },
  "gpt-4.1-nano":       { contextWindow: 1048576, maxTokens: 32768, reasoning: false },
  "mistral-large-3":    { contextWindow: 262144, maxTokens: 16384,  reasoning: false },
  "flux-2-pro":         { contextWindow: 4096,   maxTokens: 4096,   reasoning: false },
};

type ModelCapability = {
  responses?: boolean;
  chatCompletion?: boolean;
};

type RateLimit = {
  rpm?: number;
  tpm?: number;
};

type RateLimitSource = "default" | "live";

const MODEL_RATE_LIMIT_DEFAULTS: Record<string, RateLimit> = {
  "gpt-4o": { rpm: 100, tpm: 100000 },
  "gpt-4o-mini": { rpm: 1000, tpm: 100000 },
  "gpt-5-1": { rpm: 1000, tpm: 100000 },
  "gpt-5-1-codex-mini": { rpm: 100, tpm: 100000 },
  "gpt-5-2-codex": { rpm: 1000, tpm: 100000 },
  "gpt-5-3-codex": { rpm: 1000, tpm: 100000 },
  "gpt-5-4": { rpm: 1000, tpm: 100000 },
  "gpt-5-4-pro": { rpm: 100, tpm: 100000 },
  "gpt-5-mini": { rpm: 100, tpm: 100000 },
};

let MODEL_SPECS = { ...BASE_MODEL_SPECS };
const MODEL_CAPABILITIES: Record<string, ModelCapability> = {};
const MODEL_RATE_LIMITS: Record<string, RateLimit> = { ...MODEL_RATE_LIMIT_DEFAULTS };
const MODEL_RATE_LIMIT_SOURCES: Record<string, RateLimitSource> = Object.fromEntries(
  Object.keys(MODEL_RATE_LIMIT_DEFAULTS).map((id) => [id, "default"])
) as Record<string, RateLimitSource>;
const DEFAULT_AZURE_SPEC = { contextWindow: 400000, maxTokens: 128000, reasoning: true };
const DEFAULT_FOUNDRY_SPEC = { contextWindow: 200000, maxTokens: 64000, reasoning: false };
let extensionLogged = false;

function logExtensionLoaded(): void {
  if (extensionLogged) return;
  extensionLogged = true;
  const summary = {
    provider: PROVIDER,
    foundryProvider: FOUNDRY_PROVIDER,
    api: AZURE_API,
    foundryApi: FOUNDRY_API,
    baseUrl: BASE_URL,
    foundryBaseUrl: FOUNDRY_BASE_URL,
    modelIds: MODEL_IDS,
    foundryModelIds: FOUNDRY_MODEL_IDS,
    aoai2ModelIds: AOAI2_MODEL_IDS,
    aoai2BaseUrl: AOAI2_BASE_URL || "(not set)",
    authMode: STATIC_API_KEY ? "api-key (proxy)" : "managed-identity",
    disableTools: DISABLE_TOOLS,
    disableReasoning: DISABLE_REASONING,
    disableReasoningModels: Array.from(DISABLE_REASONING_MODELS),
    bun: process.versions?.bun || null,
    node: process.versions?.node || null,
  };
  setTimeout(() => {
    try {
      console.error("[azure-openai] Extension loaded:", JSON.stringify(summary));
    } catch (error) {
      console.error("[azure-openai] Extension loaded (failed to serialize):", error);
    }
  }, 0);
}

function sanitizeOpenAIId(value?: string): string | undefined {
  if (!value) return value;
  let next = value.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+$/, "");
  if (next.length > 64) next = next.slice(0, 64).replace(/_+$/, "");
  return next;
}

/**
 * Recursively fix JSON Schema objects for Azure Responses API compliance.
 * Azure strictly validates tool parameter schemas and rejects shapes that
 * OpenAI and Anthropic silently accept, most commonly:
 * - `type: "array"` without an `items` property
 *
 * This runs on the converted tool definitions before they are sent in the
 * request so upstream tool registrations do not need to be Azure-aware.
 */
function sanitizeToolSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(sanitizeToolSchema);
  const result: Record<string, unknown> = { ...(schema as Record<string, unknown>) };
  if (result.type === "array" && !result.items) {
    result.items = {};
  }
  if (result.properties && typeof result.properties === "object" && !Array.isArray(result.properties)) {
    const fixed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(result.properties as Record<string, unknown>)) {
      fixed[key] = sanitizeToolSchema(value);
    }
    result.properties = fixed;
  }
  if (result.items && typeof result.items === "object") {
    result.items = sanitizeToolSchema(result.items);
  }
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    if (Array.isArray(result[key])) {
      result[key] = (result[key] as unknown[]).map(sanitizeToolSchema);
    }
  }
  return result;
}

type ArmContext = {
  subscriptionId: string;
  resourceGroup: string;
  accountName: string;
};

async function fetchImdsText(path: string): Promise<string> {
  const url = `${IMDS_METADATA_URL}/${path}?api-version=${IMDS_METADATA_VERSION}&format=text`;
  const res = await fetch(url, { headers: { Metadata: "true" } });
  if (!res.ok) {
    throw new Error(`IMDS metadata request failed (${res.status}): ${path}`);
  }
  return (await res.text()).trim();
}

const IMDS_DETECT_TIMEOUT_MS = Number(process.env.AOAI_IMDS_TIMEOUT_MS || "500");
let azureEnvironmentCache: boolean | null = null;
let azureEnvironmentPromise: Promise<boolean> | null = null;

async function detectAzureEnvironment(): Promise<boolean> {
  if (azureEnvironmentCache !== null) return azureEnvironmentCache;
  if (azureEnvironmentPromise) return azureEnvironmentPromise;

  azureEnvironmentPromise = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), IMDS_DETECT_TIMEOUT_MS);
    try {
      const url = `${IMDS_METADATA_URL}/instanceId?api-version=${IMDS_METADATA_VERSION}&format=text`;
      const res = await fetch(url, { headers: { Metadata: "true" }, signal: controller.signal });
      if (!res.ok) return false;
      const text = (await res.text()).trim();
      return Boolean(text);
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error("[azure-openai] Azure environment detection failed:", error);
      }
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  })();

  azureEnvironmentCache = await azureEnvironmentPromise;
  return azureEnvironmentCache;
}

async function resolveArmContext(): Promise<ArmContext | null> {
  const accountName = AOAI_ACCOUNT_NAME.trim();
  if (!accountName) return null;
  let subscriptionId = AOAI_SUBSCRIPTION_ID.trim();
  let resourceGroup = AOAI_RESOURCE_GROUP.trim();

  if (!subscriptionId) {
    try {
      subscriptionId = await fetchImdsText("subscriptionId");
    } catch (error) {
      console.error("[azure-openai] Failed to resolve Azure subscriptionId from IMDS:", error);
      subscriptionId = "";
    }
  }

  if (!resourceGroup) {
    try {
      resourceGroup = await fetchImdsText("resourceGroupName");
    } catch (error) {
      console.error("[azure-openai] Failed to resolve Azure resourceGroupName from IMDS:", error);
      resourceGroup = "";
    }
  }

  if (!subscriptionId || !resourceGroup) return null;
  return { subscriptionId, resourceGroup, accountName };
}

async function fetchArmToken(): Promise<string> {
  const url = `${IMDS_URL}?api-version=${IMDS_API_VERSION}&resource=${encodeURIComponent(ARM_RESOURCE)}`;
  const response = await fetch(url, {
    headers: {
      Metadata: "true",
    },
  });
  if (!response.ok) {
    throw new Error(`IMDS ARM token request failed (${response.status})`);
  }
  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("IMDS ARM token response missing access_token");
  }
  return data.access_token;
}

async function fetchManagementJson<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`Azure management request failed (${res.status}): ${url}`);
  }
  return (await res.json()) as T;
}

async function fetchAzureModels(ctx: ArmContext, token: string): Promise<any[]> {
  const url = `https://management.azure.com/subscriptions/${ctx.subscriptionId}/resourceGroups/${ctx.resourceGroup}/providers/Microsoft.CognitiveServices/accounts/${ctx.accountName}/models?api-version=${ARM_API_VERSION}`;
  const payload = await fetchManagementJson<{ value?: any[] }>(url, token);
  return payload.value || [];
}

async function fetchAzureDeployments(ctx: ArmContext, token: string): Promise<any[]> {
  const url = `https://management.azure.com/subscriptions/${ctx.subscriptionId}/resourceGroups/${ctx.resourceGroup}/providers/Microsoft.CognitiveServices/accounts/${ctx.accountName}/deployments?api-version=${ARM_API_VERSION}`;
  const payload = await fetchManagementJson<{ value?: any[] }>(url, token);
  return payload.value || [];
}

function parseCapabilityNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function parseCapabilityBool(value: unknown): boolean | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return undefined;
}

/**
 * Merge live Azure catalog/deployment metadata into our static model tables.
 *
 * Static defaults keep the extension functional everywhere, but Azure can tell
 * us the actual deployment context window, output limit, supported API family,
 * and rate limits. When available, prefer those live values so downstream
 * request shaping and proactive trimming use the real deployment caps.
 */
export function applyAzureModelCaps(models: any[], deployments: any[], deploymentMapValue?: string): number {
  const capsByModel = new Map<string, { contextWindow?: number; maxTokens?: number; responses?: boolean; chatCompletion?: boolean }>();

  for (const model of models) {
    const name = model?.name ? String(model.name) : "";
    const version = model?.version ? String(model.version) : "";
    if (!name || !version) continue;
    const caps = model?.capabilities || {};
    const contextWindow =
      parseCapabilityNumber(caps.maxContextToken) ??
      parseCapabilityNumber(caps.maxContextTokens);
    const maxTokens =
      parseCapabilityNumber(caps.maxOutputToken) ??
      parseCapabilityNumber(caps.maxOutputTokens);
    const responses = parseCapabilityBool(caps.responses);
    const chatCompletion = parseCapabilityBool(caps.chatCompletion);
    if (!contextWindow && !maxTokens && responses === undefined && chatCompletion === undefined) continue;
    capsByModel.set(`${name}|${version}`, { contextWindow, maxTokens, responses, chatCompletion });
  }

  let updated = 0;
  for (const deployment of deployments) {
    const deploymentName = deployment?.name ? String(deployment.name) : "";
    const modelName = deployment?.properties?.model?.name ? String(deployment.properties.model.name) : "";
    const modelVersion = deployment?.properties?.model?.version ? String(deployment.properties.model.version) : "";
    if (!deploymentName || !modelName || !modelVersion) continue;

    const caps = capsByModel.get(`${modelName}|${modelVersion}`);
    if (!caps) continue;

    const modelId = resolveAzureModelIdForDeployment(deploymentName, deploymentMapValue);
    const existing = MODEL_SPECS[modelId] || {};
    const next = { ...existing } as { contextWindow?: number; maxTokens?: number; reasoning?: boolean };

    if (caps.contextWindow) next.contextWindow = caps.contextWindow;
    if (caps.maxTokens) next.maxTokens = caps.maxTokens;

    const existingCaps = MODEL_CAPABILITIES[modelId] || {};
    const nextCaps: ModelCapability = { ...existingCaps };
    if (caps.responses !== undefined) nextCaps.responses = caps.responses;
    if (caps.chatCompletion !== undefined) nextCaps.chatCompletion = caps.chatCompletion;

    const rateLimits = deployment?.properties?.rateLimits || [];
    let rpm: number | undefined;
    let tpm: number | undefined;
    for (const rl of rateLimits) {
      const key = rl?.key ? String(rl.key) : "";
      if (!key) continue;
      if (key === "request") rpm = parseCapabilityNumber(rl.count);
      if (key === "token") tpm = parseCapabilityNumber(rl.count);
    }

    const existingRates = MODEL_RATE_LIMITS[modelId] || {};
    const nextRates: RateLimit = { ...existingRates };
    if (rpm !== undefined) nextRates.rpm = rpm;
    if (tpm !== undefined) nextRates.tpm = tpm;

    const specChanged =
      next.contextWindow !== existing.contextWindow ||
      next.maxTokens !== existing.maxTokens;
    const capsChanged =
      nextCaps.responses !== existingCaps.responses ||
      nextCaps.chatCompletion !== existingCaps.chatCompletion;
    const ratesChanged =
      nextRates.rpm !== existingRates.rpm ||
      nextRates.tpm !== existingRates.tpm;

    if (specChanged) {
      MODEL_SPECS[modelId] = next;
    }
    if (capsChanged) {
      MODEL_CAPABILITIES[modelId] = nextCaps;
    }
    if (ratesChanged) {
      MODEL_RATE_LIMITS[modelId] = nextRates;
    }
    if (rpm !== undefined || tpm !== undefined) {
      MODEL_RATE_LIMIT_SOURCES[modelId] = "live";
    }
    if (specChanged || capsChanged || ratesChanged) {
      updated += 1;
    }
  }

  return updated;
}

let modelCapsLoaded = false;
let modelCapsPromise: Promise<void> | null = null;

/**
 * Best-effort live capability refresh.
 *
 * This only runs when:
 * - model-cap loading is enabled
 * - we are on Azure
 * - we are not in static-key mode
 *
 * In proxy/static-key mode this process cannot safely assume Azure management
 * access, so the extension falls back to baked-in defaults and env overrides.
 */
async function ensureAzureModelCaps(): Promise<void> {
  if (!ENABLE_MODEL_CAPS || STATIC_API_KEY) return;
  if (modelCapsLoaded) return;
  if (modelCapsPromise) return modelCapsPromise;

  modelCapsPromise = (async () => {
    const onAzure = await detectAzureEnvironment();
    if (!onAzure) return;

    const ctx = await resolveArmContext();
    if (!ctx) return;

    const token = await fetchArmToken();
    const [models, deployments] = await Promise.all([
      fetchAzureModels(ctx, token),
      fetchAzureDeployments(ctx, token),
    ]);

    const updated = applyAzureModelCaps(models, deployments);
    if (updated > 0) {
      console.error(`[azure-openai] Updated ${updated} model spec(s) from Azure catalog.`);
    }
  })()
    .catch((error) => {
      console.error("[azure-openai] Failed to load Azure model caps:", error);
    })
    .finally(() => {
      modelCapsLoaded = true;
    });

  return modelCapsPromise;
}

function logStreamFailureEvent(event: any, requestSummary?: Record<string, unknown>, loggedRef?: { logged: boolean }): void {
  if (!event || typeof event !== "object") return;
  const type = (event as { type?: string }).type;
  if (type === "response.failed") {
    const response = (event as { response?: any }).response;
    const error = response?.error || response?.status_details || response || event;
    console.error("[azure-openai] Stream response.failed:", JSON.stringify(error));
    if (requestSummary && loggedRef && !loggedRef.logged) {
      console.error("[azure-openai] Request summary:", JSON.stringify(requestSummary));
      loggedRef.logged = true;
    }
  }
  if (type === "error") {
    const { code, message, error } = event as { code?: string; message?: string; error?: unknown };
    console.error("[azure-openai] Stream error:", JSON.stringify({ code, message, error }));
    if (requestSummary && loggedRef && !loggedRef.logged) {
      console.error("[azure-openai] Request summary:", JSON.stringify(requestSummary));
      loggedRef.logged = true;
    }
  }
}

function getAzureErrorPayload(error: unknown): any {
  const err = error as { response?: any; error?: any } | null | undefined;
  return err?.response?.data?.error
    || err?.response?.data
    || err?.error?.error
    || err?.error
    || null;
}

export function formatAzureOpenAIError(error: unknown): string {
  if (error instanceof Error && /^(Azure request failed|Azure OpenAI error):/.test(error.message)) {
    return error.message;
  }

  const err = error as { message?: string; status?: number; code?: string; type?: string; response?: any } | null | undefined;
  const payload = getAzureErrorPayload(error);
  const status = err?.status ?? err?.response?.status ?? payload?.status ?? payload?.statusCode;
  const code = payload?.code ?? err?.code;
  const type = payload?.type ?? err?.type;
  const message = payload?.message
    ?? payload?.error_description
    ?? payload?.error
    ?? err?.message
    ?? String(error);

  const statusPart = typeof status === "number" && Number.isFinite(status) ? ` (${status})` : "";
  const meta = [code, type].filter(Boolean).join("/");
  const metaPart = meta ? ` [${meta}]` : "";
  return `Azure OpenAI API error${statusPart}${metaPart}: ${message}`;
}

function logAzureError(modelId: string, error: unknown, requestSummary?: Record<string, unknown>, loggedRef?: { logged: boolean }): void {
  const err = error as { name?: string; message?: string; status?: number; code?: string; type?: string; response?: any; error?: any };
  const details = {
    name: err?.name,
    message: err?.message ?? String(error),
    status: err?.status ?? err?.response?.status,
    code: err?.code,
    type: err?.type,
    response: err?.response?.data,
    error: err?.error,
    formatted: formatAzureOpenAIError(error),
  };
  console.error(`[azure-openai] Error for ${modelId}:`, JSON.stringify(details));
  if (requestSummary && loggedRef && !loggedRef.logged) {
    console.error("[azure-openai] Request summary:", JSON.stringify(requestSummary));
    loggedRef.logged = true;
  }
}

function isReasoningEnabled(model: Model<any>): boolean {
  if (!model?.reasoning) return false;
  if (DISABLE_REASONING) return false;
  if (DISABLE_REASONING_MODELS.has(model.id)) return false;
  return true;
}

// GPT-5.3 Codex introduces a `phase` field on assistant output items (commentary vs final_answer).
// The cookbook notes that integrations must persist this metadata and replay it on subsequent
// requests, or the model may exhibit degraded behavior or failures. We store `phase` on the
// text blocks we persist, then re-apply it to the outgoing Responses API input items.
function collectMessagePhases(messages: unknown[]): Map<string, string> {
  const phases = new Map<string, string>();
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    if ((msg as { role?: string }).role !== "assistant") continue;
    const content = (msg as { content?: Array<any> }).content || [];
    for (const block of content) {
      if (block?.type !== "text") continue;
      const id = block.textSignature;
      const phase = block.phase;
      if (id && typeof id === "string" && phase && typeof phase === "string") {
        phases.set(id, phase);
      }
    }
  }
  return phases;
}

// Apply stored phase metadata to assistant output items when reconstructing input for /responses.
function applyPhasesToResponseInput(items: Array<any>, phases: Map<string, string>): void {
  if (!phases.size) return;
  for (const item of items) {
    if (item?.type !== "message" || !item.id) continue;
    const phase = phases.get(item.id);
    if (phase) item.phase = phase;
  }
}

function stripOrphanReasoningItems(items: Array<any>): Array<any> {
  // Azure pairs reasoning items (rs_) with both messages (msg_) and function_calls (fc_).
  // We strip msg_ and fc_ IDs to avoid pairing validation errors, which makes ALL reasoning
  // items orphans. Strip them entirely — the model generates fresh reasoning each turn and
  // the encrypted_content blobs would just waste context tokens.
  if (!Array.isArray(items) || items.length === 0) return items;
  return items.filter((item) => item?.type !== "reasoning");
}

// After streaming completes, copy the phase from Responses output items onto our stored text blocks
// so future requests can replay it (phase is required for gpt-5.3-codex continuity).
function applyPhasesToOutputMessage(output: { content?: Array<any> }, phases: Map<string, string>): void {
  if (!phases.size || !output?.content) return;
  for (const block of output.content) {
    if (block?.type !== "text") continue;
    const id = block.textSignature;
    if (!id || typeof id !== "string") continue;
    const phase = phases.get(id);
    if (phase) block.phase = phase;
  }
}

// Produce a compact, log-friendly summary of phase metadata in outgoing ResponseInput items.
// We avoid logging content and only emit IDs + phase counts when AOAI_LOG_PHASES=1.
function summarizeResponseInputPhases(items: Array<any>): {
  total: number;
  counts: Record<string, number>;
  sample: Array<{ id: string; phase: string }>;
} {
  const counts: Record<string, number> = {};
  const sample: Array<{ id: string; phase: string }> = [];
  let total = 0;

  for (const item of items) {
    if (item?.type !== "message" || !item.id || !item.phase) continue;
    const phase = String(item.phase);
    counts[phase] = (counts[phase] || 0) + 1;
    total += 1;
    if (sample.length < 6) {
      sample.push({ id: String(item.id), phase });
    }
  }

  return { total, counts, sample };
}

function isSameModel(message: AssistantMessage, model: Model<any> | undefined): boolean {
  if (!model) return false;
  return message.provider === model.provider && message.api === model.api && message.model === model.id;
}

function stripToolCallItemId(id: string): { id: string; changed: boolean } {
  if (!id.includes("|")) return { id, changed: false };
  const [callId] = id.split("|");
  if (!callId || callId === id) return { id, changed: false };
  return { id: callId, changed: true };
}


export interface TokenCache {
  accessToken?: string;
  expiresOn?: string;
  expiresOnEpoch?: number;
}

let tokenCacheWriteSequence = 0;

type ImageArgs = {
  prompt: string;
  size?: string;
  count?: number;
  quality?: "low" | "medium" | "high";
  style?: "natural" | "vivid";
  transparent?: boolean;
};

function readCache(): TokenCache {
  try {
    const raw = readFileSync(CACHE_FILE, "utf-8");
    return JSON.parse(raw) as TokenCache;
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code !== "ENOENT") {
      console.error("[azure-openai] Failed to read token cache:", error);
    }
    return {};
  }
}

function isTokenValid(cache: TokenCache): boolean {
  if (!cache.accessToken || !cache.expiresOnEpoch) return false;
  const now = Math.floor(Date.now() / 1000);
  return cache.expiresOnEpoch - now > SKEW_SECONDS;
}

export function writeAzureTokenCacheFile(cacheFile: string, payload: TokenCache): void {
  const cacheDir = dirname(cacheFile);
  const temporaryFile = `${cacheFile}.${process.pid}.${Date.now()}.${++tokenCacheWriteSequence}.tmp`;
  mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(temporaryFile, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
    chmodSync(temporaryFile, 0o600);
    renameSync(temporaryFile, cacheFile);
    chmodSync(cacheFile, 0o600);
  } finally {
    rmSync(temporaryFile, { force: true });
  }
}

function writeCache(token: string, expiresOn: string | undefined, expiresOnEpoch: number): void {
  writeAzureTokenCacheFile(CACHE_FILE, { accessToken: token, expiresOn, expiresOnEpoch });
}

async function fetchTokenFromImds(): Promise<TokenCache> {
  const url = `${IMDS_URL}?api-version=${IMDS_API_VERSION}&resource=${encodeURIComponent(RESOURCE)}`;
  const response = await fetch(url, {
    headers: {
      Metadata: "true",
    },
  });
  if (!response.ok) {
    throw new Error(`IMDS token request failed (${response.status})`);
  }
  const data = (await response.json()) as {
    access_token?: string;
    expires_on?: string;
  };

  if (!data.access_token) {
    throw new Error("IMDS token response missing access_token");
  }

  const expiresRaw = data.expires_on || "";
  let expiresOnEpoch = Number(expiresRaw);
  if (!Number.isFinite(expiresOnEpoch)) {
    const parsed = Date.parse(expiresRaw);
    if (Number.isFinite(parsed)) {
      expiresOnEpoch = Math.floor(parsed / 1000);
    }
  }
  if (!Number.isFinite(expiresOnEpoch) || expiresOnEpoch <= 0) {
    expiresOnEpoch = Math.floor(Date.now() / 1000) + 3300;
  }

  writeCache(data.access_token, expiresRaw, expiresOnEpoch);
  return { accessToken: data.access_token, expiresOn: expiresRaw, expiresOnEpoch };
}

export function createAzureTokenRefreshCoalescer() {
  let inFlight: Promise<TokenCache> | null = null;
  const run = (refresh: () => Promise<TokenCache>): Promise<TokenCache> => {
    if (inFlight) return inFlight;
    const operation = Promise.resolve().then(refresh).finally(() => {
      if (inFlight === operation) inFlight = null;
    });
    inFlight = operation;
    return operation;
  };
  return { run, current: () => inFlight };
}

const tokenRefreshCoalescer = createAzureTokenRefreshCoalescer();
export function runAzureTokenRefresh(refresh: () => Promise<TokenCache>): Promise<TokenCache> {
  return tokenRefreshCoalescer.run(refresh);
}

async function ensureToken(force = false): Promise<TokenCache> {
  const active = tokenRefreshCoalescer.current();
  if (active) return active;
  const cached = readCache();
  if (!force && isTokenValid(cached)) return cached;

  return runAzureTokenRefresh(async () => {
    const latest = readCache();
    if (!force && isTokenValid(latest)) return latest;
    try {
      return await fetchTokenFromImds();
    } catch (error) {
      console.error("[azure-openai] Failed to refresh token via IMDS:", error);
      return latest.accessToken ? latest : cached;
    }
  });
}

export async function getAzureAccessToken(): Promise<string> {
  // When a static API key is configured (proxy mode), skip IMDS entirely.
  if (STATIC_API_KEY) return STATIC_API_KEY;

  const token = await ensureToken();
  if (!token.accessToken) {
    throw new Error("Missing Azure access token. Ensure IMDS is available.");
  }
  return token.accessToken;
}

function isAuthError(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  if (status === 401 || status === 403) return true;
  const message = error instanceof Error ? error.message : String(error || "");
  return /unauthorized|forbidden|401|403/i.test(message);
}

export function normalizeAzureOpenAIBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Invalid Azure OpenAI base URL: ${baseUrl}`);
  }

  const isAzureHost =
    url.hostname.endsWith(".openai.azure.com") ||
    url.hostname.endsWith(".cognitiveservices.azure.com") ||
    url.hostname.endsWith(".ai.azure.com");
  const normalizedPath = url.pathname.replace(/\/+$/, "");

  if (
    isAzureHost &&
    (normalizedPath === "" ||
      normalizedPath === "/" ||
      normalizedPath === "/openai" ||
      normalizedPath === "/openai/v1/responses")
  ) {
    url.pathname = "/openai/v1";
    url.search = "";
  }

  return url.toString().replace(/\/+$/, "");
}

// Build an OpenAI SDK client for Azure-style endpoints.
//
// Important: the SDK itself owns the Authorization header construction, so we
// pass an async apiKey getter and avoid layering our own auth headers on top.
// Adding manual Authorization/api-key headers here has historically broken
// Azure/Copilot compatibility.
function createAzureClient(baseUrl: string, headers: Record<string, string>) {
  return new OpenAI({
    apiKey: async () => await getAzureAccessToken(),
    baseURL: normalizeAzureOpenAIBaseUrl(baseUrl),
    defaultHeaders: headers,
    dangerouslyAllowBrowser: true,
  });
}

/**
 * Main Azure Responses stream wrapper.
 *
 * This is the most Azure-specific path in the extension. It reconstructs a
 * Responses request from piclaw session history, repairs replay artifacts that
 * Azure rejects, applies proactive history trimming, then runs the stream with
 * Azure-specific retry/error heuristics.
 */
function streamAzureOpenAIResponses(model: any, context: any, options: any) {
  const stream = new AssistantMessageEventStream();



  (async () => {
    const output = {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    };

    let requestSummary: Record<string, unknown> | undefined;
    const loggedRef = { logged: false };

    // Track the best error message extracted from stream events so we can
    // override pi-ai's generic "Unknown error" with something actionable.
    // Declared here so it's accessible in the catch block.
    let streamErrorDetail = "";

    try {
      const cacheSessionId = resolveCacheSessionId(options?.sessionId, options?.cacheRetention);
      const headers = { ...model.headers };
      if (options?.headers) {
        Object.assign(headers, options.headers);
      }
      for (const key of Object.keys(headers)) {
        const lower = key.toLowerCase();
        if (lower === "authorization" || lower === "api-key") {
          delete headers[key];
        }
      }
      Object.assign(headers, applySessionCorrelationHeaders(headers, cacheSessionId));

      // Pull any stored phase metadata from prior assistant messages, then apply it to the
      // reconstructed ResponseInput so gpt-5.3-codex sees the same phases on replay.
      const phaseById = collectMessagePhases(context.messages || []);
      // Reconstruct canonical Responses input from the mixed piclaw session
      // history. This includes prior assistant messages, user messages, and
      // tool-call/tool-result items across provider switches.
      const rawMessages = convertResponsesMessages(model, context, TOOL_CALL_PROVIDERS);

      // Sanitize function_call items: Azure Responses API requires `arguments` to be
      // a non-empty string. convertResponsesMessages may produce undefined arguments
      // when the stored toolCall.arguments is undefined (e.g. cross-provider replay,
      // empty-arg tool calls, or compaction artifacts). This causes silent
      // response.failed with error=null in streaming mode.
      for (const item of rawMessages) {
        if ((item as any).type === "function_call") {
          const args = (item as any).arguments;
          if (args === undefined || args === null) {
            (item as any).arguments = "{}";
          } else if (typeof args !== "string") {
            (item as any).arguments = JSON.stringify(args);
          }
        }
      }
      applyPhasesToResponseInput(rawMessages as Array<any>, phaseById);
      const toolCallLimit = MODEL_TOOL_CALL_LIMITS[model.id] ?? TOOL_CALL_LIMIT;
      // Apply two layers of proactive reduction before talking to Azure:
      //   1. hard cap the number of historical tool calls
      //   2. if the reconstructed request still looks too large for the model's
      //      TPM budget, keep trimming oldest tool history until it fits
      //
      // This is safer than relying on post-failure retries because Azure may
      // report token-budget exhaustion as a silent streaming failure.
      const maxEstimatedInputTokens = getAzureMaxEstimatedInputTokens(model.id);
      const toolCallTrim = applyToolCallLimit(rawMessages as Array<any>, {
        limit: toolCallLimit,
        summaryMax: TOOL_CALL_SUMMARY_MAX,
        outputChars: TOOL_CALL_OUTPUT_CHARS,
        dedupeToolOutputSearch: DEDUPE_TOOL_OUTPUT_SEARCH,
        maxEstimatedTokens: maxEstimatedInputTokens,
      });
      const messages = stripOrphanReasoningItems(toolCallTrim.messages);
      const phaseReplaySummary = LOG_PHASES ? summarizeResponseInputPhases(messages as Array<any>) : null;

      const messageTypeCounts = messages.reduce<Record<string, number>>((acc, item: any) => {
        const key = item?.type || item?.role || "unknown";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      const toolsEnabled = !DISABLE_TOOLS;
      const reasoningEnabled = isReasoningEnabled(model);
      requestSummary = {
        model: model.id,
        api: model.api,
        provider: model.provider,
        baseUrl: model.baseUrl,
        messageCount: messages.length,
        messageTypes: messageTypeCounts,
        toolCount: toolsEnabled && context.tools ? context.tools.length : 0,
        hasToolCalls: messages.some((item: any) => item?.type === "function_call"),
        toolCallLimit: toolCallLimit,
        toolCallTotal: toolCallTrim.toolCallTotal,
        toolCallKept: toolCallTrim.toolCallKept,
        toolCallRemoved: toolCallTrim.toolCallRemoved,
        toolCallDeduped: toolCallTrim.toolCallDeduped,
        toolCallBudgetRemoved: toolCallTrim.toolCallBudgetRemoved,
        toolCallSummary: Boolean(toolCallTrim.summaryText),
        estimatedInputTokensBeforeTrim: toolCallTrim.estimatedTokensBeforeTrim,
        estimatedInputTokensAfterTrim: toolCallTrim.estimatedTokensAfterTrim,
        estimatedInputTokenBudget: toolCallTrim.maxEstimatedTokens,
        budgetTrimApplied: toolCallTrim.budgetTrimApplied,
        reasoning: reasoningEnabled ? { effort: options?.reasoningEffort ?? null, summary: options?.reasoningSummary ?? null } : null,
        toolsEnabled,
        reasoningEnabled,
        // Phase replay summary is included only when AOAI_LOG_PHASES=1; omit otherwise.
        phaseReplay: phaseReplaySummary,
        storedPhaseCount: phaseById.size,
        promptCacheKey: cacheSessionId ?? null,
        requestHeaders: {
          session_id: headers.session_id ?? null,
          x_client_request_id: headers["x-client-request-id"] ?? null,
          x_ms_client_request_id: headers["x-ms-client-request-id"] ?? null,
        },
      };

      // Post-conversion sanitization for Azure OpenAI compatibility.
      // Azure requires: id/call_id max 64 chars, only [a-zA-Z0-9_-].
      // Additionally, Azure pairs rs_ reasoning items with msg_ messages AND
      // fc_ function_calls. Stripping reasoning items (to save tokens) makes
      // any msg_/fc_ IDs orphans. Strip those IDs so the API cannot enforce
      // the pairing validation (same approach as cross-provider replay).
      for (const item of messages) {
        if (item.id && typeof item.id === "string") {
          if ((item as any).type === "function_call" && (item.id as string).startsWith("fc_")) {
            (item as any).id = undefined;
          } else if ((item as any).type === "message" && (item.id as string).startsWith("msg_")) {
            (item as any).id = undefined;
          } else {
            const nextId = sanitizeOpenAIId(item.id);
            if (nextId) item.id = nextId;
          }
        }
        if (item.call_id && typeof item.call_id === "string") {
          const nextCallId = sanitizeOpenAIId(item.call_id);
          if (nextCallId) item.call_id = nextCallId;
        }
      }
      // Build the final Azure Responses payload only after all replay cleanup
      // and trimming decisions have been applied. Everything above this point
      // mutates the reconstructed history; everything below this point should
      // treat `messages` as the request we intend to send.
      const deploymentName = resolveAzureDeploymentName(model.id);
      if (requestSummary) requestSummary.deploymentName = deploymentName;
      const params: Record<string, any> = {
        model: deploymentName,
        input: messages,
        stream: true,
        store: false,
      };

      // prompt_cache_key enables server-side prefix caching — send for all models
      if (cacheSessionId) {
        params.prompt_cache_key = cacheSessionId;
      }

      // Reasoning-specific params
      if (reasoningEnabled) {
        params.text = getAzureResponsesTextConfig(options?.textVerbosity);
      }

      if (options?.maxTokens) {
        params.max_output_tokens = Math.max(options.maxTokens, 16);
      }
      if (options?.temperature !== undefined) {
        params.temperature = options?.temperature;
      }
      if (!DISABLE_TOOLS && context.tools) {
        const rawTools = convertResponsesTools(context.tools);
        // Sanitize tool schemas: Azure Responses API strictly validates JSON Schema
        // and rejects arrays without `items`, which other providers silently accept.
        params.tools = Array.isArray(rawTools)
          ? rawTools.map((tool: any) => {
              if (tool?.type === "function" && tool?.function?.parameters) {
                return { ...tool, function: { ...tool.function, parameters: sanitizeToolSchema(tool.function.parameters) } };
              }
              // Responses API tools use top-level `parameters` instead of nested `function`
              if (tool?.parameters) {
                return { ...tool, parameters: sanitizeToolSchema(tool.parameters) };
              }
              return tool;
            })
          : rawTools;
      } else if (DISABLE_TOOLS) {
        params.tool_choice = "none";
      }

      if (reasoningEnabled) {
        const reasoning = getAzureResponsesReasoningConfig(
          model.id,
          {
            reasoningEffort: options?.reasoningEffort ?? null,
            reasoningSummary: options?.reasoningSummary ?? null,
          },
          toolsEnabled && context.tools?.length > 0,
        );
        if (reasoning) {
          // Azure accepts reasoning.summary, but include=encryped_content has
          // historically triggered silent response.failed behavior in this
          // runtime path. Keep include disabled here unless a replay proves it
          // safe for our proxy/deployment mix.
          params.reasoning = reasoning;
        }
      }
      options?.onPayload?.(params);

      // Delay client creation until attempt time so refreshed tokens and any
      // per-attempt header changes are reflected on retries.
      const createStream = async () => {
        const client = createAzureClient(model.baseUrl, headers);
        return client.responses.create(
          params,
          options?.signal ? { signal: options.signal } : undefined
        );
      };

      await getAzureAccessToken();

      // Retry strategy:
      //   - MAX_RETRIES controls total retry attempts for transient errors.
      //   - When Azure returns an HTTP retryable error before the stream opens,
      //     honor Retry-After when present instead of falling straight through
      //     to an empty final error.
      //   - When a streaming response.failed arrives with error:null (the
      //     signature of Azure token-rate-limit exhaustion), use a longer
      //     backoff (RATE_LIMIT_BACKOFF_MS) because the per-minute token
      //     budget needs time to renew. Short retries only make it worse.
      //   - Client errors (4xx except retryable 408/409/425/429, invalid_request_error)
      //     are never retried.
      const MAX_RETRIES = 2;
      let streamStarted = false;

      const pushRetryNotice = (args: { attempt: number; delayMs: number; rateLimit: boolean; retryAfterHonored?: boolean }) => {
        if (!streamStarted) return;
        const wait = formatAzureRetryDelay(args.delayMs) || `${Math.round(args.delayMs / 1000)}s`;
        const retryMsg = args.rateLimit
          ? `\n\n> ⚡ Azure rate limit hit for ${describeAzureModel(model.id, deploymentName)} — waiting ${wait} before retry ${args.attempt + 1}/${MAX_RETRIES}${args.retryAfterHonored ? " (Retry-After)" : ""}…`
          : `\n\n> ⚠️ Azure request failed for ${describeAzureModel(model.id, deploymentName)} — retrying in ${wait} (${args.attempt + 1}/${MAX_RETRIES})…`;
        const retryContentIndex = output.content.length;
        output.content.push({ type: "text", text: retryMsg } as any);
        stream.push({ type: "text_start", contentIndex: retryContentIndex, partial: output });
        stream.push({ type: "text_delta", contentIndex: retryContentIndex, delta: retryMsg, partial: output });
        stream.push({ type: "text_end", contentIndex: retryContentIndex, content: retryMsg, partial: output });
      };

      const createStreamWithAuthRefresh = async () => {
        try {
          return await createStream();
        } catch (error) {
          if (!isAuthError(error)) throw error;
          if (!STATIC_API_KEY) await ensureToken(true);
          return await createStream();
        }
      };

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (options?.signal?.aborted) throw new Error("Request was aborted");

        // Reset per-attempt state
        streamErrorDetail = "";
        output.content = [];
        output.stopReason = "stop";
        (output as any).errorMessage = undefined;
        (output as any).reasoning = undefined;

        if (!streamStarted) {
          stream.push({ type: "start", partial: output });
          streamStarted = true;
        }

        // Track whether this failure looks like a token-budget exhaustion.
        // Azure surfaces per-minute TPM overruns as response.failed with
        // error:null in streaming mode (no 429, no Retry-After header).
        // The only external signal is x-ratelimit-remaining-tokens going
        // negative, but the OpenAI SDK does not expose response headers on
        // the streaming path. So we detect it by pattern: response.failed
        // with error:null AND empty output.
        let looksLikeRateLimit = false;

        let openaiStream;
        try {
          openaiStream = await createStreamWithAuthRefresh();
        } catch (error) {
          const delayMs = resolveAzureRetryDelayMs({ attempt, error });
          if (delayMs === null) throw error;
          const retryAfterHonored = hasRetryAfterHeader(error);
          looksLikeRateLimit = isAzureRateLimitRequestError(error);
          streamErrorDetail = looksLikeRateLimit
            ? formatAzureRateLimitMessage({
                modelId: model.id,
                deploymentName,
                retryDelayMs: delayMs,
                retryAfterHonored,
                exhausted: attempt >= MAX_RETRIES,
              })
            : formatAzureOpenAIError(error);

          if (attempt >= MAX_RETRIES) {
            const exhaustedDetail = looksLikeRateLimit
              ? streamErrorDetail
              : `Retry budget exhausted for ${describeAzureModel(model.id, deploymentName)}. ${streamErrorDetail}`;
            throw new Error(`Azure OpenAI error: ${exhaustedDetail}`);
          }

          console.error(`[azure-openai] Attempt ${attempt + 1}/${MAX_RETRIES + 1} failed before stream opened (${streamErrorDetail}), retrying in ${delayMs}ms...`);
          pushRetryNotice({ attempt, delayMs, rateLimit: looksLikeRateLimit, retryAfterHonored });
          loggedRef.logged = false;
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }

        const outputPhases = new Map<string, string>();

        const loggingStream = (async function* () {
          for await (const event of openaiStream) {
            if (event?.type === "response.output_item.added" || event?.type === "response.output_item.done") {
              const item = (event as { item?: any }).item;
              const phase = item?.phase;
              if (item?.type === "message" && item?.id && typeof phase === "string") {
                outputPhases.set(item.id, phase);
              }
            }

            if (event?.type === "response.failed") {
              const resp = (event as { response?: any }).response;
              const errObj = resp?.error;
              if (errObj && typeof errObj === "object") {
                streamErrorDetail = `${errObj.code || "error"}: ${errObj.message || JSON.stringify(errObj)}`;
              } else if (resp?.status) {
                streamErrorDetail = `Azure response failed (status: ${resp.status})`;
              } else {
                // response.failed with error:null and empty output is the
                // fingerprint of Azure streaming TPM exhaustion. Azure may
                // emit response.failed with error=null and no output instead
                // of a normal HTTP 429 / Retry-After in streaming mode. Flag
                // it so the retry loop uses a longer backoff and can surface
                // clearer user-facing feedback.
                const hasOutput = Array.isArray(resp?.output) && resp.output.length > 0;
                if (!hasOutput) {
                  looksLikeRateLimit = true;
                  streamErrorDetail = "Azure response failed (likely TPM rate limit — error:null, empty output)";
                } else {
                  streamErrorDetail = "Azure response failed (no error details returned)";
                }
              }
            } else if (event?.type === "error") {
              const { code, message } = event as { code?: string; message?: string };
              streamErrorDetail = `${code || "stream_error"}: ${message || "unknown"}`;
            }

            logStreamFailureEvent(event, requestSummary, loggedRef);
            yield event;
          }
        })();

        await processResponsesStream(loggingStream, output, stream, model);
        applyPhasesToOutputMessage(output, outputPhases);

        if (LOG_PHASES && outputPhases.size > 0) {
          console.error("[azure-openai] Output phases:", JSON.stringify({ total: outputPhases.size, phases: Array.from(outputPhases.entries()).slice(0, 6) }));
        }

        if (options?.signal?.aborted) {
          throw new Error("Request was aborted");
        }

        // Success — break out of retry loop
        if (output.stopReason !== "aborted" && output.stopReason !== "error") {
          stream.push({ type: "done", reason: output.stopReason, message: output });
          stream.end();
          return;
        }

        // Determine if error is retryable (NOT a client-side 4xx error)
        const detail = streamErrorDetail || (output as any).errorMessage || "unknown error";
        const isClientError = /^(400|401|403|404|422)\b/.test(detail) ||
          detail.includes("invalid_request_error");
        if (isClientError || attempt >= MAX_RETRIES) {
          const userDetail = looksLikeRateLimit
            ? formatAzureRateLimitMessage({
                modelId: model.id,
                deploymentName,
                retryDelayMs: AZURE_RATE_LIMIT_BACKOFF_MS,
                exhausted: true,
                streamingTpm: true,
              })
            : detail;
          throw new Error(`Azure OpenAI error: ${userDetail}`);
        }

        // Use a longer delay for suspected rate-limit failures so the
        // per-minute token budget has time to renew. Short retries against
        // TPM exhaustion just burn more quota and fail again.
        const delayMs = looksLikeRateLimit
          ? AZURE_RATE_LIMIT_BACKOFF_MS
          : (attempt + 1) * 2000;
        console.error(`[azure-openai] Attempt ${attempt + 1}/${MAX_RETRIES + 1} failed (${detail})${looksLikeRateLimit ? " [rate-limit backoff]" : ""}, retrying in ${delayMs}ms...`);

        // Push a visible status message into the stream so the user sees
        // what is happening instead of a silent hang. Without this, Azure's
        // silent streaming failure shape looks like the model simply stalled.
        // The text block is intentionally transient and is cleared when the
        // retry resets output.content on the next attempt.
        pushRetryNotice({ attempt, delayMs, rateLimit: looksLikeRateLimit });

        loggedRef.logged = false;
        await new Promise((r) => setTimeout(r, delayMs));
      }

      // Should not reach here, but just in case
      throw new Error("Azure request failed after retries");
    } catch (error) {
      logAzureError(model.id, error, requestSummary, loggedRef);
      for (const block of output.content) delete (block as any).index;
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      // Prefer explicit user-facing Azure errors over low-level stream details;
      // otherwise keep the stream-level diagnostic when available.
      const formattedError = formatAzureOpenAIError(error);
      output.errorMessage = /^(Azure request failed|Azure OpenAI error):/.test(formattedError)
        ? formattedError
        : streamErrorDetail || formattedError;
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
}

// Thin adapter that converts pi-ai simple-stream options into the richer Azure
// Responses wrapper above. Keep policy in streamAzureOpenAIResponses, not here.
function streamSimpleAzureOpenAIResponses(model: any, context: any, options: any) {
  const base = buildBaseOptions(model, context, options, options?.apiKey);
  const reasoningEffort = getSupportedThinkingLevels(model).includes(options?.reasoning)
    ? options?.reasoning
    : clampReasoning(options?.reasoning);

  return streamAzureOpenAIResponses(model, context, {
    ...base,
    reasoningEffort,
  });
}

// Foundry text models still run through the generic OpenAI completions stream,
// but we keep a custom outward-facing API name so Azure/Foundry registration
// never overrides the global OpenAI provider handlers.
function streamSimpleFoundryOpenAICompletions(model: any, context: any, options: any) {
  // Foundry uses the standard OpenAI Completions transport, but we keep a custom API name
  // so this extension doesn't override global handlers. Force the api back to openai-completions
  // when calling the built-in stream implementation.
  const normalizedBaseUrl = typeof model.baseUrl === "string" ? normalizeAzureOpenAIBaseUrl(model.baseUrl) : model.baseUrl;
  const overrideModel = {
    ...model,
    api: "openai-completions",
    baseUrl: normalizedBaseUrl,
  };
  return streamSimpleOpenAICompletions(overrideModel, context, options);
}

/**
 * Register all Azure-backed providers exposed by this extension.
 *
 * Keep registration declarative: per-model shaping should happen in the stream
 * wrappers, while this function is responsible for publishing the provider and
 * model metadata that the rest of piclaw sees.
 */
export function registerAzureProviders(register: AzureProviderConfigRegistrar, token: string): void {
  const openaiModels = MODEL_IDS.flatMap((id, idx) => {
    const spec = MODEL_SPECS[id] || DEFAULT_AZURE_SPEC;
    const caps = MODEL_CAPABILITIES[id];
    const rateLimits = MODEL_RATE_LIMITS[id];
    if (caps?.responses === false) {
      // Slice 1: Responses-only models must never silently fall through to
      // chat completions. Emit an explicit error for these instead of just skipping.
      if (RESPONSES_ONLY_MODELS.has(id)) {
        console.error(`[azure-openai] ERROR: ${id} is Responses-only but deployment reports responses=false. Skipping.`);
      } else {
        console.error(`[azure-openai] Skipping ${id}: responses not supported by this deployment.`);
      }
      return [];
    }
    return [
      {
        id,
        name: MODEL_NAMES[idx] || (id === MODEL_ID ? MODEL_NAME : `Azure ${id}`),
        api: AZURE_API,
        reasoning: spec.reasoning ?? true,
        input: ["text"],
        contextWindow: spec.contextWindow ?? 200000,
        maxTokens: spec.maxTokens ?? 64000,
        rateLimits,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ];
  });

  register(PROVIDER, {
    baseUrl: BASE_URL,
    api: AZURE_API,
    apiKey: token,
    streamSimple: streamSimpleAzureOpenAIResponses,
    models: openaiModels,
  });

  const foundryModels = FOUNDRY_TEXT_MODEL_IDS.map((id, idx) => {
    const spec = MODEL_SPECS[id] || DEFAULT_FOUNDRY_SPEC;
    return {
      id,
      name: FOUNDRY_MODEL_NAMES[idx] || `Azure Foundry ${id}`,
      api: FOUNDRY_API,
      reasoning: spec.reasoning ?? false,
      input: ["text"],
      contextWindow: spec.contextWindow ?? 200000,
      maxTokens: spec.maxTokens ?? 64000,
      // Slice 3: Foundry compat flags proven in the harness (2026-03-10).
      // Without these, mistral-large-3 rejects requests with 422 (extra_forbidden
      // for `store`, wrong max-token field) and tool flows fail with incorrect
      // message ordering ("Unexpected role 'user' after role 'tool'").
      compat: {
        supportsStore: false,
        maxTokensField: "max_tokens",
        supportsReasoningEffort: false,
        requiresAssistantAfterToolResult: true,
      },
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
  });

  if (foundryModels.length > 0) {
    register(FOUNDRY_PROVIDER, {
      baseUrl: FOUNDRY_BASE_URL,
      api: FOUNDRY_API,
      apiKey: token,
      streamSimple: streamSimpleFoundryOpenAICompletions,
      models: foundryModels,
    });
  }

  // Secondary Azure OpenAI endpoint (optional — only registered when AOAI2_BASE_URL is set)
  if (AOAI2_BASE_URL && AOAI2_MODEL_IDS.length > 0) {
    const aoai2Models = AOAI2_MODEL_IDS.flatMap((id, idx) => {
      const spec = MODEL_SPECS[id] || DEFAULT_AZURE_SPEC;
      const caps = MODEL_CAPABILITIES[id];
      const rateLimits = MODEL_RATE_LIMITS[id];
      if (caps?.responses === false) {
        console.error(`[azure-openai-2] Skipping ${id}: responses not supported.`);
        return [];
      }
      return [{
        id,
        name: AOAI2_MODEL_NAMES[idx] || `Azure ${id}`,
        api: AOAI2_API,
        reasoning: spec.reasoning ?? true,
        input: ["text"],
        contextWindow: spec.contextWindow ?? 200000,
        maxTokens: spec.maxTokens ?? 64000,
        rateLimits,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      }];
    });
    register(AOAI2_PROVIDER, {
      baseUrl: AOAI2_BASE_URL,
      api: AOAI2_API,
      apiKey: token,
      streamSimple: streamSimpleAzureOpenAIResponses,
      models: aoai2Models,
    });
  }
}

function toAzureNativeProvider(providerId: string, config: AzureProviderConfig, token: string): Provider {
  const streamSimple = config.streamSimple;
  if (typeof streamSimple !== "function") throw new Error(`Azure provider ${providerId} has no streamSimple implementation`);
  const models = (config.models ?? []).map((model) => ({
    ...model,
    provider: providerId,
    baseUrl: model.baseUrl ?? config.baseUrl,
    api: model.api ?? config.api,
    headers: { ...(config.headers ?? {}), ...(model.headers ?? {}) },
  })) as Model<Api>[];
  const apiKey = config.apiKey ?? token;
  return {
    id: providerId,
    name: config.name ?? providerId,
    baseUrl: config.baseUrl,
    headers: config.headers,
    auth: {
      apiKey: {
        name: `${config.name ?? providerId} token`,
        resolve: async () => ({ auth: { apiKey }, source: STATIC_API_KEY ? "static api key" : "azure token bootstrap" }),
      },
    },
    getModels: () => models,
    stream: (model, context, options) => streamSimple(model, context, options),
    streamSimple,
  };
}

export function registerAzureNativeProviders(register: AzureNativeProviderRegistrar, token: string): void {
  const registrations: Array<{ name: string; config: AzureProviderConfig }> = [];
  registerAzureProviders((name, config) => registrations.push({ name, config }), token);
  for (const { name, config } of registrations) register(toAzureNativeProvider(name, config, token));
}

export async function repairAzureContext(event: { messages: any[] }, ctx: { model?: any }): Promise<{ messages: any[] } | void> {
  const currentModel = ctx.model;
  if (!currentModel) return;

  const idMap = new Map<string, string>();
  let modified = false;

  const messages = event.messages.map((message) => {
    if (message.role === "assistant") {
      const assistant = message as AssistantMessage;
      if (isSameModel(assistant, currentModel)) return message;

      let contentChanged = false;
      const content = assistant.content.map((block) => {
        if (block.type !== "toolCall") return block;
        const toolCall = block as ToolCall;
        const { id, changed } = stripToolCallItemId(toolCall.id);
        if (!changed) return toolCall;
        idMap.set(toolCall.id, id);
        contentChanged = true;
        return { ...toolCall, id };
      });

      if (!contentChanged) return message;
      modified = true;
      return { ...assistant, content };
    }

    if (message.role === "toolResult") {
      const toolResult = message as ToolResultMessage;
      const mapped = idMap.get(toolResult.toolCallId);
      if (!mapped || mapped === toolResult.toolCallId) return message;
      modified = true;
      return { ...toolResult, toolCallId: mapped };
    }

    return message;
  });

  if (!modified) return;
  return { messages };
}

let cachedAzureImagesModule: Promise<typeof import("./azure-openai-images.ts")> | null = null;

async function loadAzureImagesModule(): Promise<typeof import("./azure-openai-images.ts")> {
  if (!cachedAzureImagesModule) cachedAzureImagesModule = import("./azure-openai-images.ts");
  return await cachedAzureImagesModule;
}

export async function executeAzureImageCommand(
  pi: Pick<ExtensionAPI, "sendMessage">,
  input: string,
): Promise<void> {
  const mod = await loadAzureImagesModule();
  await mod.executeAzureImageCommand(pi, input);
}

export async function executeAzureFluxCommand(
  pi: Pick<ExtensionAPI, "sendMessage">,
  input: string,
): Promise<void> {
  const mod = await loadAzureImagesModule();
  await mod.executeAzureFluxCommand(pi, input);
}

type AzureBootstrapTimerApi = Pick<typeof globalThis, "setTimeout" | "clearTimeout">;
type AzureProviderBootstrapOptions = {
  timerApi?: AzureBootstrapTimerApi;
  ensureToken?: () => Promise<TokenCache>;
  ensureModelCaps?: () => Promise<void>;
  staticApiKey?: string;
};

function isAzureBootstrapTimerApi(value: unknown): value is AzureBootstrapTimerApi {
  return Boolean(value)
    && typeof (value as { setTimeout?: unknown }).setTimeout === "function"
    && typeof (value as { clearTimeout?: unknown }).clearTimeout === "function";
}

export function startAzureProviderBootstrap(
  register: AzureNativeProviderRegistrar,
  options: AzureBootstrapTimerApi | AzureProviderBootstrapOptions = {},
): { stop: () => void; refresh: () => Promise<void> } {
  const timerApi = isAzureBootstrapTimerApi(options) ? options : options.timerApi ?? globalThis;
  const tokenProvider = isAzureBootstrapTimerApi(options) ? ensureToken : options.ensureToken ?? ensureToken;
  const modelCapsProvider = isAzureBootstrapTimerApi(options) ? ensureAzureModelCaps : options.ensureModelCaps ?? ensureAzureModelCaps;
  const staticApiKey = isAzureBootstrapTimerApi(options) ? STATIC_API_KEY : options.staticApiKey ?? STATIC_API_KEY;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let refreshInFlight: Promise<void> | null = null;

  const scheduleNext = (expiresOnEpoch?: number) => {
    if (timer) timerApi.clearTimeout(timer);
    const now = Math.floor(Date.now() / 1000);
    const delaySeconds = expiresOnEpoch
      ? Math.max(60, expiresOnEpoch - now - SKEW_SECONDS)
      : 60;
    timer = timerApi.setTimeout(() => {
      void refresh().catch((error) => {
        console.error("[azure-openai] Scheduled provider refresh failed; retaining last-good registration:", error);
        if (!stopped) scheduleNext();
      });
    }, delaySeconds * 1000);
  };

  const runRefresh = async () => {
    if (stopped) return;
    logExtensionLoaded();
    if (staticApiKey) {
      registerAzureNativeProviders(register, staticApiKey);
      return;
    }
    const cache = await tokenProvider();
    if (cache.accessToken) {
      try {
        await modelCapsProvider();
      } catch (error) {
        console.error("[azure-openai] Model capability refresh failed; retaining last-good/static model metadata:", error);
      }
      if (!stopped) registerAzureNativeProviders(register, cache.accessToken);
    }
    if (!stopped) scheduleNext(cache.expiresOnEpoch);
  };

  const refresh = (): Promise<void> => {
    if (refreshInFlight) return refreshInFlight;
    const task = runRefresh();
    const tracked = task.finally(() => {
      if (refreshInFlight === tracked) refreshInFlight = null;
    });
    refreshInFlight = tracked;
    return tracked;
  };

  return {
    stop: () => {
      stopped = true;
      if (timer) timerApi.clearTimeout(timer);
    },
    refresh,
  };
}

export default function (pi: ExtensionAPI) {
  // Extension bootstrap:
  // - log the effective configuration once
  // - repair cross-model tool-call artifacts during context replay
  // - register providers immediately when using static-key mode
  // - otherwise fetch/cache managed-identity tokens and then register
  logExtensionLoaded();

  pi.on("context", async (event, ctx) => await repairAzureContext(event as { messages: any[] }, ctx as { model?: any }));

  pi.registerCommand("image", {
    description: "Generate an image with Azure OpenAI",
    handler: async (input) => {
      await executeAzureImageCommand(pi, input || "");
    },
  });

  pi.registerCommand("flux", {
    description: "Generate an image with Azure Foundry (FLUX.2-pro)",
    handler: async (input) => {
      await executeAzureFluxCommand(pi, input || "");
    },
  });

  // Provider registration and token refresh are process-owned by
  // runtime/provider-bootstrap.ts. This default export intentionally contains
  // no session_start/session_shutdown provider lifecycle.
}
