/** Provider-native remote compaction with opaque, persisted canonical-context replay. */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { convertResponsesMessages, convertResponsesTools } from "@earendil-works/pi-ai/api/openai-responses-shared";
import type { Api, Model, ProviderHeaders, Tool } from "@earendil-works/pi-ai";
import { currentContextTools, providerTranscriptContext } from "../transcript-context-compat.js";
import { convertToLlm, type FileOperations, type SessionEntry } from "@earendil-works/pi-coding-agent";
import type { ModelRequestAuth } from "../../utils/model-auth.js";
import { createLogger } from "../../utils/logger.js";
import { sanitizeProviderPayloadItemIds } from "../provider-request-sanitizer.js";

const log = createLogger("ext.smart-compaction.remote");

export const REMOTE_COMPACTION_SUMMARY_SENTINEL =
  "[Piclaw provider-native compaction state. The opaque canonical context is injected at request time.]";

const LOCAL_CONTINUITY_CHECKPOINT_PREFIX =
  "Earlier context was compacted locally. Preserve this continuity state together with the following events:\n\n";

export const REMOTE_COMPACTION_DETAILS_KIND = "piclaw.remote_compaction";
export const REMOTE_COMPACTION_DETAILS_VERSION = 1;
const REMOTE_COMPACTION_ADAPTER = "openai-responses-compact";
const MAX_REMOTE_COMPACTION_RESPONSE_CHARS = 16 * 1024 * 1024;
const OPENAI_TOOL_CALL_PROVIDERS = new Set(["openai", "openai-codex"]);

export interface RemoteCompactionCapability {
  supportsRemoteCompaction: true;
  provider: "openai" | "openai-codex";
  api: "openai-responses" | "openai-codex-responses";
  adapter: typeof REMOTE_COMPACTION_ADAPTER;
  baseUrl: "https://api.openai.com/v1" | "https://chatgpt.com/backend-api";
  endpointPath: "responses/compact" | "codex/responses/compact";
  auth: "bearer" | "codex-oauth";
}

/**
 * Explicit capability registry. Support is never inferred from a model name or
 * from the generic OpenAI-compatible API selector. Proxies and Copilot remain
 * unsupported until they receive their own verified capability entry.
 */
export const REMOTE_COMPACTION_CAPABILITIES: Readonly<Record<string, RemoteCompactionCapability>> = Object.freeze({
  openai: Object.freeze({
    supportsRemoteCompaction: true,
    provider: "openai",
    api: "openai-responses",
    adapter: REMOTE_COMPACTION_ADAPTER,
    baseUrl: "https://api.openai.com/v1",
    endpointPath: "responses/compact",
    auth: "bearer",
  }),
  "openai-codex": Object.freeze({
    supportsRemoteCompaction: true,
    provider: "openai-codex",
    api: "openai-codex-responses",
    adapter: REMOTE_COMPACTION_ADAPTER,
    baseUrl: "https://chatgpt.com/backend-api",
    endpointPath: "codex/responses/compact",
    auth: "codex-oauth",
  }),
});

export interface RemoteCompactionUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface RemoteCompactionFileOperations {
  read: string[];
  written: string[];
  edited: string[];
}

export interface RemoteCompactionDetails {
  kind: typeof REMOTE_COMPACTION_DETAILS_KIND;
  version: typeof REMOTE_COMPACTION_DETAILS_VERSION;
  adapter: typeof REMOTE_COMPACTION_ADAPTER;
  provider: string;
  modelId: string;
  api: string;
  baseUrl: string;
  /** Canonical provider output. It must be replayed as-is, never summarized or pruned. */
  output: Array<Record<string, unknown>>;
  /** Deterministic file facts that must survive when opaque state later falls back locally. */
  fileOperations: RemoteCompactionFileOperations;
  usage?: RemoteCompactionUsage;
  createdAt: string;
}

export type RemoteCompactionFailureCode =
  | "disabled"
  | "unsupported"
  | "unavailable"
  | "auth"
  | "timeout"
  | "cancelled"
  | "malformed"
  | "provider_failure"
  | "incompatible"
  | "backoff";

export type RemoteCompactionAttempt =
  | { ok: true; details: RemoteCompactionDetails }
  | { ok: false; code: RemoteCompactionFailureCode; message: string; status?: number; retryAfterMs?: number };

interface RemoteCompactionBackoffState {
  failures: number;
  nextRetryAt: number;
}

