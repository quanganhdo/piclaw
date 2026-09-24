/**
 * extensions/experimental/azure-openai.harness.ts – Harness-only copy of the Azure OpenAI provider.
 *
 * Seeded from `extensions/integrations/azure-openai.ts` so endpoint experiments can be run
 * directly from Bun without reloading the live piclaw process.
 *
 * Safe to modify for harness tests.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type AzureHarnessProviderConfig = Parameters<ExtensionAPI["registerProvider"]>[1];
type AzureHarnessProviderRegistrar = (name: string, config: AzureHarnessProviderConfig) => void;
import OpenAI from "openai";
import {
  createAssistantMessageEventStream,
  getSupportedThinkingLevels,
  type AssistantMessage,
  type Model,
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
import { currentContextTools } from "../../src/extensions/transcript-context-compat.js";
import { streamSimple as streamSimpleOpenAICompletions } from "@earendil-works/pi-ai/api/openai-completions";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getWebServerConfig } from "../../src/core/config-web.js";
import { getWebSecretBootstrapConfig } from "../../src/core/config-secrets.js";

import {
  tryNormalizeFoundryServiceBase,
  tryParseJsonRecord,
  tryRewriteProxyFoundryImageEndpoint,
} from "./azure-openai-harness-helpers.ts";

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
const AOAI_IMAGE_MODEL_ID = process.env.AOAI_IMAGE_MODEL_ID || "gpt-image-1-5";
// API version for direct Azure OpenAI access. The proxy ignores this, but it must
// be settable locally so the extension works against Azure endpoints without a proxy.
const AOAI_API_VERSION = process.env.AOAI_API_VERSION || process.env.OPENAI_API_VERSION || "2024-02-15-preview";
const FOUNDRY_BASE_URL =
  process.env.FOUNDRY_BASE_URL || "https://{FOUNDRY_RESOURCE}.cognitiveservices.azure.com/openai/v1";
const FOUNDRY_MODEL_IDS = (process.env.FOUNDRY_MODEL_IDS || "mistral-large-3,flux-2-pro")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const FOUNDRY_MODEL_NAMES = (process.env.FOUNDRY_MODEL_NAMES || "")
  .split(",")
  .map((entry) => entry.trim());
const FOUNDRY_IMAGE_MODEL_ID = process.env.FOUNDRY_IMAGE_MODEL_ID || "flux-2-pro";
// API version constants — used for direct Azure/Foundry access (non-proxy mode).
// Even when running through a proxy, these env vars should be settable locally
// so the extension can be pointed at Azure endpoints directly without code changes.
const FOUNDRY_API_VERSION = process.env.FOUNDRY_API_VERSION || AOAI_API_VERSION;
const FOUNDRY_IMAGE_API_VERSION = process.env.FOUNDRY_IMAGE_API_VERSION || "preview";
const FOUNDRY_IMAGE_BASE_URL = process.env.FOUNDRY_IMAGE_BASE_URL || "";
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
  } catch {
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
const TOOL_CALL_PROVIDERS = new Set(["openai", "openai-codex", "opencode-zen", PROVIDER, FOUNDRY_PROVIDER]);
const ENABLE_EXPERIMENTAL_AZURE_CLIENT_REQUEST_ID = /^(1|true|yes)$/i.test(process.env.AOAI_EXPERIMENT_AZURE_CLIENT_REQUEST_ID || "");
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
    authMode: STATIC_API_KEY ? "api-key (proxy)" : "managed-identity",
    disableTools: DISABLE_TOOLS,
    disableReasoning: DISABLE_REASONING,
    disableReasoningModels: Array.from(DISABLE_REASONING_MODELS),
    sessionCorrelationHeaders: true,
    experimentalAzureClientRequestId: ENABLE_EXPERIMENTAL_AZURE_CLIENT_REQUEST_ID,
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
    } catch {
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
    } catch {
      subscriptionId = "";
    }
  }

  if (!resourceGroup) {
    try {
      resourceGroup = await fetchImdsText("resourceGroupName");
    } catch {
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

function applyAzureModelCaps(models: any[], deployments: any[]): number {
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

    const existing = MODEL_SPECS[deploymentName] || {};
    const next = { ...existing } as { contextWindow?: number; maxTokens?: number; reasoning?: boolean };

    if (caps.contextWindow) next.contextWindow = caps.contextWindow;
    if (caps.maxTokens) next.maxTokens = caps.maxTokens;

    const existingCaps = MODEL_CAPABILITIES[deploymentName] || {};
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

    const existingRates = MODEL_RATE_LIMITS[deploymentName] || {};
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
      MODEL_SPECS[deploymentName] = next;
    }
    if (capsChanged) {
      MODEL_CAPABILITIES[deploymentName] = nextCaps;
    }
    if (ratesChanged) {
      MODEL_RATE_LIMITS[deploymentName] = nextRates;
    }
    if (specChanged || capsChanged || ratesChanged) {
      updated += 1;
    }
  }

  return updated;
}

let modelCapsLoaded = false;
let modelCapsPromise: Promise<void> | null = null;

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


interface TokenCache {
  accessToken?: string;
  expiresOn?: string;
  expiresOnEpoch?: number;
}

type ImageArgs = {
  prompt: string;
  size?: string;
  count?: number;
  quality?: "low" | "medium" | "high";
  style?: "natural" | "vivid";
};

function readCache(): TokenCache {
  try {
    const raw = readFileSync(CACHE_FILE, "utf-8");
    return JSON.parse(raw) as TokenCache;
  } catch {
    return {};
  }
}

function isTokenValid(cache: TokenCache): boolean {
  if (!cache.accessToken || !cache.expiresOnEpoch) return false;
  const now = Math.floor(Date.now() / 1000);
  return cache.expiresOnEpoch - now > SKEW_SECONDS;
}

function writeCache(token: string, expiresOn: string | undefined, expiresOnEpoch: number): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  const payload: TokenCache = { accessToken: token, expiresOn, expiresOnEpoch };
  writeFileSync(CACHE_FILE, `${JSON.stringify(payload, null, 2)}\n`);
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

async function ensureToken(force = false): Promise<TokenCache> {
  const cached = readCache();
  if (!force && isTokenValid(cached)) return cached;

  try {
    return await fetchTokenFromImds();
  } catch (error) {
    console.error("[azure-openai] Failed to refresh token via IMDS:", error);
    return cached;
  }
}

async function getAccessToken(): Promise<string> {
  // When a static API key is configured (proxy mode), skip IMDS entirely.
  if (STATIC_API_KEY) return STATIC_API_KEY;

  const token = await ensureToken();
  if (!token.accessToken) {
    throw new Error("Missing Azure access token. Ensure IMDS is available.");
  }
  return token.accessToken;
}

export async function resolveAzureProviderToken(options?: { refreshModelCaps?: boolean }): Promise<string> {
  const refreshModelCaps = options?.refreshModelCaps !== false;
  if (STATIC_API_KEY) return STATIC_API_KEY;

  const cache = await ensureToken();
  if (!cache.accessToken) {
    throw new Error("Missing Azure access token. Ensure IMDS is available.");
  }
  if (refreshModelCaps) {
    await ensureAzureModelCaps();
  }
  return cache.accessToken;
}

function isAuthError(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  if (status === 401 || status === 403) return true;
  const message = error instanceof Error ? error.message : String(error || "");
  return /unauthorized|forbidden|401|403/i.test(message);
}

function parseArgs(input: string): ImageArgs | null {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  const args: ImageArgs = { prompt: "" };
  const promptParts: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === "--size" && tokens[i + 1]) {
      args.size = tokens[i + 1];
      i += 1;
      continue;
    }
    if (token === "--count" && tokens[i + 1]) {
      const count = Number(tokens[i + 1]);
      if (Number.isFinite(count)) args.count = Math.min(4, Math.max(1, Math.floor(count)));
      i += 1;
      continue;
    }
    if (token === "--quality" && tokens[i + 1]) {
      const quality = tokens[i + 1] as ImageArgs["quality"] | undefined;
      if (quality && ["low", "medium", "high"].includes(quality)) args.quality = quality;
      i += 1;
      continue;
    }
    if (token === "--style" && tokens[i + 1]) {
      const style = tokens[i + 1] as ImageArgs["style"] | undefined;
      if (style && ["natural", "vivid"].includes(style)) args.style = style;
      i += 1;
      continue;
    }
    promptParts.push(token);
  }

  let prompt = promptParts.join(" ").trim();
  if (!prompt) return null;

  // Convenience: if the last prompt token looks like "WxH" (e.g. 1280x720),
  // treat it as size and remove it from the prompt.
  if (!args.size) {
    const trailing = prompt.match(/\s+(\d{2,5}\s*x\s*\d{2,5})$/i) || prompt.match(/^(\d{2,5}\s*x\s*\d{2,5})$/i);
    if (trailing && trailing[1]) {
      const normalized = trailing[1].replace(/\s+/g, "").toLowerCase();
      const stripped = prompt.slice(0, prompt.length - trailing[0].length).trim();
      if (stripped) {
        args.size = normalized;
        prompt = stripped;
      }
    }
  }

  args.prompt = prompt;
  return args;
}

// Supported sizes for gpt-image models. Snap user-specified WxH to the
// nearest proportionally matching size.
const AOAI_IMAGE_SIZES = ["1024x1024", "1024x1536", "1536x1024"] as const;

function snapToSupportedSize(size: string | undefined): "auto" | typeof AOAI_IMAGE_SIZES[number] {
  if (!size || size === "auto") return "auto";
  const m = size.toLowerCase().match(/(\d+)\s*x\s*(\d+)/);
  if (!m) return "1024x1024";
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return "1024x1024";
  const ratio = w / h;
  // Pick the supported size whose aspect ratio is closest
  let best: typeof AOAI_IMAGE_SIZES[number] = AOAI_IMAGE_SIZES[0];
  let bestDiff = Infinity;
  for (const candidate of AOAI_IMAGE_SIZES) {
    const [cw = 0, ch = 1] = candidate.split("x").map(Number);
    const diff = Math.abs(ratio - cw / ch);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = candidate;
    }
  }
  return best;
}

async function generateImage(baseUrl: string, model: string, args: ImageArgs, includeStyle: boolean) {
  await getAccessToken();
  const client = createAzureClient(baseUrl, {});

  const payload: OpenAI.Images.ImageGenerateParamsNonStreaming = {
    model,
    prompt: args.prompt,
    size: snapToSupportedSize(args.size) as OpenAI.Images.ImageGenerateParamsNonStreaming["size"],
    quality: args.quality || "high",
    n: args.count || 1,
  };
  if (includeStyle && args.style) {
    (payload as OpenAI.Images.ImageGenerateParamsNonStreaming & { style?: ImageArgs["style"] }).style = args.style;
  }

  const response = await client.images.generate(payload);
  const images = response.data || [];
  if (images.length === 0) {
    throw new Error("Image API returned no images.");
  }
  return images;
}

function getAzureEndpoint(baseUrl: string): string {

  return baseUrl.replace(/\/openai\/v1\/?$/, "").replace(/\/openai\/?$/, "");
}


function createAzureClient(baseUrl: string, headers: Record<string, string>) {
  return new OpenAI({
    apiKey: async () => await getAccessToken(),
    baseURL: baseUrl,
    defaultHeaders: headers,
    dangerouslyAllowBrowser: true,
  });
}

function getFoundryImageEndpoint(): string {
  if (FOUNDRY_IMAGE_BASE_URL) return FOUNDRY_IMAGE_BASE_URL.replace(/\/+$/, "");

  // When using a proxy (STATIC_API_KEY / AOAI_API_KEY set), rewrite the
  // FOUNDRY_BASE_URL to use the /bfl/ route which forwards to the AI Foundry
  // services endpoint (not the OpenAI endpoint).
  // e.g. http://proxy:3100/foundry/v1 → http://proxy:3100/bfl
  if (STATIC_API_KEY) {
    const rewrittenProxyEndpoint = tryRewriteProxyFoundryImageEndpoint(FOUNDRY_BASE_URL);
    if (rewrittenProxyEndpoint) return rewrittenProxyEndpoint;
  }

  const base = getAzureEndpoint(FOUNDRY_BASE_URL);
  return tryNormalizeFoundryServiceBase(base) || base;
}

function parseSize(size?: string): { width: number; height: number } {
  if (!size) return { width: 1024, height: 1024 };
  const match = size.toLowerCase().match(/(\d+)\s*x\s*(\d+)/);
  if (!match) return { width: 1024, height: 1024 };
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return { width: 1024, height: 1024 };
  return { width, height };
}

async function generateFoundryImage(model: string, args: ImageArgs) {
  const accessToken = await getAccessToken();

  const endpoint = getFoundryImageEndpoint();
  const url = `${endpoint}/providers/blackforestlabs/v1/${encodeURIComponent(model)}?api-version=${encodeURIComponent(FOUNDRY_IMAGE_API_VERSION)}`;
  const size = parseSize(args.size);
  const payload: Record<string, any> = {
    prompt: args.prompt,
    width: size.width,
    height: size.height,
    n: args.count || 1,
    model,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Accept-Encoding": "identity",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${body}`.trim());
  }
  const data = (await res.json()) as { data?: Array<{ b64_json?: string }> };
  const images = data.data || [];
  if (images.length === 0) {
    throw new Error("Image API returned no images.");
  }
  return images;
}

function saveImages(prefix: string, prompt: string, images: Array<{ b64_json?: string }>) {
  const outDir = join("/workspace", "exports", "images");
  mkdirSync(outDir, { recursive: true });

  const lines: string[] = [];
  images.forEach((image, idx) => {
    const b64 = image.b64_json;
    if (!b64) return;
    const buffer = Buffer.from(b64, "base64");
    const filename = `${prefix}-${Date.now()}-${idx + 1}.png`;
    const relPath = join("exports", "images", filename).replace(/\\/g, "/");
    const absPath = join("/workspace", relPath);
    writeFileSync(absPath, buffer);
    const url = `/workspace/raw?path=${encodeURIComponent(relPath)}`;
    lines.push(`![${prompt}](${url})`);
    lines.push(`Download: ${url}`);
  });
  return lines;
}

const PICLAW_BASE = `http://localhost:${getWebServerConfig().port}`;
const INTERNAL_SECRET = getWebSecretBootstrapConfig().internalSecret || process.env.WEB_INTERNAL_SECRET || "";

async function postPlaceholder(content: string, threadId?: number): Promise<number | string | null> {
  try {
    const body: Record<string, unknown> = { content };
    if (threadId) body.thread_id = threadId;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (INTERNAL_SECRET) headers["x-piclaw-internal-secret"] = INTERNAL_SECRET;
    const res = await fetch(`${PICLAW_BASE}/internal/post`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { id?: number | string };
    return data.id ?? null;
  } catch {
    return null;
  }
}

async function updatePost(id: number, content: string, threadId?: number): Promise<boolean> {
  try {
    const body: Record<string, unknown> = { content };
    if (threadId) body.thread_id = threadId;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (INTERNAL_SECRET) headers["x-piclaw-internal-secret"] = INTERNAL_SECRET;
    const res = await fetch(`${PICLAW_BASE}/post/${id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}


function streamAzureOpenAIResponses(model: any, context: any, options: any) {
  const stream = createAssistantMessageEventStream();



  (async () => {
    const output: AssistantMessage = {
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
      Object.assign(headers, applySessionCorrelationHeaders(headers, cacheSessionId, {
        includeAzureClientRequestId: ENABLE_EXPERIMENTAL_AZURE_CLIENT_REQUEST_ID,
      }));

      // Pull any stored phase metadata from prior assistant messages, then apply it to the
      // reconstructed ResponseInput so gpt-5.3-codex sees the same phases on replay.
      const phaseById = collectMessagePhases(context.messages || []);
      const rawMessages = convertResponsesMessages(model, context, TOOL_CALL_PROVIDERS);
      applyPhasesToResponseInput(rawMessages as Array<any>, phaseById);
      const toolCallLimit = MODEL_TOOL_CALL_LIMITS[model.id] ?? TOOL_CALL_LIMIT;
      const toolCallTrim = applyToolCallLimit(rawMessages as Array<any>, {
        limit: toolCallLimit,
        summaryMax: TOOL_CALL_SUMMARY_MAX,
        outputChars: TOOL_CALL_OUTPUT_CHARS,
        dedupeToolOutputSearch: DEDUPE_TOOL_OUTPUT_SEARCH,
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
        toolCount: toolsEnabled ? currentContextTools(context).length : 0,
        hasToolCalls: messages.some((item: any) => item?.type === "function_call"),
        toolCallLimit: toolCallLimit,
        toolCallTotal: toolCallTrim.toolCallTotal,
        toolCallKept: toolCallTrim.toolCallKept,
        toolCallRemoved: toolCallTrim.toolCallRemoved,
        toolCallDeduped: toolCallTrim.toolCallDeduped,
        toolCallSummary: Boolean(toolCallTrim.summaryText),
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
      let params: Record<string, any> = {
        model: model.id,
        input: messages,
        stream: true,
        store: false,
      };

      // Only include OpenAI-specific params for models that support them
      if (reasoningEnabled) {
        params.prompt_cache_key = cacheSessionId;
        params.text = { format: { type: "text" }, verbosity: "medium" };
      }

      if (options?.maxTokens) {
        params.max_output_tokens = options?.maxTokens;
      }
      if (options?.temperature !== undefined) {
        params.temperature = options?.temperature;
      }
      if (!DISABLE_TOOLS && currentContextTools(context).length) {
        params.tools = convertResponsesTools(currentContextTools(context));
      } else if (DISABLE_TOOLS) {
        params.tool_choice = "none";
      }

      if (reasoningEnabled) {
        if (options?.reasoningEffort || options?.reasoningSummary) {
          // Azure OpenAI only supports a minimal reasoning payload.
          // Unsupported fields like `summary` and `include` cause silent
          // failures (response.failed with error: null). Some models
          // (e.g. gpt-5.3-chat) also restrict effort to "medium" only.
          // We send effort but omit summary and include for Azure.
          params.reasoning = {
            effort: options?.reasoningEffort || "medium",
          };
        } else if (String(model.name).toLowerCase().startsWith("gpt-5")) {
          messages.push({
            role: "developer",
            content: [
              {
                type: "input_text",
                text: "# Juice: 0 !important",
              },
            ],
          });
        }
      }
      const nextParams = await options?.onPayload?.(params, model, {
        headers: {
          session_id: headers.session_id ?? null,
          "x-client-request-id": headers["x-client-request-id"] ?? null,
          "x-ms-client-request-id": headers["x-ms-client-request-id"] ?? null,
        },
      });
      if (nextParams !== undefined) {
        params = nextParams as Record<string, any>;
      }

      const createStream = async () => {
        const client = createAzureClient(model.baseUrl, headers);
        return client.responses.create(
          params,
          options?.signal ? { signal: options.signal } : undefined
        );
      };

      await getAccessToken();

      const MAX_RETRIES = 2;
      let streamStarted = false;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (options?.signal?.aborted) throw new Error("Request was aborted");

        // Reset per-attempt state
        streamErrorDetail = "";
        output.content = [];
        output.stopReason = "stop";
        (output as any).errorMessage = undefined;
        (output as any).reasoning = undefined;

        let openaiStream: AsyncIterable<any>;
        try {
          openaiStream = await createStream() as unknown as AsyncIterable<any>;
        } catch (error) {
          if (!isAuthError(error)) throw error;
          if (!STATIC_API_KEY) await ensureToken(true);
          openaiStream = await createStream() as unknown as AsyncIterable<any>;
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
                streamErrorDetail = "Azure response failed (no error details returned)";
              }
            } else if (event?.type === "error") {
              const { code, message } = event as { code?: string; message?: string };
              streamErrorDetail = `${code || "stream_error"}: ${message || "unknown"}`;
            }

            logStreamFailureEvent(event, requestSummary, loggedRef);
            yield event;
          }
        })();

        if (!streamStarted) {
          stream.push({ type: "start", partial: output });
          streamStarted = true;
        }
        await processResponsesStream(loggingStream, output, stream, model);
        applyPhasesToOutputMessage(output, outputPhases);

        if (LOG_PHASES && outputPhases.size > 0) {
          console.error("[azure-openai] Output phases:", JSON.stringify({ total: outputPhases.size, phases: Array.from(outputPhases.entries()).slice(0, 6) }));
        }

        if (options?.signal?.aborted) {
          throw new Error("Request was aborted");
        }

        // Success — break out of retry loop
        if (output.stopReason === "stop" || output.stopReason === "length" || output.stopReason === "toolUse") {
          stream.push({ type: "done", reason: output.stopReason, message: output });
          stream.end();
          return;
        }

        // Determine if error is retryable (NOT a client-side 4xx error)
        const detail = streamErrorDetail || (output as any).errorMessage || "unknown error";
        const isClientError = /^(400|401|403|404|422)\b/.test(detail) ||
          detail.includes("invalid_request_error");
        if (isClientError || attempt >= MAX_RETRIES) {
          throw new Error(`Azure request failed: ${detail}`);
        }

        const delayMs = (attempt + 1) * 2000;
        console.error(`[azure-openai] Attempt ${attempt + 1}/${MAX_RETRIES + 1} failed (${detail}), retrying in ${delayMs}ms...`);
        loggedRef.logged = false;
        await new Promise((r) => setTimeout(r, delayMs));
      }

      // Should not reach here, but just in case
      throw new Error("Azure request failed after retries");
    } catch (error) {
      logAzureError(model.id, error, requestSummary, loggedRef);
      for (const block of output.content) delete (block as any).index;
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      // Prefer the stream-level error detail over the generic thrown message.
      const rawMsg = error instanceof Error ? error.message : JSON.stringify(error);
      output.errorMessage = streamErrorDetail || rawMsg;
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
}

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

function streamSimpleFoundryOpenAICompletions(model: any, context: any, options: any) {
  // Foundry uses the standard OpenAI Completions transport, but we keep a custom API name
  // so this extension doesn't override global handlers. Force the api back to openai-completions
  // when calling the built-in stream implementation.
  const overrideModel = model.api === "openai-completions" ? model : { ...model, api: "openai-completions" };
  return streamSimpleOpenAICompletions(overrideModel, context, options);
}

export function registerAzureProviders(register: AzureHarnessProviderRegistrar, token: string): void {
  const openaiModels = MODEL_IDS.flatMap((id, idx) => {
    const spec = MODEL_SPECS[id] || DEFAULT_AZURE_SPEC;
    const caps = MODEL_CAPABILITIES[id];
    const rateLimits = MODEL_RATE_LIMITS[id];
    if (caps?.responses === false) {
      console.error(`[azure-openai] Skipping ${id}: responses not supported by this deployment.`);
      return [];
    }
    return [
      {
        id,
        name: MODEL_NAMES[idx] || (id === MODEL_ID ? MODEL_NAME : `Azure ${id}`),
        api: AZURE_API,
        reasoning: spec.reasoning ?? true,
        input: ["text" as const],
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
      input: ["text" as const],
      contextWindow: spec.contextWindow ?? 200000,
      maxTokens: spec.maxTokens ?? 64000,
      compat: {
        supportsStore: false,
        maxTokensField: "max_tokens" as const,
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
}

function registerProvider(pi: ExtensionAPI, token: string) {
  registerAzureProviders((name, config) => pi.registerProvider(name, config), token);
}

type AzureHarnessTimerApi = Pick<typeof globalThis, "setTimeout" | "clearTimeout">;
let azureHarnessTimerApi: AzureHarnessTimerApi = globalThis;
let azureHarnessEnsureTokenForTests: (() => Promise<TokenCache>) | null = null;
let azureHarnessEnsureModelCapsForTests: (() => Promise<void>) | null = null;
let azureHarnessStaticApiKeyForTests: string | null = null;

export function setAzureHarnessTimerApiForTests(timerApi: AzureHarnessTimerApi | null): void {
  azureHarnessTimerApi = timerApi ?? globalThis;
}

export function setAzureHarnessBootstrapHooksForTests(hooks: {
  timerApi?: AzureHarnessTimerApi;
  ensureToken?: () => Promise<TokenCache>;
  ensureModelCaps?: () => Promise<void>;
  staticApiKey?: string;
} | null): void {
  azureHarnessTimerApi = hooks?.timerApi ?? globalThis;
  azureHarnessEnsureTokenForTests = hooks?.ensureToken ?? null;
  azureHarnessEnsureModelCapsForTests = hooks?.ensureModelCaps ?? null;
  azureHarnessStaticApiKeyForTests = hooks && "staticApiKey" in hooks ? hooks.staticApiKey ?? "" : null;
}

export default function (pi: ExtensionAPI) {
  logExtensionLoaded();

  pi.on("context", async (event, ctx) => {
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
  });

  // ── Delivery helper: update placeholder or post new message ──────────
  async function deliver(
    customType: "image" | "flux",
    placeholderId: number | string | null,
    content: string,
  ): Promise<void> {
    // Try updating the placeholder post first
    if (typeof placeholderId === "number" && Number.isFinite(placeholderId)) {
      if (await updatePost(placeholderId, content)) return;
    }
    // Fallback: create a new post or use pi.sendMessage
    const posted = await postPlaceholder(content);
    if (!posted) {
      await pi.sendMessage({ customType, content, display: true });
    }
  }

  function formatError(prefix: string, error: unknown): string {
    if (error instanceof Error) {
      const raw = error.message || String(error);
      // Try to extract structured API error details
      const jsonMatch = raw.match(/\{[\s\S]*"error"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = tryParseJsonRecord(jsonMatch[0], "structured API error body");
        if (parsed) {
          const err = parsed.error || parsed;
          const code = err.code || err.statusCode || "";
          const msg = err.message || err.error || raw;
          return `❌ ${prefix}: ${code ? `[${code}] ` : ""}${msg}`;
        }
      }
      // Extract HTTP status prefix like "400 ..." or "500 ..."
      const httpMatch = raw.match(/^(\d{3})\s+(.+)/s);
      if (httpMatch) {
        const [, status, body] = httpMatch;
        // Try parsing body as JSON
        const parsed = tryParseJsonRecord(body, "HTTP error body");
        if (parsed) {
          const err = parsed.error || parsed;
          const code = err.code || status;
          const msg = err.message || body;
          return `❌ ${prefix}: [${code}] ${msg}`;
        }
        return `❌ ${prefix}: HTTP ${status} — ${body.slice(0, 300)}`;
      }
      // ZlibError or other named errors
      if (raw.includes("ZlibError")) {
        return `❌ ${prefix}: Response decompression failed (ZlibError). The upstream response may be too large or corrupt.`;
      }
      return `❌ ${prefix}: ${raw.slice(0, 500)}`;
    }
    return `❌ ${prefix}: ${String(error).slice(0, 500)}`;
  }

  pi.registerCommand("image", {
    description: "Generate an image with Azure OpenAI",
    handler: async (input, _ctx) => {
      const parsed = parseArgs(input || "");
      if (!parsed) {
        pi.sendMessage({
          customType: "image",
          content:
            "Usage: /image <prompt> [--size 1024x1024] [--count 1] [--quality low|medium|high] [--style natural|vivid]",
          display: true,
        });
        return;
      }

      const snappedSize = snapToSupportedSize(parsed.size);
      const sizeNote = parsed.size && parsed.size !== snappedSize ? ` (${parsed.size} → ${snappedSize})` : "";
      const statusText = `⏳ Generating image… (${AOAI_IMAGE_MODEL_ID}, ${snappedSize}${sizeNote})`;
      const placeholderId = await postPlaceholder(statusText);
      if (!placeholderId) {
        pi.sendMessage({ customType: "image", content: statusText, display: true });
      }

      void (async () => {
        try {
          const images = await generateImage(BASE_URL, AOAI_IMAGE_MODEL_ID, parsed, true);
          const lines = saveImages("azure-image", parsed.prompt, images);
          const caption = `Azure image (${AOAI_IMAGE_MODEL_ID}, ${snappedSize}) — ${parsed.prompt}`;
          const message = [caption, "", ...lines].join("\n");
          await deliver("image", placeholderId, message);
        } catch (error) {
          await deliver("image", placeholderId, formatError("Image generation failed", error));
        }
      })();
    },
  });

  pi.registerCommand("flux", {
    description: "Generate an image with Azure Foundry (FLUX.2-pro)",
    handler: async (input, _ctx) => {
      const parsed = parseArgs(input || "");
      if (!parsed) {
        pi.sendMessage({
          customType: "flux",
          content:
            "Usage: /flux <prompt> [--size 1024x1024] [--count 1] [--quality low|medium|high]",
          display: true,
        });
        return;
      }

      const size = parseSize(parsed.size);
      const statusText = `⏳ Generating Foundry image… (${FOUNDRY_IMAGE_MODEL_ID}, ${size.width}×${size.height})`;
      const placeholderId = await postPlaceholder(statusText);
      if (!placeholderId) {
        pi.sendMessage({ customType: "flux", content: statusText, display: true });
      }

      void (async () => {
        try {
          const images = await generateFoundryImage(FOUNDRY_IMAGE_MODEL_ID, parsed);
          const lines = saveImages("foundry-image", parsed.prompt, images);
          const caption = `Foundry image (${FOUNDRY_IMAGE_MODEL_ID}, ${size.width}×${size.height}) — ${parsed.prompt}`;
          const message = [caption, "", ...lines].join("\n");
          await deliver("flux", placeholderId, message);
        } catch (error) {
          await deliver("flux", placeholderId, formatError("Foundry image generation failed", error));
        }
      })();
    },
  });

  type AzureHarnessBootstrapUi = {
    setWorkingIndicator?: (options?: { frames?: string[]; intervalMs?: number }) => void;
    setWorkingMessage?: (message?: string) => void;
    setStatus?: (key: string, value: string | undefined) => void;
    notify?: (message: string, type?: "error" | "info" | "warning") => void;
  };

  const startAzureHarnessBootstrapUi = (ui?: AzureHarnessBootstrapUi) => {
    if (!ui) return;
    ui.setWorkingIndicator?.({ frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], intervalMs: 90 });
    ui.setWorkingMessage?.("Azure harness: refreshing provider bootstrap…");
  };

  const finishAzureHarnessBootstrapUi = (ui?: AzureHarnessBootstrapUi) => {
    if (!ui) return;
    ui.setWorkingMessage?.(undefined);
    ui.setWorkingIndicator?.({ frames: [] });
  };

  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearRefreshTimer = () => {
    if (timer) azureHarnessTimerApi.clearTimeout(timer);
    timer = null;
  };

  const scheduleNext = (expiresOnEpoch?: number) => {
    clearRefreshTimer();
    const now = Math.floor(Date.now() / 1000);
    const delaySeconds = expiresOnEpoch
      ? Math.max(60, expiresOnEpoch - now - SKEW_SECONDS)
      : 60;
    timer = azureHarnessTimerApi.setTimeout(() => void refresh(), delaySeconds * 1000);
  };

  const refresh = async () => {
    logExtensionLoaded();
    // In proxy/api-key mode, register once with the static key and don't
    // schedule periodic refreshes — the remote proxy handles MI tokens.
    const staticApiKey = azureHarnessStaticApiKeyForTests ?? STATIC_API_KEY;
    if (staticApiKey) {
      registerProvider(pi, staticApiKey);
      return;
    }
    const cache = await (azureHarnessEnsureTokenForTests ?? ensureToken)();
    if (cache.accessToken) {
      await (azureHarnessEnsureModelCapsForTests ?? ensureAzureModelCaps)();
      registerProvider(pi, cache.accessToken);
    }
    scheduleNext(cache.expiresOnEpoch);
  };

  pi.on("session_start", async (_event, ctx) => {
    const ui = ctx?.hasUI ? ctx.ui : undefined;
    startAzureHarnessBootstrapUi(ui);
    clearRefreshTimer();
    try {
      await refresh();
      ui?.setStatus?.("azure-openai", "Azure harness providers ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      clearRefreshTimer();
      ui?.setStatus?.("azure-openai", undefined);
      ui?.notify?.(`Azure harness bootstrap failed: ${message}`, "error");
      throw error;
    } finally {
      finishAzureHarnessBootstrapUi(ui);
    }
  });

  pi.on("session_shutdown", (event) => {
    console.log(`[azure-openai-harness] session shutdown (${event?.reason ?? "unknown"})${event?.targetSessionFile ? ` → ${event.targetSessionFile}` : ""}`);
    clearRefreshTimer();
  });
}
