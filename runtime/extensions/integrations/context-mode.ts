/**
 * context-mode.ts – Tool-output storage and search extension.
 *
 * Intercepts large eligible tool results, stores them on disk, and replaces
 * the inline output with a compact preview + search handle. Also registers
 * the batch_exec and search_tool_output tools.
 *
 * Activated unconditionally (no env-var gate).
 */
import { createHash } from "node:crypto";
import type { Message } from "@earendil-works/pi-ai";

import {
  buildPreview,
  canUseLegacyToolOutput,
  createToolOutputAccessGuard,
  ToolOutputAccessDenied,
  createBatchExecTool,
  createToolOutputSearchTool,
  getToolResultCompactionEnabled,
  getToolResultCompactionThresholdsByTool,
  getToolResultCompactionTools,
  getToolResultSemanticSummaryConfig,
  readToolOutputFile,
  saveToolOutput,
} from "../../src/extensions/context-mode-api.js";
import { getToolOutputPresentationConfig } from "../../src/core/config.js";
import { getRuntimeModelExecutor } from "../../src/extensions/model-execution-runtime.js";

const { storeBytes: DEFAULT_STORE_THRESHOLD_BYTES, storeLines: DEFAULT_STORE_THRESHOLD_LINES, previewLines: PREVIEW_LINES, previewLineChars: PREVIEW_LINE_CHARS } = getToolOutputPresentationConfig();
const STORED_OUTPUT_CACHE_MAX = 512;

type StoredOutputCacheEntry = {
  saved: ReturnType<typeof saveToolOutput>;
  summary: string;
  semantic: boolean;
};

const storedOutputByDigest = new Map<string, StoredOutputCacheEntry>();

type RuntimeExtensionContext = {
  model?: any;
  modelRegistry?: any;
  signal?: AbortSignal;
};

type SemanticSummaryRequest = {
  toolName: string;
  source: string;
  fullOutput: string;
  lineCount: number;
  sizeBytes: number;
};

type SemanticSummarizer = (
  request: SemanticSummaryRequest,
  extensionContext: RuntimeExtensionContext | undefined,
) => Promise<string | null>;

const TOOL_RESULT_SEMANTIC_SYSTEM_PROMPT = [
  "You summarize tool output for an LLM coding agent.",
  "Write a compact, factual summary with exactly these sections:",
  "Summary:",
  "Key facts:",
  "Warnings/Errors:",
  "Follow-up cues:",
  "Rules:",
  "- Do not invent information.",
  "- Keep critical file paths, command names, IDs, and counts exact when present.",
  "- If there are no warnings/errors, write 'none'.",
  "- Use terse bullets.",
].join("\n");

let semanticSummarizerOverride: SemanticSummarizer | null = null;

export function __setSemanticToolResultSummarizerForTests(
  summarizer: SemanticSummarizer | null,
): void {
  semanticSummarizerOverride = summarizer;
  storedOutputByDigest.clear();
}

function buildSemanticSummaryInput(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const headChars = Math.max(200, Math.floor(maxChars * 0.65));
  const tailChars = Math.max(120, Math.floor(maxChars * 0.25));
  const omitted = Math.max(0, text.length - headChars - tailChars);
  const head = text.slice(0, headChars).trimEnd();
  const tail = text.slice(-tailChars).trimStart();
  return `${head}\n\n[... omitted ${omitted} chars ...]\n\n${tail}`;
}

function extractResponseText(response: { content?: Array<{ type?: string; text?: string }> } | null | undefined): string {
  if (!response || !Array.isArray(response.content)) return "";
  return response.content
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text as string)
    .join("\n")
    .trim();
}