const remoteCompactionBackoffs = new Map<string, RemoteCompactionBackoffState>();

function backoffKey(model: Model<Api>): string {
  return `${model.provider}\u0000${model.id}\u0000${model.api}\u0000${normalizedBaseUrl(model.baseUrl)}`;
}

export function clearRemoteCompactionBackoffForTests(): void {
  remoteCompactionBackoffs.clear();
}

export interface RemoteCompactionToolInfo {
  name: string;
  description: string;
  parameters: unknown;
}

function normalizedBaseUrl(value: unknown): string {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

export function resolveRemoteCompactionCapability(model: Model<Api> | undefined):
  | { ok: true; capability: RemoteCompactionCapability }
  | { ok: false; reason: string } {
  if (!model) return { ok: false, reason: "no active model" };
  const capability = REMOTE_COMPACTION_CAPABILITIES[model.provider];
  if (!capability?.supportsRemoteCompaction) {
    return { ok: false, reason: `provider ${model.provider} has no remote-compaction capability` };
  }
  if (model.api !== capability.api) {
    return { ok: false, reason: `provider ${model.provider} model uses unsupported API ${model.api}` };
  }
  if (normalizedBaseUrl(model.baseUrl) !== capability.baseUrl) {
    return { ok: false, reason: `provider ${model.provider} uses an unverified endpoint` };
  }
  return { ok: true, capability };
}

function authorizationBearerToken(headers: ProviderHeaders | undefined): string | null {
  const authorization = Object.entries(headers ?? {}).find(([name]) => name.toLowerCase() === "authorization")?.[1];
  if (typeof authorization !== "string") return null;
  const match = authorization.trim().match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function hasAuthorizationHeader(headers: ProviderHeaders | undefined): boolean {
  return authorizationBearerToken(headers) !== null;
}

function buildEndpoint(baseUrl: string, capability: RemoteCompactionCapability): string {
  return `${normalizedBaseUrl(baseUrl)}/${capability.endpointPath}`;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    return decoded && typeof decoded === "object" && !Array.isArray(decoded)
      ? decoded as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function extractCodexAccountId(token: string): string | null {
  const payload = decodeJwtPayload(token);
  const auth = payload?.["https://api.openai.com/auth"];
  if (!auth || typeof auth !== "object" || Array.isArray(auth)) return null;
  const accountId = (auth as Record<string, unknown>).chatgpt_account_id;
  return typeof accountId === "string" && accountId.trim() ? accountId.trim() : null;
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function parseUsage(value: unknown): RemoteCompactionUsage | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const usage: RemoteCompactionUsage = {
    inputTokens: finiteNonNegative(raw.input_tokens),
    outputTokens: finiteNonNegative(raw.output_tokens),
    totalTokens: finiteNonNegative(raw.total_tokens),
  };
  return Object.values(usage).some((entry) => entry !== undefined) ? usage : undefined;
}

function serializeFileOperations(fileOps: FileOperations): RemoteCompactionFileOperations {
  return {
    read: [...new Set(fileOps.read)],
    written: [...new Set(fileOps.written)],
    edited: [...new Set(fileOps.edited)],
  };
}

function parseFileOperationPaths(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 100_000) return null;
  const result: string[] = [];
  for (const path of value) {
    if (typeof path !== "string" || path.length === 0 || path.length > 16_384) return null;
    result.push(path);
  }
  return [...new Set(result)];
}

function parseFileOperations(value: unknown): RemoteCompactionFileOperations | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const read = parseFileOperationPaths(raw.read);
  const written = parseFileOperationPaths(raw.written);
  const edited = parseFileOperationPaths(raw.edited);
  return read && written && edited ? { read, written, edited } : null;
}

export function mergeRemoteCompactionFileOperations(
  current: FileOperations,
  details: RemoteCompactionDetails,
): FileOperations {
  return {
    read: new Set([...details.fileOperations.read, ...current.read]),
    written: new Set([...details.fileOperations.written, ...current.written]),
    edited: new Set([...details.fileOperations.edited, ...current.edited]),
  };
}

function validateCanonicalOutput(value: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const output: Array<Record<string, unknown>> = [];
  let hasCompactionItem = false;
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    if (record.type === "compaction" || record.type === "compaction_summary" || record.type === "context_compaction") {
      if (typeof record.encrypted_content !== "string" || record.encrypted_content.length === 0) return null;
      hasCompactionItem = true;
    }
    output.push(record);
  }
  if (!hasCompactionItem) return null;
  try {
    if (JSON.stringify(output).length > MAX_REMOTE_COMPACTION_RESPONSE_CHARS) return null;
  } catch {
    return null;
  }
  return output;
}

