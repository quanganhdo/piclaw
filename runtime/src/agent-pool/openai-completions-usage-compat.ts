import {
  calculateCost,
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Context,
  type FetchFunction,
  type Model,
  type ModelsApiStreamOptions,
  type ModelsSimpleStreamOptions,
  type Usage,
} from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

import { createLogger, debugSuppressedError } from "../utils/logger.js";

const log = createLogger("agent-pool.openai-completions-usage-compat");
const MAX_SSE_LINE_CHARS = 256 * 1024;
const MAX_RESPONSE_SCANS = 16;
const usageCompatInstalled = Symbol("piclaw.openAICompletionsUsageCompatInstalled");

type UsageProvenance = {
  promptTokens: number;
  cacheRead: number;
  cacheWrite: number;
  cacheReadReported: boolean;
  cacheWriteReported: boolean;
  providerCost?: number;
};

type MutableModelRuntime = ModelRuntime & {
  [usageCompatInstalled]?: true;
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readUsageProvenance(value: unknown): UsageProvenance | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const usage = value as Record<string, unknown>;
  const details = usage.prompt_tokens_details && typeof usage.prompt_tokens_details === "object" && !Array.isArray(usage.prompt_tokens_details)
    ? usage.prompt_tokens_details as Record<string, unknown>
    : null;
  const cacheReadCandidates = [details?.cached_tokens, usage.prompt_cache_hit_tokens, usage.cached_tokens];
  const finiteCacheReads = cacheReadCandidates.map(finiteNumber);
  const cacheRead = finiteCacheReads.find((candidate) => candidate !== null) ?? 0;
  const rawCacheWrite = finiteNumber(details?.cache_write_tokens);
  const providerCost = finiteNumber(usage.cost);
  return {
    promptTokens: finiteNumber(usage.prompt_tokens) ?? 0,
    cacheRead,
    cacheWrite: rawCacheWrite ?? 0,
    cacheReadReported: finiteCacheReads.some((candidate) => candidate !== null),
    cacheWriteReported: rawCacheWrite !== null,
    ...(providerCost !== null && providerCost >= 0 ? { providerCost } : {}),
  };
}

function readChunkUsageProvenance(value: unknown): UsageProvenance | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const chunk = value as Record<string, unknown>;
  const direct = readUsageProvenance(chunk.usage);
  if (direct) return direct;
  const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
  for (const choice of choices) {
    if (!choice || typeof choice !== "object" || Array.isArray(choice)) continue;
    const nested = readUsageProvenance((choice as Record<string, unknown>).usage);
    if (nested) return nested;
  }
  return null;
}

interface UsageCapture { done: Promise<UsageProvenance | null>; latest: UsageProvenance | null; cancel(): void }
const TERMINAL_SCAN_WAIT_MS = 100;

export async function scanOpenAICompletionsUsage(response: Response, signal?: AbortSignal, update?: (usage: UsageProvenance) => void): Promise<UsageProvenance | null> {
  const contentType = response.headers.get("content-type")?.toLowerCase();
  if (contentType && !contentType.includes("text/event-stream")) return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const cancel = () => { void reader.cancel().catch(() => { log.warn("Usage scan cancellation failed", { operation: "openai_completions_usage.scan_cancel" }); }); };
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const decoder = new TextDecoder();
  let buffer = "";
  let latest: UsageProvenance | null = null;
  let finished = false;

  const inspect = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (data === "[DONE]") { finished = true; return; }
    if (!data || data.length > MAX_SSE_LINE_CHARS || !data.includes('"usage"')) return;
    try {
      latest = readChunkUsageProvenance(JSON.parse(data)) ?? latest;
      if (latest) update?.(latest);
    } catch (error) {
      debugSuppressedError(log, "Ignored malformed OpenAI-compatible usage event", error, {
        operation: "openai_completions_usage.parse_event",
      });
    }
  };

  try {
    while (!finished && !signal?.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0 && !finished) {
        inspect(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
      if (buffer.length > MAX_SSE_LINE_CHARS) buffer = "";
    }
    if (!finished && !signal?.aborted) {
      buffer += decoder.decode();
      if (buffer) inspect(buffer);
    }
  } catch (error) {
    debugSuppressedError(log, "Stopped best-effort OpenAI-compatible usage scan", error, {
      operation: "openai_completions_usage.scan_response",
    });
    return latest;
  } finally {
    signal?.removeEventListener('abort', cancel);
    if (finished || signal?.aborted) cancel();
    reader.releaseLock();
  }
  return latest;
}

function createUsageCapturingFetch(
  fetchImpl: FetchFunction,
  captures: UsageCapture[],
  signal?: AbortSignal,
): FetchFunction {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetchImpl(input, init);
    try {
      const controller = new AbortController();
      const capture: UsageCapture = { latest: null, done: Promise.resolve(null), cancel: () => controller.abort() };
      capture.done = scanOpenAICompletionsUsage(response.clone(), controller.signal, usage => { capture.latest = usage; });
      captures.push(capture);
      if (signal?.aborted) capture.cancel();
      if (captures.length > MAX_RESPONSE_SCANS) captures.shift()?.cancel();
    } catch (error) {
      debugSuppressedError(log, "Could not clone OpenAI-compatible response for usage scan", error, {
        operation: "openai_completions_usage.clone_response",
      });
    }
    return response;
  }) as FetchFunction;
}