async function summarizeToolOutputSemantically(
  request: SemanticSummaryRequest,
  extensionContext: RuntimeExtensionContext | undefined,
): Promise<string | null> {
  if (extensionContext?.signal?.aborted) return null;

  if (semanticSummarizerOverride) {
    try {
      return await semanticSummarizerOverride(request, extensionContext);
    } catch (error) {
      if (error instanceof ToolOutputAccessDenied) throw error;
      return null;
    }
  }

  const config = getToolResultSemanticSummaryConfig();
  if (!config.enabled) return null;
  if (!extensionContext?.model) return null;
  const executor = getRuntimeModelExecutor();
  if (!executor) return null;

  try {
    const sampledOutput = buildSemanticSummaryInput(request.fullOutput, config.maxInputChars);
    const promptText = [
      `Tool: ${request.toolName || "unknown"}`,
      `Source: ${request.source}`,
      `Total size: ${request.sizeBytes} bytes`,
      `Total lines: ${request.lineCount}`,
      "",
      "Output sample:",
      sampledOutput,
    ].join("\n");

    const messages: Message[] = [{
      role: "user",
      content: [{ type: "text", text: promptText }],
      timestamp: Date.now(),
    }];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    (timeout as any).unref?.();
    const onAbort = () => controller.abort();
    extensionContext.signal?.addEventListener("abort", onAbort, { once: true });
    if (extensionContext.signal?.aborted) controller.abort();

    try {
      const response = await executor.completeSimple(
        extensionContext.model,
        { systemPrompt: TOOL_RESULT_SEMANTIC_SYSTEM_PROMPT, messages },
        {
          maxTokens: config.maxTokens,
          signal: controller.signal,
        },
      );

      if (response.stopReason === "error") return null;
      const summaryText = extractResponseText(response as any);
      return summaryText.length >= 24 ? summaryText : null;
    } finally {
      clearTimeout(timeout);
      extensionContext.signal?.removeEventListener?.("abort", onAbort);
    }
  } catch (error) {
    if (error instanceof ToolOutputAccessDenied) throw error;
    return null;
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readDetailsStringField(details: unknown, key: string): string | undefined {
  if (!isRecord(details)) return undefined;
  const value = details[key];
  return typeof value === "string" ? value : undefined;
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (!isRecord(item)) return "";
      if (item.type !== "text") return "";
      return typeof item.text === "string" ? item.text : "";
    })
    .join("");
}

function hasImageOrBinaryBlocks(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some((item) => {
    if (!isRecord(item)) return false;
    if (item.type === "image") return true;
    if (item.type !== "text" && typeof item.data === "string" && item.data.length > 0) return true;
    return false;
  });
}

function hasStoredOutputMarker(text: string): boolean {
  if (!text) return false;
  return /tool-output:[A-Za-z0-9_-]+/.test(text)
    || /Use search_tool_output with handle\s+"[A-Za-z0-9_-]+"/.test(text);
}

function hasExistingStoredOutputDetails(details: unknown): boolean {
  if (!details || (typeof details !== "object" && !Array.isArray(details))) return false;

  const stack: unknown[] = [details];
  const seen = new Set<unknown>();
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);

    if (Array.isArray(current)) {
      for (const value of current) {
        if (value && typeof value === "object") stack.push(value);
      }
      continue;
    }

    if (!isRecord(current)) continue;
    for (const [rawKey, value] of Object.entries(current)) {
      const key = rawKey.toLowerCase();
      if (key.includes("storedoutput") || key.includes("stored_output") || key.includes("tool_output")) {
        if (typeof value === "string" && value.trim()) return true;
        if (typeof value === "number" && Number.isFinite(value)) return true;
        if (Array.isArray(value) || isRecord(value)) return true;
      }
      if (value && typeof value === "object") stack.push(value);
    }
  }

  return false;
}

function resolveOutputSourceFromTool(toolName: unknown, command?: unknown): string {
  const normalizedToolName = typeof toolName === "string" && toolName.trim()
    ? toolName.trim()
    : "unknown";
  if (normalizedToolName === "bash") {
    const normalizedCommand = typeof command === "string" ? command : "";
    return `bash:${normalizedCommand}`;
  }
  return `tool:${normalizedToolName}`;
}