export function parseRemoteCompactionDetails(value: unknown): RemoteCompactionDetails | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (
    raw.kind !== REMOTE_COMPACTION_DETAILS_KIND
    || raw.version !== REMOTE_COMPACTION_DETAILS_VERSION
    || raw.adapter !== REMOTE_COMPACTION_ADAPTER
    || typeof raw.provider !== "string"
    || typeof raw.modelId !== "string"
    || typeof raw.api !== "string"
    || typeof raw.baseUrl !== "string"
    || typeof raw.createdAt !== "string"
  ) return null;
  const output = validateCanonicalOutput(raw.output);
  const fileOperations = parseFileOperations(raw.fileOperations);
  if (!output || !fileOperations) return null;
  return {
    kind: REMOTE_COMPACTION_DETAILS_KIND,
    version: REMOTE_COMPACTION_DETAILS_VERSION,
    adapter: REMOTE_COMPACTION_ADAPTER,
    provider: raw.provider,
    modelId: raw.modelId,
    api: raw.api,
    baseUrl: normalizedBaseUrl(raw.baseUrl),
    output,
    fileOperations,
    usage: parseUsage(raw.usage),
    createdAt: raw.createdAt,
  };
}

export type LatestRemoteCompactionState =
  | { kind: "valid"; details: RemoteCompactionDetails }
  | { kind: "invalid"; message: string }
  | null;

export function getLatestRemoteCompactionState(entries: readonly SessionEntry[]): LatestRemoteCompactionState {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry?.type !== "compaction") continue;
    if (entry.summary !== REMOTE_COMPACTION_SUMMARY_SENTINEL) return null;
    const details = parseRemoteCompactionDetails(entry.details);
    return details
      ? { kind: "valid", details }
      : { kind: "invalid", message: "Persisted provider-native compaction details were malformed or unsupported" };
  }
  return null;
}

export function getLatestRemoteCompactionDetails(entries: readonly SessionEntry[]): RemoteCompactionDetails | null {
  const state = getLatestRemoteCompactionState(entries);
  return state?.kind === "valid" ? state.details : null;
}

export function isRemoteCompactionCompatible(model: Model<Api> | undefined, details: RemoteCompactionDetails): boolean {
  if (!model) return false;
  const resolved = resolveRemoteCompactionCapability(model);
  return resolved.ok
    && model.provider === details.provider
    && model.id === details.modelId
    && model.api === details.api
    && normalizedBaseUrl(model.baseUrl) === details.baseUrl;
}

/**
 * Return only Piclaw's explicitly marked, human-readable continuity checkpoint.
 * Arbitrary provider output is not safe to present as a summary, and encrypted
 * canonical state must never be surfaced.
 */
export function extractRemoteCompactionReadableCheckpoint(details: RemoteCompactionDetails): string | null {
  for (const item of details.output) {
    if (item.type !== "message" || item.role !== "user" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (!part || typeof part !== "object" || Array.isArray(part)) continue;
      const content = part as Record<string, unknown>;
      if (content.type !== "input_text" || typeof content.text !== "string") continue;
      if (!content.text.startsWith(LOCAL_CONTINUITY_CHECKPOINT_PREFIX)) continue;
      const checkpoint = content.text.slice(LOCAL_CONTINUITY_CHECKPOINT_PREFIX.length).trim();
      if (checkpoint) return checkpoint;
    }
  }
  return null;
}

function withoutRemoteSummaryMarker(messages: readonly AgentMessage[]): AgentMessage[] {
  return messages.filter((message) => {
    const candidate = message as AgentMessage & { role?: string; summary?: string };
    return !(candidate.role === "compactionSummary" && candidate.summary === REMOTE_COMPACTION_SUMMARY_SENTINEL);
  });
}

function createCombinedAbortSignal(parent: AbortSignal, timeoutMs: number): {
  signal: AbortSignal;
  timedOut: () => boolean;
  cleanup: () => void;
} {
  const controller = new AbortController();
  let timeoutElapsed = false;
  const onParentAbort = () => controller.abort(parent.reason);
  parent.addEventListener("abort", onParentAbort, { once: true });
  const timeout = setTimeout(() => {
    timeoutElapsed = true;
    controller.abort(new Error("Remote compaction timed out"));
  }, Math.max(1, timeoutMs));
  return {
    signal: controller.signal,
    timedOut: () => timeoutElapsed,
    cleanup: () => {
      clearTimeout(timeout);
      parent.removeEventListener("abort", onParentAbort);
    },
  };
}