async function latestCapturedUsage(captures: UsageCapture[], aborted = false): Promise<UsageProvenance | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!aborted) await Promise.race([Promise.allSettled(captures.map(capture => capture.done)), new Promise<void>(resolve => { timer = setTimeout(resolve, TERMINAL_SCAN_WAIT_MS); })]);
  } finally { clearTimeout(timer); for (const capture of captures) capture.cancel(); }
  for (let index = captures.length - 1; index >= 0; index--) if (captures[index].latest) return captures[index].latest;
  return null;
}

type UsageWithProvenance = Usage & {
  cacheReadReported?: boolean;
  cacheWriteReported?: boolean;
  providerCost?: number;
};

function mergeUsageProvenance(
  model: Model<Api>,
  usage: Usage,
  provenance: UsageProvenance | null,
): UsageWithProvenance {
  if (!provenance) return usage;
  const next: UsageWithProvenance = {
    ...usage,
    cost: { ...usage.cost },
    input: Math.max(0, provenance.promptTokens - provenance.cacheRead - provenance.cacheWrite),
    cacheRead: provenance.cacheRead,
    cacheWrite: provenance.cacheWrite,
    cacheReadReported: provenance.cacheReadReported,
    cacheWriteReported: provenance.cacheWriteReported,
    ...(provenance.providerCost !== undefined ? { providerCost: provenance.providerCost } : {}),
  };
  next.totalTokens = next.input + next.output + next.cacheRead + next.cacheWrite;
  calculateCost(model, next);
  return next;
}

function withTerminalUsage(model: Model<Api>, message: AssistantMessage, provenance: UsageProvenance | null): AssistantMessage {
  const usage = mergeUsageProvenance(model, message.usage, provenance);
  return usage === message.usage ? message : { ...message, usage };
}

function wrapOpenAICompletionsStream(
  model: Model<Api>,
  start: (options: Record<string, unknown>) => AssistantMessageEventStream,
  options: Record<string, unknown> = {},
): AssistantMessageEventStream {
  if (model.api !== "openai-completions") return start(options);
  const captures: UsageCapture[] = [];
  const signal = options.signal as AbortSignal | undefined;
  const cancelCaptures = () => { for (const capture of captures) capture.cancel(); };
  signal?.addEventListener('abort', cancelCaptures, { once: true });
  const fetchImpl = typeof options.fetch === "function" ? options.fetch as FetchFunction : globalThis.fetch;
  let source: AssistantMessageEventStream;
  try { source = start({ ...options, fetch: createUsageCapturingFetch(fetchImpl, captures, signal) }); }
  catch (error) { signal?.removeEventListener('abort', cancelCaptures); cancelCaptures(); throw error; }
  const target = createAssistantMessageEventStream();

  void (async () => {
    for await (const event of source) {
      if (event.type === "done") {
        const message = withTerminalUsage(model, event.message, await latestCapturedUsage(captures, signal?.aborted));
        target.push({ ...event, message });
      } else if (event.type === "error") {
        const error = withTerminalUsage(model, event.error, await latestCapturedUsage(captures, signal?.aborted));
        target.push({ ...event, error });
      } else {
        target.push(event as AssistantMessageEvent);
      }
    }
    target.end();
  })().finally(() => { signal?.removeEventListener('abort', cancelCaptures); cancelCaptures(); }).catch((error) => {
    const message: AssistantMessage = {
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
      stopReason: "error",
      errorMessage: error instanceof Error ? error.message : String(error),
      timestamp: Date.now(),
    };
    target.push({ type: "error", reason: "error", error: message });
    target.end(message);
  });
  return target;
}

/** Preserve OpenAI-compatible cache/cost provenance without package-manager patches. */
export function installOpenAICompletionsUsageCompatibility(runtime: ModelRuntime): void {
  const mutable = runtime as MutableModelRuntime;
  if (mutable[usageCompatInstalled]) return;
  if (typeof runtime.stream !== "function" || typeof runtime.streamSimple !== "function") return;
  const stream = runtime.stream.bind(runtime);
  const streamSimple = runtime.streamSimple.bind(runtime);
  runtime.stream = ((model: Model<Api>, context: Context, options?: ModelsApiStreamOptions<Api>) =>
    wrapOpenAICompletionsStream(model, (nextOptions) => stream(model, context, nextOptions as ModelsApiStreamOptions<Api>), options as Record<string, unknown> | undefined)) as ModelRuntime["stream"];
  runtime.streamSimple = ((model: Model<Api>, context: Context, options?: ModelsSimpleStreamOptions) =>
    wrapOpenAICompletionsStream(model, (nextOptions) => streamSimple(model, context, nextOptions as ModelsSimpleStreamOptions), options as Record<string, unknown> | undefined)) as ModelRuntime["streamSimple"];
  mutable[usageCompatInstalled] = true;
}