function resolveOutputSource(event: unknown): string {
  if (!isRecord(event)) return resolveOutputSourceFromTool("unknown");
  const input = isRecord(event.input) ? event.input : null;
  return resolveOutputSourceFromTool(event.toolName, input?.command);
}

function normalizeToolName(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isToolCompactionEnabledForTool(toolName: unknown): boolean {
  const normalized = normalizeToolName(toolName);
  if (!normalized) return false;
  const configured = getToolResultCompactionTools();
  return configured.some((name) => name === normalized);
}

function resolveStoreThresholds(toolName: unknown): { bytes: number; lines: number } {
  const normalized = normalizeToolName(toolName);
  const overrides = getToolResultCompactionThresholdsByTool();
  const override = normalized ? overrides[normalized] : undefined;
  return {
    bytes: Number.isFinite(Number(override?.bytes)) ? Math.max(1, Math.round(Number(override?.bytes))) : DEFAULT_STORE_THRESHOLD_BYTES,
    lines: Number.isFinite(Number(override?.lines)) ? Math.max(1, Math.round(Number(override?.lines))) : DEFAULT_STORE_THRESHOLD_LINES,
  };
}

function shouldStoreOutput(text: string, lineCount: number, toolName: unknown): boolean {
  if (!isToolCompactionEnabledForTool(toolName)) return false;
  const bytes = Buffer.byteLength(text || "", "utf8");
  const thresholds = resolveStoreThresholds(toolName);
  return bytes > thresholds.bytes || lineCount > thresholds.lines;
}

function buildStoredOutputSummary(
  saved: ReturnType<typeof saveToolOutput>,
  summary: string,
  options: { semantic: boolean },
): string {
  return [
    `Output stored as tool-output:${saved.id} (${saved.lineCount} lines, ${formatBytes(saved.sizeBytes)}).`,
    summary ? `${options.semantic ? "Semantic summary" : "Preview"}:\n${summary}` : null,
    `Use search_tool_output with handle "${saved.id}" and a query to retrieve relevant snippets.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function computeOutputDigest(fullOutput: string, source: string): string {
  const hash = createHash("sha1");
  hash.update(source);
  hash.update("\0");
  hash.update(fullOutput);
  return hash.digest("hex");
}

function rememberStoredOutput(digest: string, entry: StoredOutputCacheEntry): void {
  storedOutputByDigest.set(digest, entry);
  while (storedOutputByDigest.size > STORED_OUTPUT_CACHE_MAX) {
    const firstKey = storedOutputByDigest.keys().next().value;
    if (!firstKey) break;
    storedOutputByDigest.delete(firstKey);
  }
}

function getCachedStoredOutput(digest: string): StoredOutputCacheEntry | null {
  return storedOutputByDigest.get(digest) ?? null;
}

function saveAndRememberStoredOutput(
  digest: string,
  fullOutput: string,
  source: string,
  summary: string,
  semantic: boolean,
): StoredOutputCacheEntry {
  const saved = saveToolOutput(fullOutput, { source, summary });
  const entry: StoredOutputCacheEntry = { saved, summary, semantic };
  rememberStoredOutput(digest, entry);
  return entry;
}

async function compactTextOutput(
  text: string,
  options: {
    fullOutput?: string;
    toolName?: unknown;
    source: string;
    extensionContext?: RuntimeExtensionContext;
    /** Provider-context cleanup must be deterministic and must never invoke a model. */
    allowSemanticSummary?: boolean;
  },
  checkAccess: () => void,
): Promise<{ summaryText: string; saved: ReturnType<typeof saveToolOutput> } | null> {
  const fullOutput = options.fullOutput ?? text;
  if (!fullOutput.trim()) return null;
  if (hasStoredOutputMarker(text) || hasStoredOutputMarker(fullOutput)) return null;

  const lineCount = fullOutput ? fullOutput.replace(/\r\n/g, "\n").split("\n").length : 0;
  if (!shouldStoreOutput(fullOutput, lineCount, options.toolName)) return null;

  const digest = computeOutputDigest(fullOutput, options.source);
  const cachedEntry = getCachedStoredOutput(digest);
  const allowSemanticSummary = options.allowSemanticSummary !== false;
  if (cachedEntry && (cachedEntry.semantic || !allowSemanticSummary)) {
    return {
      summaryText: buildStoredOutputSummary(cachedEntry.saved, cachedEntry.summary, { semantic: cachedEntry.semantic }),
      saved: cachedEntry.saved,
    };
  }

  const preview = buildPreview(fullOutput, PREVIEW_LINES, PREVIEW_LINE_CHARS);
  const semanticSummary = allowSemanticSummary
    ? await summarizeToolOutputSemantically({
      toolName: typeof options.toolName === "string" ? options.toolName : "unknown",
      source: options.source,
      fullOutput,
      lineCount,
      sizeBytes: Buffer.byteLength(fullOutput, "utf8"),
    }, options.extensionContext)
    : null;

  checkAccess();

  const summaryForDisplay = semanticSummary || cachedEntry?.summary || preview;
  const semantic = Boolean(semanticSummary) || Boolean(cachedEntry?.semantic);
  const entry = cachedEntry
    ? { ...cachedEntry, summary: summaryForDisplay, semantic }
    : saveAndRememberStoredOutput(digest, fullOutput, options.source, summaryForDisplay, semantic);
  rememberStoredOutput(digest, entry);

  return {
    summaryText: buildStoredOutputSummary(entry.saved, summaryForDisplay, { semantic }),
    saved: entry.saved,
  };
}

function normalizeToolResultRole(role: unknown): string {
  const normalized = typeof role === "string" ? role.trim().toLowerCase() : "";
  if (normalized === "toolresult") return "tool_result";
  return normalized;
}

function resolveToolNameFromUnknown(record: unknown): string {
  if (!isRecord(record)) return "unknown";
  const candidates = [record.toolName, record.tool_name, record.name];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "unknown";
}

async function compactLegacyToolResultContent(
  content: unknown,
  toolName: unknown,
  _extensionContext?: RuntimeExtensionContext,
): Promise<{
  content: unknown;
  modified: boolean;
}> {
  if (!Array.isArray(content)) return { content, modified: false };
  if (!isToolCompactionEnabledForTool(toolName)) return { content, modified: false };
  if (hasImageOrBinaryBlocks(content)) return { content, modified: false };

  const text = extractText(content);
  if (!text.trim()) return { content, modified: false };
  const lineCount = text.replace(/\r\n/g, "\n").split("\n").length;
  if (!shouldStoreOutput(text, lineCount, toolName)) return { content, modified: false };

  // This hook runs before every provider request. It must be a pure,
  // deterministic projection: model-generated summaries and random stored-output
  // handles rewrite historical function_call_output items and destroy prompt-cache
  // prefix reuse. New tool results are persisted by the tool_result hook instead.
  const preview = buildPreview(text, PREVIEW_LINES, PREVIEW_LINE_CHARS);
  return {
    content: [{
      type: "text",
      text: [
        `Legacy tool output compacted for provider context (${lineCount} lines, ${formatBytes(Buffer.byteLength(text, "utf8"))}).`,
        `Preview:\n${preview}`,
      ].join("\n\n"),
    }],
    modified: true,
  };
}

async function compactNestedToolResultBlocks(
  content: unknown,
  extensionContext: RuntimeExtensionContext | undefined,
  mayContinue: () => boolean,
): Promise<{
  content: unknown;
  modified: boolean;
}> {
  if (!Array.isArray(content)) return { content, modified: false };

  let modified = false;
  const next: unknown[] = [];
  for (const item of content) {
    if (!isRecord(item)) {
      next.push(item);
      continue;
    }

    const type = typeof item.type === "string" ? item.type.trim().toLowerCase() : "";
    if ((type === "tool_result" || type === "toolresult") && Array.isArray(item.content)) {
      const compacted = await compactLegacyToolResultContent(
        item.content,
        resolveToolNameFromUnknown(item),
        extensionContext,
      );
      if (!mayContinue()) return { content, modified: false };
      if (compacted.modified) {
        modified = true;
        next.push({ ...item, content: compacted.content });
        continue;
      }
      next.push(item);
      continue;
    }

    if (Array.isArray(item.content)) {
      const nested = await compactNestedToolResultBlocks(item.content, extensionContext, mayContinue);
      if (!mayContinue()) return { content, modified: false };
      if (nested.modified) {
        modified = true;
        next.push({ ...item, content: nested.content });
        continue;
      }
    }

    next.push(item);
  }

  return { content: next, modified };
}

export default function (pi: any) {
  // Tool-output cleanup is process-scoped and starts from runtime startup.
  // Keep this session extension focused on registering the tools/hooks needed
  // for the active session so cold session creation does not repeat lifecycle work.
  pi.registerTool(createToolOutputSearchTool());
  pi.registerTool(createBatchExecTool(process.cwd()));

  pi.on("tool_result", async (event: any, ctx: RuntimeExtensionContext) => {
    if (!canUseLegacyToolOutput()) return;
    const checkAccess = createToolOutputAccessGuard();
    if (!getToolResultCompactionEnabled()) return;
    if (event?.isError) return;
    if (!isToolCompactionEnabledForTool(event?.toolName)) return;
    if (hasExistingStoredOutputDetails(event?.details)) return;
    if (hasImageOrBinaryBlocks(event?.content)) return;
    const text = extractText(event?.content);
    if (!text.trim()) return;
    if (hasStoredOutputMarker(text)) return;

    const fullOutputPath = readDetailsStringField(event?.details, "fullOutputPath");
    let fullOutput = text;
    if (fullOutputPath) {
      const fileText = readToolOutputFile(fullOutputPath);
      if (fileText !== null) fullOutput = fileText;
    }

    try {
      const compacted = await compactTextOutput(text, {
        fullOutput,
        toolName: event?.toolName,
        source: resolveOutputSource(event),
        extensionContext: ctx,
      }, checkAccess);
      checkAccess();
      if (!compacted) return;

      return {
        content: [{ type: "text", text: compacted.summaryText }],
        details: {
          storedOutputId: compacted.saved.id,
          storedOutputPath: compacted.saved.path,
          storedOutputLines: compacted.saved.lineCount,
          storedOutputBytes: compacted.saved.sizeBytes,
          storedOutputSource: resolveOutputSource(event),
        },
      };
    } catch {
      // Fail open: preserve inline tool result when tool-output persistence fails.
      return;
    }
  });

  // Optional provider-request-time compaction layer:
  // compact legacy oversized inline tool results in outbound context only.
  pi.on("context", async (event: any, ctx: RuntimeExtensionContext) => {
    if (!canUseLegacyToolOutput()) return {};
    let allowed = true;
    const mayContinue = () => allowed && (allowed = canUseLegacyToolOutput());
    if (!getToolResultCompactionEnabled()) return {};
    if (!Array.isArray(event?.messages)) return {};

    let modified = false;
    const messages: any[] = [];
    for (const message of event.messages) {
      if (!isRecord(message)) {
        messages.push(message);
        continue;
      }

      let nextMessage: any = message;

      const role = normalizeToolResultRole(message.role);
      if (role === "tool_result" && Array.isArray(nextMessage.content)) {
        const compacted = await compactLegacyToolResultContent(
          nextMessage.content,
          resolveToolNameFromUnknown(nextMessage),
          ctx,
        );
        if (!mayContinue()) return {};
        if (compacted.modified) {
          modified = true;
          nextMessage = { ...nextMessage, content: compacted.content };
        }
      }

      if (Array.isArray(nextMessage.content)) {
        const nested = await compactNestedToolResultBlocks(nextMessage.content, ctx, mayContinue);
        if (!mayContinue()) return {};
        if (nested.modified) {
          modified = true;
          nextMessage = { ...nextMessage, content: nested.content };
        }
      }

      messages.push(nextMessage);
    }

    if (!modified) return {};
    return { messages };
  });
}