export async function attemptRemoteCompaction(options: {
  model: Model<Api>;
  auth: Extract<ModelRequestAuth, { ok: true }>;
  messages: readonly AgentMessage[];
  previousDetails?: RemoteCompactionDetails | null;
  /** Existing local summary to preserve during the first local-to-native transition. */
  previousSummary?: string | null;
  fileOps: FileOperations;
  systemPrompt?: string;
  tools?: readonly RemoteCompactionToolInfo[];
  signal: AbortSignal;
  timeoutMs: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  now?: () => number;
  fetchFn?: typeof fetch;
}): Promise<RemoteCompactionAttempt> {
  const capability = resolveRemoteCompactionCapability(options.model);
  if (!capability.ok) return { ok: false, code: "unsupported", message: capability.reason };
  const now = options.now ?? Date.now;
  const key = backoffKey(options.model);
  const activeBackoff = remoteCompactionBackoffs.get(key);
  if (activeBackoff && activeBackoff.nextRetryAt > now()) {
    return {
      ok: false,
      code: "backoff",
      message: "Provider-native compaction is temporarily suppressed after an earlier failure",
      retryAfterMs: activeBackoff.nextRetryAt - now(),
    };
  }
  const recordFailure = (failure: Extract<RemoteCompactionAttempt, { ok: false }>): RemoteCompactionAttempt => {
    const baseMs = Math.max(0, Math.round(options.backoffBaseMs ?? 0));
    const maxMs = Math.max(baseMs, Math.round(options.backoffMaxMs ?? baseMs));
    if (baseMs > 0 && !["disabled", "unsupported", "cancelled", "incompatible", "backoff"].includes(failure.code)) {
      const failures = (remoteCompactionBackoffs.get(key)?.failures ?? 0) + 1;
      const delayMs = Math.min(maxMs, baseMs * (2 ** Math.max(0, failures - 1)));
      remoteCompactionBackoffs.set(key, { failures, nextRetryAt: now() + delayMs });
    }
    return failure;
  };
  if (options.previousDetails && !isRemoteCompactionCompatible(options.model, options.previousDetails)) {
    return { ok: false, code: "incompatible", message: "Persisted remote compaction state belongs to another provider or model" };
  }
  if (!options.auth.apiKey && !hasAuthorizationHeader(options.auth.headers)) {
    return recordFailure({ ok: false, code: "auth", message: "No request credentials are available for remote compaction" });
  }
  if (options.signal.aborted) return { ok: false, code: "cancelled", message: "Remote compaction cancelled" };

  let input: unknown[];
  let requestTools = options.tools as Tool[] | undefined;
  try {
    const llmMessages = convertToLlm(withoutRemoteSummaryMarker(options.messages));
    const transcript = providerTranscriptContext({ messages: llmMessages, tools: requestTools });
    requestTools = currentContextTools(transcript);
    const convertedInput = convertResponsesMessages(options.model, transcript, OPENAI_TOOL_CALL_PROVIDERS, { includeSystemPrompt: false });
    const previousSummary = options.previousDetails ? "" : options.previousSummary?.trim();
    input = [
      ...(options.previousDetails?.output ?? []),
      ...(previousSummary
        ? [{
            type: "message",
            role: "user",
            content: [{
              type: "input_text",
              text: `${LOCAL_CONTINUITY_CHECKPOINT_PREFIX}${previousSummary}`,
            }],
          }]
        : []),
      ...convertedInput,
    ];
  } catch {
    return recordFailure({ ok: false, code: "provider_failure", message: "Remote compaction input conversion failed" });
  }
  if (input.length === 0) return recordFailure({ ok: false, code: "malformed", message: "Remote compaction input is empty" });

  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...Object.fromEntries(
      Object.entries(options.auth.headers ?? {}).filter((entry): entry is [string, string] => entry[1] !== null),
    ),
  };
  if (!hasAuthorizationHeader(headers) && options.auth.apiKey) headers.authorization = `Bearer ${options.auth.apiKey}`;
  if (capability.capability.auth === "codex-oauth") {
    const oauthToken = authorizationBearerToken(headers);
    if (!oauthToken) {
      return recordFailure({ ok: false, code: "auth", message: "OpenAI Codex OAuth token is unavailable for remote compaction" });
    }
    const accountId = extractCodexAccountId(oauthToken);
    if (!accountId) {
      return recordFailure({ ok: false, code: "auth", message: "OpenAI Codex OAuth token did not contain a ChatGPT account ID" });
    }
    headers["chatgpt-account-id"] = accountId;
    headers.originator = "pi";
    headers["OpenAI-Beta"] = "responses=experimental";
  }
  // The direct compact endpoint bypasses the normal provider-request hook.
  // Apply the same duplicate provider-ID sanitizer before sending a combined
  // persisted + fresh Responses window.
  const body = sanitizeProviderPayloadItemIds({
    model: options.model.id,
    input,
    ...(options.systemPrompt?.trim() ? { instructions: options.systemPrompt } : {}),
    ...(requestTools?.length ? { tools: convertResponsesTools(requestTools, { strict: null }) } : {}),
    parallel_tool_calls: true,
  }, {
    onOrphanFunctionCallOutputs: (diagnostic) => {
      log.warn("Removed orphan OpenAI Responses function-call outputs before remote compaction", {
        operation: "remote_compaction.orphan_function_call_outputs",
        removedCount: diagnostic.removedCount,
        callIds: diagnostic.callIds,
        provider: options.model.provider,
        modelId: options.model.id,
        api: options.model.api,
      });
    },
  });
  const combined = createCombinedAbortSignal(options.signal, options.timeoutMs);
  try {
    const response = await (options.fetchFn ?? fetch)(buildEndpoint(options.model.baseUrl, capability.capability), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: combined.signal,
    });
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_REMOTE_COMPACTION_RESPONSE_CHARS) {
      return recordFailure({ ok: false, code: "malformed", message: "Remote compaction response exceeded the safety limit" });
    }
    const text = await response.text();
    if (text.length > MAX_REMOTE_COMPACTION_RESPONSE_CHARS) {
      return recordFailure({ ok: false, code: "malformed", message: "Remote compaction response exceeded the safety limit" });
    }
    if (!response.ok) {
      const code: RemoteCompactionFailureCode = response.status === 401 || response.status === 403
        ? "auth"
        : "provider_failure";
      const errorDetail = (() => {
        try {
          const parsed = JSON.parse(text) as Record<string, unknown>;
          const error = parsed.error;
          if (typeof error === "string") return error;
          if (error && typeof error === "object" && !Array.isArray(error)) {
            const message = (error as Record<string, unknown>).message;
            if (typeof message === "string") return message;
          }
          if (typeof parsed.detail === "string") return parsed.detail;
        } catch {
          return "";
        }
        return "";
      })().replace(/\s+/g, " ").trim().slice(0, 500);
      return recordFailure({
        ok: false,
        code,
        status: response.status,
        message: `Remote compaction endpoint returned HTTP ${response.status}${errorDetail ? `: ${errorDetail}` : ""}`,
      });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return recordFailure({ ok: false, code: "malformed", message: "Remote compaction response was not valid JSON" });
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return recordFailure({ ok: false, code: "malformed", message: "Remote compaction response was not an object" });
    }
    const responseObject = parsed as Record<string, unknown>;
    const output = validateCanonicalOutput(responseObject.output);
    if (!output) {
      return recordFailure({ ok: false, code: "malformed", message: "Remote compaction response did not contain a canonical compaction window" });
    }
    remoteCompactionBackoffs.delete(key);
    return {
      ok: true,
      details: {
        kind: REMOTE_COMPACTION_DETAILS_KIND,
        version: REMOTE_COMPACTION_DETAILS_VERSION,
        adapter: REMOTE_COMPACTION_ADAPTER,
        provider: options.model.provider,
        modelId: options.model.id,
        api: options.model.api,
        baseUrl: normalizedBaseUrl(options.model.baseUrl),
        output,
        fileOperations: serializeFileOperations(options.fileOps),
        usage: parseUsage(responseObject.usage),
        createdAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    if (options.signal.aborted) return { ok: false, code: "cancelled", message: "Remote compaction cancelled" };
    if (combined.timedOut()) return recordFailure({ ok: false, code: "timeout", message: "Remote compaction timed out" });
    return recordFailure({
      ok: false,
      code: "provider_failure",
      message: error instanceof Error ? error.message : "Remote compaction request failed",
    });
  } finally {
    combined.cleanup();
  }
}

