#!/usr/bin/env bun
/**
 * azure-openai-harness.ts — Standalone Azure OpenAI/Foundry endpoint harness.
 *
 * Uses `extensions/experimental/azure-openai.harness.ts`, a copy of the live extension that can
 * be modified independently for experiments. Re-run this script after edits — no
 * piclaw rebuild or reload required.
 *
 * Default behavior:
 *   - loads the same AOAI_/FOUNDRY_ env config that piclaw uses
 *   - reads ~/.pi/agent/settings.json for default thinking/model context
 *   - registers models through the harness copy's `registerAzureProviders()`
 *   - exercises each configured model with smoke/json/tool round-trip cases
 *   - writes a JSON report under /workspace/tmp
 *
 * Usage examples:
 *   bun run scripts/azure-openai-harness.ts
 *   bun run scripts/azure-openai-harness.ts --list
 *   bun run scripts/azure-openai-harness.ts --providers azure-openai --models gpt-5-3-codex,gpt-4o
 *   bun run scripts/azure-openai-harness.ts --cases smoke,json --reasoning high
 *   bun run scripts/azure-openai-harness.ts --out /workspace/tmp/aoai-harness.json
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";
import type {
  Api,
  AssistantMessage,
  Context,
  Message,
  Model,
  SimpleStreamOptions,
  ThinkingLevel,
  Tool,
  ToolCall,
  ToolResultMessage,
} from "@earendil-works/pi-ai";

type HarnessCaseName = "smoke" | "json" | "tool" | "history";

type RegisteredProvider = {
  name: string;
  baseUrl: string;
  api: string;
  apiKey?: string;
  headers?: Record<string, string>;
  streamSimple: (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => AsyncIterable<any>;
  models?: Array<Partial<Model<Api>> & { id: string; name: string }>;
};

type HarnessModel = Model<Api> & {
  providerConfig: RegisteredProvider;
};

type HarnessArgs = {
  list: boolean;
  providers?: string[];
  models?: string[];
  cases: HarnessCaseName[];
  reasoning?: string;
  timeoutMs: number;
  maxTokens: number;
  repeats: number;
  toolRounds: number;
  historyTurns: number;
  retry429Max: number;
  retry429BaseMs: number;
  cooldownMs: number;
  forceToolChoiceRequired: boolean;
  outPath?: string;
  failFast: boolean;
};

type AgentSettings = {
  defaultProvider?: string;
  defaultModel?: string;
  defaultThinkingLevel?: string;
};

type RunResult = {
  provider: string;
  model: string;
  api: string;
  case: HarnessCaseName;
  attempt?: number;
  reasoning?: string;
  ok: boolean;
  durationMs: number;
  stopReason?: string;
  error?: string;
  failureClass?: string;
  outputPreview?: string;
  textLength?: number;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  usage?: AssistantMessage["usage"];
  payloadSummary?: Record<string, unknown>;
  followUpStopReason?: string;
  followUpPreview?: string;
  events?: Record<string, number>;
  rounds?: Array<Record<string, unknown>>;
  retries?: number;
  retryDelaysMs?: number[];
  payloadCaptureFiles?: string[];
};

type PayloadCapture = {
  label: string;
  payload: unknown;
  summary?: Record<string, unknown>;
};

type PayloadMeta = {
  headers?: Record<string, string | null>;
};

type HarnessReport = {
  generatedAt: string;
  cwd: string;
  script: string;
  harnessExtension: string;
  settings: AgentSettings;
  environment: Record<string, unknown>;
  models: Array<{ provider: string; id: string; name: string; api: string; reasoning: boolean; baseUrl: string }>;
  results: RunResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    byCase: Record<string, { passed: number; failed: number }>;
  };
};

// Provider harnesses intentionally make paid calls; never discover live credentials implicitly.
const SETTINGS_PATH = process.env.PICLAW_PROVIDER_TEST_SETTINGS || "";
const HARNESS_EXTENSION_PATH = resolve(import.meta.dir, "../extensions/experimental/azure-openai.harness.ts");
const DEFAULT_OUT_DIR = "/workspace/tmp";
const BUNDLED_HARNESS_EXTENSION_PATH = resolve(import.meta.dir, "../../.tmp/azure-openai.harness.bundle.mjs");
const DEFAULT_CASES: HarnessCaseName[] = ["smoke", "json", "tool", "history"];
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_MAX_TOKENS = 512;
const DEFAULT_REPEATS = 1;
const DEFAULT_TOOL_ROUNDS = 3;
const DEFAULT_HISTORY_TURNS = 4;
const DEFAULT_RETRY_429_MAX = 4;
const DEFAULT_RETRY_429_BASE_MS = 15_000;
const DEFAULT_COOLDOWN_MS = 3_000;
const PAYLOAD_CAPTURE_DIR = resolve("/workspace/tmp/azure-openai-harness-payloads");
const REQUIRE_EXPERIMENTAL_AZURE_CLIENT_REQUEST_ID = /^(1|true|yes)$/i.test(process.env.AOAI_EXPERIMENT_AZURE_CLIENT_REQUEST_ID || "");

type HarnessExtensionModule = {
  registerAzureProviders: typeof import("../extensions/experimental/azure-openai.harness.ts").registerAzureProviders;
  resolveAzureProviderToken: typeof import("../extensions/experimental/azure-openai.harness.ts").resolveAzureProviderToken;
};

function parseCsv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

function parseArgs(argv: string[]): HarnessArgs {
  const args: HarnessArgs = {
    list: false,
    cases: [...DEFAULT_CASES],
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxTokens: DEFAULT_MAX_TOKENS,
    repeats: DEFAULT_REPEATS,
    toolRounds: DEFAULT_TOOL_ROUNDS,
    historyTurns: DEFAULT_HISTORY_TURNS,
    retry429Max: DEFAULT_RETRY_429_MAX,
    retry429BaseMs: DEFAULT_RETRY_429_BASE_MS,
    cooldownMs: DEFAULT_COOLDOWN_MS,
    forceToolChoiceRequired: false,
    failFast: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--list") {
      args.list = true;
      continue;
    }
    if (arg === "--fail-fast") {
      args.failFast = true;
      continue;
    }
    if (arg === "--force-tool-choice-required") {
      args.forceToolChoiceRequired = true;
      continue;
    }
    if ((arg === "--providers" || arg === "--provider") && next) {
      args.providers = parseCsv(next);
      i += 1;
      continue;
    }
    if ((arg === "--models" || arg === "--model") && next) {
      args.models = parseCsv(next);
      i += 1;
      continue;
    }
    if ((arg === "--cases" || arg === "--case") && next) {
      const parsed = parseCsv(next)?.filter((value): value is HarnessCaseName =>
        ["smoke", "json", "tool", "history"].includes(value)
      );
      if (parsed?.length) args.cases = parsed;
      i += 1;
      continue;
    }
    if (arg === "--reasoning" && next) {
      args.reasoning = next.trim();
      i += 1;
      continue;
    }
    if (arg === "--timeout-ms" && next) {
      const value = Number(next);
      if (Number.isFinite(value) && value > 0) args.timeoutMs = value;
      i += 1;
      continue;
    }
    if (arg === "--max-tokens" && next) {
      const value = Number(next);
      if (Number.isFinite(value) && value > 0) args.maxTokens = Math.floor(value);
      i += 1;
      continue;
    }
    if (arg === "--repeats" && next) {
      const value = Number(next);
      if (Number.isFinite(value) && value > 0) args.repeats = Math.floor(value);
      i += 1;
      continue;
    }
    if (arg === "--tool-rounds" && next) {
      const value = Number(next);
      if (Number.isFinite(value) && value > 0) args.toolRounds = Math.floor(value);
      i += 1;
      continue;
    }
    if (arg === "--history-turns" && next) {
      const value = Number(next);
      if (Number.isFinite(value) && value > 1) args.historyTurns = Math.floor(value);
      i += 1;
      continue;
    }
    if (arg === "--retry-429-max" && next) {
      const value = Number(next);
      if (Number.isFinite(value) && value >= 0) args.retry429Max = Math.floor(value);
      i += 1;
      continue;
    }
    if (arg === "--retry-429-base-ms" && next) {
      const value = Number(next);
      if (Number.isFinite(value) && value > 0) args.retry429BaseMs = Math.floor(value);
      i += 1;
      continue;
    }
    if (arg === "--cooldown-ms" && next) {
      const value = Number(next);
      if (Number.isFinite(value) && value >= 0) args.cooldownMs = Math.floor(value);
      i += 1;
      continue;
    }
    if (arg === "--out" && next) {
      args.outPath = resolve(next);
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function printHelp(): void {
  console.log(`Azure OpenAI harness\n\n` +
    `Options:\n` +
    `  --list                    List discovered models and exit\n` +
    `  --providers <csv>         Filter providers (azure-openai, azure-foundry)\n` +
    `  --models <csv>            Filter model IDs\n` +
    `  --cases <csv>             smoke,json,tool,history (default: ${DEFAULT_CASES.join(",")})\n` +
    `  --reasoning <level>       Override reasoning level for reasoning models\n` +
    `  --timeout-ms <n>          Per-request timeout (default: ${DEFAULT_TIMEOUT_MS})\n` +
    `  --max-tokens <n>          Max output tokens per request (default: ${DEFAULT_MAX_TOKENS})\n` +
    `  --repeats <n>             Repeat each case N times (default: ${DEFAULT_REPEATS})\n` +
    `  --tool-rounds <n>         Tool exchanges per tool case (default: ${DEFAULT_TOOL_ROUNDS})\n` +
    `  --history-turns <n>       Turns in history case (default: ${DEFAULT_HISTORY_TURNS})\n` +
    `  --retry-429-max <n>       Retries for rate-limited requests (default: ${DEFAULT_RETRY_429_MAX})\n` +
    `  --retry-429-base-ms <n>   Base backoff for 429 retries (default: ${DEFAULT_RETRY_429_BASE_MS})\n` +
    `  --cooldown-ms <n>         Cooldown between case attempts on the same model (default: ${DEFAULT_COOLDOWN_MS})\n` +
    `  --force-tool-choice-required  Force tool_choice=required for tool-request turns\n` +
    `  --out <path>              JSON report path (default: /workspace/tmp/azure-openai-harness-*.json)\n` +
    `  --fail-fast               Stop on first failed case\n`
  );
}

function readJsonFile<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function readAgentSettings(): AgentSettings {
  return readJsonFile<AgentSettings>(SETTINGS_PATH, {});
}

async function loadHarnessExtension(): Promise<HarnessExtensionModule> {
  console.log("[build] Bundling current harness copy...");
  mkdirSync(dirname(BUNDLED_HARNESS_EXTENSION_PATH), { recursive: true });
  await Bun.$`bun build ${HARNESS_EXTENSION_PATH} --target bun --format esm --outfile ${BUNDLED_HARNESS_EXTENSION_PATH}`.cwd(resolve(import.meta.dir, ".."));
  const importUrl = pathToFileURL(BUNDLED_HARNESS_EXTENSION_PATH);
  importUrl.searchParams.set("t", String(Date.now()));
  return await import(importUrl.href) as HarnessExtensionModule;
}

async function collectProviders(
  extension: HarnessExtensionModule,
  token: string
): Promise<RegisteredProvider[]> {
  const providers: RegisteredProvider[] = [];
  extension.registerAzureProviders((name, config) => {
    providers.push({ name, ...(config as Omit<RegisteredProvider, "name">) });
  }, token);
  return providers;
}

function materializeModels(providers: RegisteredProvider[]): HarnessModel[] {
  return providers.flatMap((providerConfig) => {
    const models = providerConfig.models || [];
    return models.map((model) => ({
      id: model.id || "",
      name: model.name || model.id || "",
      api: (model.api || providerConfig.api) as Api,
      provider: providerConfig.name,
      baseUrl: providerConfig.baseUrl,
      reasoning: Boolean(model.reasoning),
      input: (model.input || ["text"]) as Array<"text" | "image">,
      contextWindow: Number(model.contextWindow || 0),
      maxTokens: Number(model.maxTokens || 0),
      cost: model.cost || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      headers: model.headers || providerConfig.headers,
      compat: model.compat,
      providerConfig,
    } satisfies HarnessModel));
  });
}

function isThinkingLevel(value: string): value is ThinkingLevel {
  return ["minimal", "low", "medium", "high", "xhigh", "max"].includes(value);
}

function filterModels(models: HarnessModel[], args: HarnessArgs): HarnessModel[] {
  let next = models;
  if (args.providers?.length) {
    const allowed = new Set(args.providers);
    next = next.filter((model) => allowed.has(String(model.provider)));
  }
  if (args.models?.length) {
    const allowed = new Set(args.models);
    next = next.filter((model) => allowed.has(model.id));
  }
  return next;
}

function selectReasoning(
  model: HarnessModel,
  requested: string | undefined,
  explicit = false
): ThinkingLevel | undefined {
  if (!model.reasoning) return undefined;
  const base = requested || "high";
  if (!explicit && model.id === "gpt-5-mini" && base === "high") return "medium";
  return isThinkingLevel(base) ? base : "high";
}

function userMessage(text: string): Message {
  return { role: "user", content: text, timestamp: Date.now() };
}

function textBlocksToString(message: AssistantMessage | undefined): string {
  if (!message) return "";
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

function collectKeyPaths(value: unknown, keyName: string, path = "$", out: string[] = []): string[] {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectKeyPaths(entry, keyName, `${path}[${index}]`, out));
    return out;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = `${path}.${key}`;
    if (key === keyName) out.push(nextPath);
    collectKeyPaths(entry, keyName, nextPath, out);
  }
  return out;
}

function summarizePayload(payload: unknown, meta?: PayloadMeta): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const obj = payload as Record<string, unknown>;
  const partialJsonPaths = collectKeyPaths(payload, "partialJson");
  return {
    model: obj.model,
    stream: obj.stream,
    max_output_tokens: obj.max_output_tokens,
    temperature: obj.temperature,
    tools: Array.isArray(obj.tools) ? obj.tools.length : undefined,
    inputItems: Array.isArray(obj.input) ? obj.input.length : undefined,
    reasoning: obj.reasoning,
    text: obj.text,
    prompt_cache_key: obj.prompt_cache_key,
    requestHeaders: meta?.headers,
    hasPartialJson: partialJsonPaths.length > 0,
    partialJsonPaths,
  };
}

function normalizeJsonCandidate(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) return fenced[1].trim();
  return trimmed;
}

function prefixEvents(prefix: string, events: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(events).map(([key, value]) => [`${prefix}:${key}`, value]));
}

function createHarnessSessionId(model: HarnessModel, caseName: HarnessCaseName): string {
  const raw = `${String(model.provider)}-${model.id}-${caseName}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return raw.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 96);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "x";
}

function findRequestInvariantFailure(
  captures: PayloadCapture[] | undefined,
  options: {
    sessionId?: string;
    requirePromptCacheKey?: boolean;
    requireSessionHeaders?: boolean;
    requireAzureClientRequestId?: boolean;
  }
): string | undefined {
  if (!captures?.length) return undefined;
  for (const capture of captures) {
    const summary = capture.summary || {};
    if (summary.hasPartialJson) {
      const paths = Array.isArray(summary.partialJsonPaths) ? summary.partialJsonPaths.slice(0, 3).join(", ") : "unknown path";
      return `${capture.label}: request payload still contains partialJson scratch buffers (${paths}).`;
    }
    if (!options.sessionId) continue;
    if (options.requirePromptCacheKey && summary.prompt_cache_key !== options.sessionId) {
      return `${capture.label}: prompt_cache_key did not match the active session id.`;
    }
    const requestHeaders = (summary.requestHeaders && typeof summary.requestHeaders === "object")
      ? summary.requestHeaders as Record<string, unknown>
      : {};
    if (options.requireSessionHeaders) {
      if (requestHeaders.session_id !== options.sessionId) {
        return `${capture.label}: session_id header did not match the active session id.`;
      }
      if (requestHeaders["x-client-request-id"] !== options.sessionId) {
        return `${capture.label}: x-client-request-id header did not match the active session id.`;
      }
    }
    if (options.requireAzureClientRequestId && requestHeaders["x-ms-client-request-id"] !== options.sessionId) {
      return `${capture.label}: x-ms-client-request-id header did not match the active session id.`;
    }
  }
  return undefined;
}

function classifyFailure(result: Partial<RunResult>): string | undefined {
  const error = result.error || "";
  const output = result.outputPreview || "";
  const stopReason = result.stopReason || "";
  if (!error && result.ok) return undefined;
  if (is429ErrorMessage(error)) return "rate_limited_429";
  if (/aborted|timeout/i.test(error) || stopReason === "aborted") return "timeout_or_aborted";
  if (/partialJson scratch buffers/i.test(error)) return "partial_json_leak";
  if (/session id header did not match|prompt_cache_key did not match|x-client-request-id header did not match|x-ms-client-request-id header did not match/i.test(error)) {
    return "session_correlation_mismatch";
  }
  if (/expected a tool call but none was emitted/i.test(error)) return "missing_tool_call";
  if (/tool round-trip did not return the expected final text/i.test(error)) return "tool_followup_mismatch";
  if (/tool history summary did not match expected tokens/i.test(error)) return "tool_history_mismatch";
  if (/Invalid JSON payload/i.test(error)) {
    if (!output.trim()) return "json_empty_output";
    if (/^\{[^}]*$/.test(output.trim())) return "json_truncated_output";
    return "json_invalid_output";
  }
  if (/^Turn \d+: expected /i.test(error)) {
    if (!output.trim()) return "history_empty_output";
    return "history_turn_mismatch";
  }
  if (/Unexpected smoke output/i.test(error)) {
    if (!output.trim()) return "smoke_empty_output";
    return "smoke_mismatch";
  }
  if (stopReason === "error") return "provider_error";
  if ((stopReason === "stop" || stopReason === "length") && !output.trim()) return "empty_text_response";
  return "unknown_failure";
}

function writePayloadCaptureFiles(
  result: Partial<RunResult>,
  captures: PayloadCapture[] | undefined
): string[] {
  if (!captures || captures.length === 0) return [];
  mkdirSync(PAYLOAD_CAPTURE_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = [
    sanitizeFilePart(String(result.provider || "provider")),
    sanitizeFilePart(String(result.model || "model")),
    sanitizeFilePart(String(result.case || "case")),
    `attempt-${result.attempt || 1}`,
    timestamp,
  ].join("__");
  const files: string[] = [];
  captures.forEach((capture, index) => {
    const path = resolve(PAYLOAD_CAPTURE_DIR, `${base}__${String(index + 1).padStart(2, "0")}__${sanitizeFilePart(capture.label)}.json`);
    writeFileSync(path, `${JSON.stringify(capture, null, 2)}\n`);
    files.push(path);
  });
  return files;
}

function is429ErrorMessage(message?: string): boolean {
  if (!message) return false;
  return /(?:^|\D)429(?:\D|$)|rate limit|exceeded the call rate limit|too many requests/i.test(message);
}

function compute429DelayMs(message: string | undefined, attempt: number, baseMs: number): number {
  const text = message || "";
  const retryAfterMatch = text.match(/retry after\s+(\d+)\s*(second|seconds|sec|s|minute|minutes|min|m)/i);
  if (retryAfterMatch) {
    const value = Number(retryAfterMatch[1]);
    const unit = retryAfterMatch[2]?.toLowerCase() || "seconds";
    const multiplier = unit.startsWith("m") ? 60_000 : 1_000;
    if (Number.isFinite(value) && value > 0) return value * multiplier;
  }
  return baseMs * Math.max(1, 2 ** Math.max(0, attempt - 1));
}

async function runSingleStream(
  model: HarnessModel,
  context: Context,
  options: SimpleStreamOptions & {
    timeoutMs: number;
    retry429Max: number;
    retry429BaseMs: number;
    captureLabel?: string;
    sessionId?: string;
    transformPayload?: (payload: unknown, model: HarnessModel) => unknown | undefined;
  }
): Promise<{
  message?: AssistantMessage;
  payloadSummary?: Record<string, unknown>;
  durationMs: number;
  events: Record<string, number>;
  toolCalls: ToolCall[];
  retries: number;
  retryDelaysMs: number[];
  payloadCaptures: PayloadCapture[];
}> {
  const start = Date.now();
  const aggregateEvents: Record<string, number> = {};
  const aggregateToolCalls: ToolCall[] = [];
  const payloadCaptures: PayloadCapture[] = [];
  let payloadSummary: Record<string, unknown> | undefined;
  let message: AssistantMessage | undefined;
  const retryDelaysMs: number[] = [];
  let retries = 0;

  for (let attempt = 0; attempt <= options.retry429Max; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("timeout"), options.timeoutMs);
    const events: Record<string, number> = {};
    const toolCalls: ToolCall[] = [];
    let currentPayloadSummary: Record<string, unknown> | undefined;
    let currentMessage: AssistantMessage | undefined;

    try {
      const stream = model.providerConfig.streamSimple(model, context, {
        apiKey: model.providerConfig.apiKey,
        headers: model.headers,
        sessionId: options.sessionId,
        maxTokens: Math.min(model.maxTokens || options.maxTokens || DEFAULT_MAX_TOKENS, options.maxTokens || DEFAULT_MAX_TOKENS),
        reasoning: options.reasoning,
        maxRetryDelayMs: 5_000,
        signal: controller.signal,
        onPayload: ((payload: unknown, _payloadModel?: unknown, meta?: PayloadMeta) => {
          const transformed = options.transformPayload?.(payload, model);
          const effectivePayload = transformed ?? payload;
          currentPayloadSummary = summarizePayload(effectivePayload, meta);
          payloadCaptures.push({
            label: `${options.captureLabel || "request"}-attempt-${attempt + 1}`,
            payload: effectivePayload,
            summary: currentPayloadSummary,
          });
          return transformed;
        }) as any,
      });

      for await (const event of stream) {
        events[event.type] = (events[event.type] || 0) + 1;
        if (event.type === "toolcall_end") toolCalls.push(event.toolCall);
        if (event.type === "done") currentMessage = event.message;
        if (event.type === "error") currentMessage = event.error;
      }
    } finally {
      clearTimeout(timer);
    }

    for (const [key, value] of Object.entries(events)) {
      aggregateEvents[key] = (aggregateEvents[key] || 0) + value;
    }
    aggregateToolCalls.push(...toolCalls);
    if (currentPayloadSummary) payloadSummary = currentPayloadSummary;
    if (currentMessage) message = currentMessage;

    const errorMessage = currentMessage?.errorMessage;
    const shouldRetry429 = currentMessage?.stopReason === "error"
      && is429ErrorMessage(errorMessage)
      && attempt < options.retry429Max;

    if (!shouldRetry429) {
      return {
        message: currentMessage,
        payloadSummary,
        durationMs: Date.now() - start,
        events: aggregateEvents,
        toolCalls: aggregateToolCalls,
        retries,
        retryDelaysMs,
        payloadCaptures,
      };
    }

    const delayMs = compute429DelayMs(errorMessage, attempt + 1, options.retry429BaseMs);
    retryDelaysMs.push(delayMs);
    retries += 1;
    console.log(`    rate-limited; retrying in ${Math.round(delayMs / 1000)}s (${retries}/${options.retry429Max})`);
    await sleep(delayMs);
  }

  return {
    message,
    payloadSummary,
    durationMs: Date.now() - start,
    events: aggregateEvents,
    toolCalls: aggregateToolCalls,
    retries,
    retryDelaysMs,
    payloadCaptures,
  };
}

async function runSmokeCase(
  model: HarnessModel,
  reasoning: ThinkingLevel | undefined,
  timeoutMs: number,
  maxTokens: number,
  retry429Max: number,
  retry429BaseMs: number
): Promise<RunResult> {
  const prompt = `Reply with exactly: HARNESS_OK ${model.id}`;
  const sessionId = createHarnessSessionId(model, "smoke");
  const result = await runSingleStream(model, { messages: [userMessage(prompt)] }, {
    reasoning,
    sessionId,
    timeoutMs,
    maxTokens,
    retry429Max,
    retry429BaseMs,
    captureLabel: "smoke",
  });
  const text = textBlocksToString(result.message);
  const requestInvariantFailure = findRequestInvariantFailure(result.payloadCaptures, {
    sessionId,
    requirePromptCacheKey: String(model.provider) === "azure-openai" && model.reasoning === true,
    requireSessionHeaders: String(model.provider) === "azure-openai",
    requireAzureClientRequestId: String(model.provider) === "azure-openai" && REQUIRE_EXPERIMENTAL_AZURE_CLIENT_REQUEST_ID,
  });
  const ok = !requestInvariantFailure
    && (result.message?.stopReason === "stop" || result.message?.stopReason === "length")
    && text.includes(`HARNESS_OK ${model.id}`);
  const out: RunResult = {
    provider: String(model.provider),
    model: model.id,
    api: model.api,
    case: "smoke",
    reasoning,
    ok,
    durationMs: result.durationMs,
    stopReason: result.message?.stopReason,
    error: ok ? undefined : requestInvariantFailure || result.message?.errorMessage || `Unexpected smoke output: ${text || "<empty>"}`,
    outputPreview: text.slice(0, 240),
    textLength: text.length,
    usage: result.message?.usage,
    payloadSummary: result.payloadSummary,
    events: result.events,
    retries: result.retries,
    retryDelaysMs: result.retryDelaysMs,
  };
  if (!out.ok) {
    out.failureClass = classifyFailure(out);
    out.payloadCaptureFiles = writePayloadCaptureFiles(out, result.payloadCaptures);
  }
  return out;
}

async function runJsonCase(
  model: HarnessModel,
  reasoning: ThinkingLevel | undefined,
  timeoutMs: number,
  maxTokens: number,
  retry429Max: number,
  retry429BaseMs: number
): Promise<RunResult> {
  const prompt = [
    "Return exactly one compact JSON object and nothing else.",
    `Use this shape: {\"model\":\"${model.id}\",\"sum\":4,\"ok\":true}`,
  ].join(" ");
  const sessionId = createHarnessSessionId(model, "json");
  const result = await runSingleStream(model, { messages: [userMessage(prompt)] }, {
    reasoning,
    sessionId,
    timeoutMs,
    maxTokens,
    retry429Max,
    retry429BaseMs,
    captureLabel: "json",
  });
  const text = textBlocksToString(result.message);
  const normalized = normalizeJsonCandidate(text);
  const parsed = (() => {
    try {
      return JSON.parse(normalized) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();
  const requestInvariantFailure = findRequestInvariantFailure(result.payloadCaptures, {
    sessionId,
    requirePromptCacheKey: String(model.provider) === "azure-openai" && model.reasoning === true,
    requireSessionHeaders: String(model.provider) === "azure-openai",
    requireAzureClientRequestId: String(model.provider) === "azure-openai" && REQUIRE_EXPERIMENTAL_AZURE_CLIENT_REQUEST_ID,
  });
  const ok = !requestInvariantFailure && Boolean(parsed && parsed.model === model.id && parsed.sum === 4 && parsed.ok === true);
  const out: RunResult = {
    provider: String(model.provider),
    model: model.id,
    api: model.api,
    case: "json",
    reasoning,
    ok,
    durationMs: result.durationMs,
    stopReason: result.message?.stopReason,
    error: ok ? undefined : requestInvariantFailure || result.message?.errorMessage || `Invalid JSON payload: ${text || "<empty>"}`,
    outputPreview: text.slice(0, 240),
    textLength: text.length,
    usage: result.message?.usage,
    payloadSummary: result.payloadSummary,
    events: result.events,
    retries: result.retries,
    retryDelaysMs: result.retryDelaysMs,
  };
  if (!out.ok) {
    out.failureClass = classifyFailure(out);
    out.payloadCaptureFiles = writePayloadCaptureFiles(out, result.payloadCaptures);
  }
  return out;
}

async function runToolCase(
  model: HarnessModel,
  reasoning: ThinkingLevel | undefined,
  timeoutMs: number,
  maxTokens: number,
  toolRounds: number,
  retry429Max: number,
  retry429BaseMs: number,
  forceToolChoiceRequired: boolean
): Promise<RunResult> {
  const tool: Tool = {
    name: "echo_probe",
    description: "Return the supplied diagnostic token and model identifier.",
    parameters: {
      type: "object",
      properties: {
        model: { type: "string" },
        token: { type: "string" },
      },
      required: ["model", "token"],
      additionalProperties: false,
    } as any,
  };

  const history: Message[] = [];
  const sessionId = createHarnessSessionId(model, "tool");
  const rounds: Array<Record<string, unknown>> = [];
  const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
  let durationMs = 0;
  let lastPayloadSummary: Record<string, unknown> | undefined;
  let lastUsage: AssistantMessage["usage"] | undefined;
  let finalPreview: string;
  let finalStopReason: string | undefined;
  let retries = 0;
  const retryDelaysMs: number[] = [];
  const allPayloadCaptures: PayloadCapture[] = [];
  const aggregateEvents: Record<string, number> = {};

  const mergeEvents = (prefix: string, events: Record<string, number>) => {
    for (const [key, value] of Object.entries(prefixEvents(prefix, events))) {
      aggregateEvents[key] = (aggregateEvents[key] || 0) + value;
    }
  };

  for (let round = 1; round <= toolRounds; round += 1) {
    const token = `tool-ok-${round}`;
    const firstPrompt = [
      `Round ${round}/${toolRounds}. Call echo_probe exactly once.`,
      `Pass model=\"${model.id}\" and token=\"${token}\".`,
      "Do not answer with normal text before the tool call.",
    ].join(" ");
    history.push(userMessage(firstPrompt));

    const first = await runSingleStream(
      model,
      { messages: [...history], tools: [tool] },
      {
        reasoning,
        sessionId,
        timeoutMs,
        maxTokens,
        retry429Max,
        retry429BaseMs,
        captureLabel: `tool-round-${round}-request`,
        transformPayload: forceToolChoiceRequired
          ? (payload) => {
              if (!payload || typeof payload !== "object") return payload;
              return { ...(payload as Record<string, unknown>), tool_choice: "required" };
            }
          : undefined,
      }
    );
    durationMs += first.durationMs;
    retries += first.retries;
    retryDelaysMs.push(...first.retryDelaysMs);
    allPayloadCaptures.push(...first.payloadCaptures);
    mergeEvents(`round${round}:tool_request`, first.events);
    if (first.payloadSummary) lastPayloadSummary = first.payloadSummary;
    if (first.message?.usage) lastUsage = first.message.usage;
    const firstInvariantFailure = findRequestInvariantFailure(first.payloadCaptures, {
      sessionId,
      requirePromptCacheKey: String(model.provider) === "azure-openai" && model.reasoning === true,
      requireSessionHeaders: String(model.provider) === "azure-openai",
      requireAzureClientRequestId: String(model.provider) === "azure-openai" && REQUIRE_EXPERIMENTAL_AZURE_CLIENT_REQUEST_ID,
    });

    const toolCall = first.toolCalls[0];
    if (firstInvariantFailure || !first.message || first.message.stopReason !== "toolUse" || !toolCall) {
      const out: RunResult = {
        provider: String(model.provider),
        model: model.id,
        api: model.api,
        case: "tool",
        reasoning,
        ok: false,
        durationMs,
        stopReason: first.message?.stopReason,
        error: firstInvariantFailure || first.message?.errorMessage || `Round ${round}: expected a tool call but none was emitted.`,
        outputPreview: textBlocksToString(first.message).slice(0, 240),
        textLength: textBlocksToString(first.message).length,
        usage: lastUsage,
        payloadSummary: lastPayloadSummary,
        toolCalls,
        events: aggregateEvents,
        rounds,
        retries,
        retryDelaysMs,
      };
      out.failureClass = classifyFailure(out);
      out.payloadCaptureFiles = writePayloadCaptureFiles(out, allPayloadCaptures);
      return out;
    }

    history.push(first.message);
    toolCalls.push({ id: toolCall.id, name: toolCall.name, arguments: toolCall.arguments });

    const toolResult: ToolResultMessage = {
      role: "toolResult",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: [{ type: "text", text: JSON.stringify({ model: model.id, token, ok: true, round }) }],
      isError: false,
      timestamp: Date.now(),
    };
    history.push(toolResult);

    const confirmPrompt = `Round ${round}/${toolRounds}. Reply exactly: TOOL_OK ${token} ${model.id} round-${round}`;
    history.push(userMessage(confirmPrompt));
    const followUp = await runSingleStream(
      model,
      { messages: [...history], tools: [tool] },
      {
        reasoning,
        sessionId,
        timeoutMs,
        maxTokens,
        retry429Max,
        retry429BaseMs,
        captureLabel: `tool-round-${round}-followup`,
      }
    );
    durationMs += followUp.durationMs;
    retries += followUp.retries;
    retryDelaysMs.push(...followUp.retryDelaysMs);
    allPayloadCaptures.push(...followUp.payloadCaptures);
    mergeEvents(`round${round}:tool_followup`, followUp.events);
    if (followUp.payloadSummary) lastPayloadSummary = followUp.payloadSummary;
    if (followUp.message?.usage) lastUsage = followUp.message.usage;
    const followUpInvariantFailure = findRequestInvariantFailure(followUp.payloadCaptures, {
      sessionId,
      requirePromptCacheKey: String(model.provider) === "azure-openai" && model.reasoning === true,
      requireSessionHeaders: String(model.provider) === "azure-openai",
      requireAzureClientRequestId: String(model.provider) === "azure-openai" && REQUIRE_EXPERIMENTAL_AZURE_CLIENT_REQUEST_ID,
    });

    const followUpText = textBlocksToString(followUp.message);
    const roundOk = !followUpInvariantFailure
      && (followUp.message?.stopReason === "stop" || followUp.message?.stopReason === "length")
      && followUpText.includes(`TOOL_OK ${token}`)
      && followUpText.includes(model.id)
      && followUpText.includes(`round-${round}`);

    rounds.push({
      round,
      toolCallId: toolCall.id,
      token,
      toolStopReason: first.message.stopReason,
      followUpStopReason: followUp.message?.stopReason,
      followUpPreview: followUpText.slice(0, 240),
      ok: roundOk,
    });

    if (!roundOk) {
      const out: RunResult = {
        provider: String(model.provider),
        model: model.id,
        api: model.api,
        case: "tool",
        reasoning,
        ok: false,
        durationMs,
        stopReason: first.message?.stopReason,
        followUpStopReason: followUp.message?.stopReason,
        error: followUpInvariantFailure || followUp.message?.errorMessage || `Round ${round}: tool round-trip did not return the expected final text.`,
        outputPreview: textBlocksToString(first.message).slice(0, 240),
        followUpPreview: followUpText.slice(0, 240),
        textLength: followUpText.length,
        usage: lastUsage,
        payloadSummary: lastPayloadSummary,
        toolCalls,
        events: aggregateEvents,
        rounds,
        retries,
        retryDelaysMs,
      };
      out.failureClass = classifyFailure(out);
      out.payloadCaptureFiles = writePayloadCaptureFiles(out, allPayloadCaptures);
      return out;
    }

    if (followUp.message) history.push(followUp.message);
  }

  const expectedHistory = Array.from({ length: toolRounds }, (_, index) => `tool-ok-${index + 1}`).join(",");
  const summaryPrompt = `List all tool tokens seen so far in order. Reply exactly: TOOL_HISTORY ${expectedHistory}`;
  history.push(userMessage(summaryPrompt));
  const summary = await runSingleStream(
    model,
    { messages: [...history], tools: [tool] },
    {
      reasoning,
      sessionId,
      timeoutMs,
      maxTokens,
      retry429Max,
      retry429BaseMs,
      captureLabel: "tool-summary",
    }
  );
  durationMs += summary.durationMs;
  retries += summary.retries;
  retryDelaysMs.push(...summary.retryDelaysMs);
  allPayloadCaptures.push(...summary.payloadCaptures);
  mergeEvents("summary", summary.events);
  if (summary.payloadSummary) lastPayloadSummary = summary.payloadSummary;
  if (summary.message?.usage) lastUsage = summary.message.usage;
  const summaryInvariantFailure = findRequestInvariantFailure(summary.payloadCaptures, {
    sessionId,
    requirePromptCacheKey: String(model.provider) === "azure-openai" && model.reasoning === true,
    requireSessionHeaders: String(model.provider) === "azure-openai",
    requireAzureClientRequestId: String(model.provider) === "azure-openai" && REQUIRE_EXPERIMENTAL_AZURE_CLIENT_REQUEST_ID,
  });

  const summaryText = textBlocksToString(summary.message);
  finalPreview = summaryText;
  finalStopReason = summary.message?.stopReason;
  const ok = !summaryInvariantFailure
    && (summary.message?.stopReason === "stop" || summary.message?.stopReason === "length")
    && summaryText.includes(`TOOL_HISTORY ${expectedHistory}`);

  const out: RunResult = {
    provider: String(model.provider),
    model: model.id,
    api: model.api,
    case: "tool",
    reasoning,
    ok,
    durationMs,
    stopReason: finalStopReason,
    error: ok ? undefined : summaryInvariantFailure || summary.message?.errorMessage || "Tool history summary did not match expected tokens.",
    outputPreview: finalPreview.slice(0, 240),
    followUpPreview: summaryText.slice(0, 240),
    textLength: summaryText.length,
    usage: lastUsage,
    payloadSummary: lastPayloadSummary,
    toolCalls,
    events: aggregateEvents,
    rounds,
    retries,
    retryDelaysMs,
  };
  if (!out.ok) {
    out.failureClass = classifyFailure(out);
    out.payloadCaptureFiles = writePayloadCaptureFiles(out, allPayloadCaptures);
  }
  return out;
}

async function runHistoryCase(
  model: HarnessModel,
  reasoning: ThinkingLevel | undefined,
  timeoutMs: number,
  maxTokens: number,
  historyTurns: number,
  retry429Max: number,
  retry429BaseMs: number
): Promise<RunResult> {
  const token = `history-${model.id}-${Date.now().toString(36).slice(-6)}`;
  const sessionId = createHarnessSessionId(model, "history");
  const history: Message[] = [];
  const rounds: Array<Record<string, unknown>> = [];
  const aggregateEvents: Record<string, number> = {};
  let durationMs = 0;
  let lastPayloadSummary: Record<string, unknown> | undefined;
  let lastUsage: AssistantMessage["usage"] | undefined;
  let finalText = "";
  let finalStopReason: string | undefined;
  let retries = 0;
  const retryDelaysMs: number[] = [];
  const allPayloadCaptures: PayloadCapture[] = [];

  for (let turn = 1; turn <= historyTurns; turn += 1) {
    const expected = turn === 1
      ? `HISTORY_OK ${token} turn-1`
      : `HISTORY_OK ${token} turn-${turn}`;
    const prompt = turn === 1
      ? `Remember this token: ${token}. Reply exactly: ${expected}`
      : `What token have I asked you to remember since the first turn? Reply exactly: ${expected}`;
    history.push(userMessage(prompt));
    const step = await runSingleStream(model, { messages: [...history] }, {
      reasoning,
      sessionId,
      timeoutMs,
      maxTokens,
      retry429Max,
      retry429BaseMs,
      captureLabel: `history-turn-${turn}`,
    });
    durationMs += step.durationMs;
    retries += step.retries;
    retryDelaysMs.push(...step.retryDelaysMs);
    allPayloadCaptures.push(...step.payloadCaptures);
    for (const [key, value] of Object.entries(prefixEvents(`turn${turn}`, step.events))) {
      aggregateEvents[key] = (aggregateEvents[key] || 0) + value;
    }
    if (step.payloadSummary) lastPayloadSummary = step.payloadSummary;
    if (step.message?.usage) lastUsage = step.message.usage;
    const stepInvariantFailure = findRequestInvariantFailure(step.payloadCaptures, {
      sessionId,
      requirePromptCacheKey: String(model.provider) === "azure-openai" && model.reasoning === true,
      requireSessionHeaders: String(model.provider) === "azure-openai",
      requireAzureClientRequestId: String(model.provider) === "azure-openai" && REQUIRE_EXPERIMENTAL_AZURE_CLIENT_REQUEST_ID,
    });
    const text = textBlocksToString(step.message);
    finalText = text;
    finalStopReason = step.message?.stopReason;
    const ok = !stepInvariantFailure
      && (step.message?.stopReason === "stop" || step.message?.stopReason === "length")
      && text.includes(expected);
    rounds.push({ turn, expected, stopReason: step.message?.stopReason, preview: text.slice(0, 240), ok });
    if (!ok) {
      const out: RunResult = {
        provider: String(model.provider),
        model: model.id,
        api: model.api,
        case: "history",
        reasoning,
        ok: false,
        durationMs,
        stopReason: step.message?.stopReason,
        error: stepInvariantFailure || step.message?.errorMessage || `Turn ${turn}: expected ${expected}`,
        outputPreview: text.slice(0, 240),
        textLength: text.length,
        usage: lastUsage,
        payloadSummary: lastPayloadSummary,
        events: aggregateEvents,
        rounds,
        retries,
        retryDelaysMs,
      };
      out.failureClass = classifyFailure(out);
      out.payloadCaptureFiles = writePayloadCaptureFiles(out, allPayloadCaptures);
      return out;
    }
    if (step.message) history.push(step.message);
  }

  const out: RunResult = {
    provider: String(model.provider),
    model: model.id,
    api: model.api,
    case: "history",
    reasoning,
    ok: true,
    durationMs,
    stopReason: finalStopReason,
    outputPreview: finalText.slice(0, 240),
    textLength: finalText.length,
    usage: lastUsage,
    payloadSummary: lastPayloadSummary,
    events: aggregateEvents,
    rounds,
    retries,
    retryDelaysMs,
  };
  if (!out.ok) {
    out.failureClass = classifyFailure(out);
    out.payloadCaptureFiles = writePayloadCaptureFiles(out, allPayloadCaptures);
  }
  return out;
}

function defaultOutPath(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return resolve(DEFAULT_OUT_DIR, `azure-openai-harness-${stamp}.json`);
}

function summarize(results: RunResult[]): HarnessReport["summary"] {
  const summary: HarnessReport["summary"] = {
    total: results.length,
    passed: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    byCase: {},
  };
  for (const result of results) {
    summary.byCase[result.case] ||= { passed: 0, failed: 0 };
    summary.byCase[result.case][result.ok ? "passed" : "failed"] += 1;
  }
  return summary;
}

async function main(): Promise<void> {
  if (process.env.PICLAW_PROVIDER_TEST_LIVE !== "1" || !SETTINGS_PATH) {
    throw new Error("Provider tests require PICLAW_PROVIDER_TEST_LIVE=1 and an explicit PICLAW_PROVIDER_TEST_SETTINGS file. Use a disposable provider account/profile.");
  }
  const args = parseArgs(process.argv.slice(2));
  const settings = readAgentSettings();
  const extension = await loadHarnessExtension();
  const token = await extension.resolveAzureProviderToken();
  const providers = await collectProviders(extension, token);
  const models = filterModels(materializeModels(providers), args);

  if (models.length === 0) {
    throw new Error("No Azure harness models matched the current configuration/filters.");
  }

  if (args.list) {
    for (const model of models) {
      console.log([
        String(model.provider),
        model.id,
        model.name,
        model.api,
        model.reasoning ? "reasoning" : "no-reasoning",
        model.baseUrl,
      ].join("\t"));
    }
    return;
  }

  const results: RunResult[] = [];
  const defaultReasoning = args.reasoning || settings.defaultThinkingLevel || "high";

  for (const model of models) {
    const reasoning = selectReasoning(model, defaultReasoning, Boolean(args.reasoning));
    console.log(`\n[model] ${model.provider}/${model.id} (${model.api})`);
    for (const testCase of args.cases) {
      for (let attempt = 1; attempt <= args.repeats; attempt += 1) {
        console.log(`  → ${testCase}#${attempt}${reasoning ? ` [${reasoning}]` : ""}`);
        let result: RunResult;
        if (testCase === "smoke") {
          result = await runSmokeCase(
            model,
            reasoning,
            args.timeoutMs,
            args.maxTokens,
            args.retry429Max,
            args.retry429BaseMs,
          );
        } else if (testCase === "json") {
          result = await runJsonCase(
            model,
            reasoning,
            args.timeoutMs,
            args.maxTokens,
            args.retry429Max,
            args.retry429BaseMs,
          );
        } else if (testCase === "tool") {
          result = await runToolCase(
            model,
            reasoning,
            args.timeoutMs,
            args.maxTokens,
            args.toolRounds,
            args.retry429Max,
            args.retry429BaseMs,
            args.forceToolChoiceRequired,
          );
        } else {
          result = await runHistoryCase(
            model,
            reasoning,
            args.timeoutMs,
            args.maxTokens,
            args.historyTurns,
            args.retry429Max,
            args.retry429BaseMs,
          );
        }
        result.attempt = attempt;
        results.push(result);
        console.log(`    ${result.ok ? "PASS" : "FAIL"} ${result.durationMs}ms${result.error ? ` — ${result.error}` : ""}`);
        if (!result.ok && args.failFast) break;
        const isLastAttempt = attempt === args.repeats;
        const isLastCase = testCase === args.cases[args.cases.length - 1];
        if (args.cooldownMs > 0 && (!isLastAttempt || !isLastCase)) {
          console.log(`    cooling down for ${Math.round(args.cooldownMs / 1000)}s`);
          await sleep(args.cooldownMs);
        }
      }
      if (args.failFast && results.some((result) => !result.ok)) break;
    }
    if (args.failFast && results.some((result) => !result.ok)) break;
  }

  const report: HarnessReport = {
    generatedAt: new Date().toISOString(),
    cwd: process.cwd(),
    script: basename(import.meta.path),
    harnessExtension: HARNESS_EXTENSION_PATH,
    settings,
    environment: {
      AOAI_BASE_URL: process.env.AOAI_BASE_URL || null,
      AOAI_MODEL_IDS: process.env.AOAI_MODEL_IDS || null,
      AOAI_MODEL_NAMES: process.env.AOAI_MODEL_NAMES || null,
      FOUNDRY_BASE_URL: process.env.FOUNDRY_BASE_URL || null,
      FOUNDRY_MODEL_IDS: process.env.FOUNDRY_MODEL_IDS || null,
      FOUNDRY_MODEL_NAMES: process.env.FOUNDRY_MODEL_NAMES || null,
      AOAI_DISABLE_REASONING_MODELS: process.env.AOAI_DISABLE_REASONING_MODELS || null,
      AOAI_TOOL_CALL_LIMITS_BY_MODEL: process.env.AOAI_TOOL_CALL_LIMITS_BY_MODEL || null,
      AOAI_MAX_OUTPUT_TOKENS_BY_MODEL: process.env.AOAI_MAX_OUTPUT_TOKENS_BY_MODEL || null,
      HARNESS_CASES: args.cases.join(","),
      HARNESS_REPEATS: args.repeats,
      HARNESS_TOOL_ROUNDS: args.toolRounds,
      HARNESS_HISTORY_TURNS: args.historyTurns,
      HARNESS_TIMEOUT_MS: args.timeoutMs,
      HARNESS_MAX_TOKENS: args.maxTokens,
      HARNESS_RETRY_429_MAX: args.retry429Max,
      HARNESS_RETRY_429_BASE_MS: args.retry429BaseMs,
      HARNESS_COOLDOWN_MS: args.cooldownMs,
      HARNESS_FORCE_TOOL_CHOICE_REQUIRED: args.forceToolChoiceRequired,
      HARNESS_PAYLOAD_CAPTURE_DIR: PAYLOAD_CAPTURE_DIR,
    },
    models: models.map((model) => ({
      provider: String(model.provider),
      id: model.id,
      name: model.name,
      api: model.api,
      reasoning: model.reasoning,
      baseUrl: model.baseUrl,
    })),
    results,
    summary: summarize(results),
  };

  const outPath = args.outPath || defaultOutPath();
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`\nReport written: ${outPath}`);
  console.log(`Summary: ${report.summary.passed}/${report.summary.total} passed`);
  if (report.summary.failed > 0) process.exitCode = 1;
}

await main();