// Derive the SDK's synthetic summary wrapper from its public converter. A user
// quoting the sentinel inside a real prompt must never be mistaken for this item.
const remoteSummaryMessage = convertToLlm([{
  role: "compactionSummary", summary: REMOTE_COMPACTION_SUMMARY_SENTINEL, tokensBefore: 0, timestamp: 0,
}]);
const remoteSummaryContent = remoteSummaryMessage[0]?.role === "user" ? remoteSummaryMessage[0].content : null;
const REMOTE_COMPACTION_MARKER_TEXT = Array.isArray(remoteSummaryContent)
  ? remoteSummaryContent.find((part) => part.type === "text")?.text
  : remoteSummaryContent;

function isMarkerText(value: unknown): boolean {
  return typeof value === "string" && value === REMOTE_COMPACTION_MARKER_TEXT;
}

function inputItemContainsSentinel(item: unknown): boolean {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  const record = item as Record<string, unknown>;
  if (record.role !== undefined && record.role !== "user") return false;
  if (typeof record.content === "string") return isMarkerText(record.content);
  if (!Array.isArray(record.content) || record.content.length !== 1) return false;
  const part = record.content[0];
  if (!part || typeof part !== "object" || Array.isArray(part)) return false;
  return (part.type === "input_text" || part.type === "text") && isMarkerText(part.text);
}

/**
 * Prompt-bearing payload fields across provider APIs. Responses uses `input`,
 * Anthropic Messages uses `messages`, Gemini uses `contents`.
 */
const PROMPT_ARRAY_FIELDS = ["input", "messages", "contents"] as const;

/**
 * Drop the replay marker when the persisted native window cannot be replayed.
 *
 * The marker is a placeholder standing in for a provider-native compacted
 * window. If that window cannot be rehydrated (incompatible provider/model, or
 * unreadable state) the marker must not reach the provider, but the turn itself
 * must still proceed: the alternative is a session that fails every request for
 * as long as the incompatible state remains persisted.
 */
export function stripRemoteCompactionMarker(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const record = payload as Record<string, unknown>;
  let changed = false;
  const next: Record<string, unknown> = { ...record };
  for (const field of PROMPT_ARRAY_FIELDS) {
    const value = record[field];
    if (!Array.isArray(value)) continue;
    const filtered = value.filter((item) => !inputItemContainsSentinel(item));
    if (filtered.length === value.length) continue;
    next[field] = filtered;
    changed = true;
  }
  return changed ? next : payload;
}

export type RemoteCompactionReplayResult =
  | { ok: true; payload: unknown; injectedItems: number }
  | { ok: false; code: "incompatible" | "malformed"; message: string; fallbackPayload: unknown };

/** Prepend canonical native state to a direct local-fallback model request. */
export function prependRemoteCompactionPayload(payload: unknown, details: RemoteCompactionDetails): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return stripRemoteCompactionMarker(payload);
  }
  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.input)) return stripRemoteCompactionMarker(payload);
  const markerIndex = record.input.findIndex(inputItemContainsSentinel);
  const suffix = markerIndex < 0
    ? record.input
    : [...record.input.slice(0, markerIndex), ...record.input.slice(markerIndex + 1)];
  return { ...record, input: [...structuredClone(details.output), ...suffix] };
}

export function injectRemoteCompactionPayload(
  payload: unknown,
  model: Model<Api> | undefined,
  details: RemoteCompactionDetails,
): RemoteCompactionReplayResult {
  if (!isRemoteCompactionCompatible(model, details)) {
    return {
      ok: false,
      code: "incompatible",
      message: "Persisted remote compaction state is incompatible with the active provider or model",
      fallbackPayload: stripRemoteCompactionMarker(payload),
    };
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, code: "malformed", message: "Provider payload was not an object", fallbackPayload: stripRemoteCompactionMarker(payload) };
  }
  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.input)) {
    return { ok: false, code: "malformed", message: "Provider payload had no input array", fallbackPayload: stripRemoteCompactionMarker(payload) };
  }
  const markerIndex = record.input.findIndex(inputItemContainsSentinel);
  if (markerIndex < 0) {
    return { ok: false, code: "malformed", message: "Remote compaction replay marker was missing", fallbackPayload: stripRemoteCompactionMarker(payload) };
  }
  const output = structuredClone(details.output);
  return {
    ok: true,
    payload: {
      ...record,
      input: [
        ...record.input.slice(0, markerIndex),
        ...output,
        ...record.input.slice(markerIndex + 1),
      ],
    },
    injectedItems: output.length,
  };
}
