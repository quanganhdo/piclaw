import { Result, type Result as ResultValue } from "../../contracts/result.js";

import type {
  AgentProjectionSink,
  ProjectionAuthority,
  ProjectionOwner,
  ProjectionSinkError,
  ProjectionSinkErrorTag,
  PublicAgentEvent,
  PublicAgentProjection,
  PublicAgentSnapshot,
  PublicTerminalProjection,
} from "../../contracts/agent-projection-sink.js";
import type { NormalisedEffectTrace } from "../../contracts/common.js";
import { EffectTraceRecorder } from "../trace-recorder.js";

type Cursor = { generation: number; seq: number; closed: boolean };

export class FakeAgentProjectionSink implements AgentProjectionSink {
  readonly trace: EffectTraceRecorder;
  readonly published: PublicAgentProjection[] = [];
  readonly #cursors = new Map<string, Cursor>();
  #failTransport = false;
  #asyncTransport = false;

  constructor(private readonly authority: ProjectionAuthority, traceSnapshot: readonly NormalisedEffectTrace[] = []) { this.trace = EffectTraceRecorder.fromSnapshot(traceSnapshot); }

  rejectTransportOnce(): void { this.#failTransport = true; }
  returnAsyncTransportOnce(): void { this.#asyncTransport = true; }

  publishSnapshot(value: PublicAgentSnapshot): Promise<ResultValue<void, ProjectionSinkError>> { return this.accept("publishSnapshot", value as unknown); }
  publishEvent(value: PublicAgentEvent): Promise<ResultValue<void, ProjectionSinkError>> { return this.accept("publishEvent", value as unknown); }
  publishTerminal(value: PublicTerminalProjection): Promise<ResultValue<void, ProjectionSinkError>> { return this.accept("publishTerminal", value as unknown); }

  private async accept(method: string, candidate: unknown): Promise<ResultValue<void, ProjectionSinkError>> {
    const value = normaliseProjection(candidate);
    if (!value) return this.invalid(method);
    this.trace.recordCall(trace(method, value, null, "call"));
    let authorized: boolean;
    try { authorized = this.authority.isCurrentOwner(value); } catch { return this.reject(method, value, "transport_unavailable", "not_applied", true); }
    if (typeof authorized !== "boolean") return this.reject(method, value, "transport_unavailable", "not_applied", true);
    if (!authorized) return this.reject(method, value, "owner_conflict");
    if (value.type === "agent_terminal") {
      let committed: boolean;
      try { committed = this.authority.isCommittedTerminalRef(value, value.terminalCommitRef); } catch { return this.reject(method, value, "transport_unavailable", "not_applied", true); }
      if (typeof committed !== "boolean") return this.reject(method, value, "transport_unavailable", "not_applied", true);
      if (!committed) return this.reject(method, value, "terminal_not_committed");
    }
    const key = ownerKey(value);
    const cursor = this.#cursors.get(key);
    if (!cursor) {
      if (value.type !== "agent_snapshot") return this.reject(method, value, "stale_generation");
    } else if (value.watchGeneration < cursor.generation || (value.watchGeneration > cursor.generation && value.type !== "agent_snapshot")) {
      return this.reject(method, value, "stale_generation");
    } else if (value.watchGeneration === cursor.generation) {
      if (cursor.closed) return this.reject(method, value, "generation_closed");
      if (value.type === "agent_snapshot") return this.reject(method, value, "stale_generation");
      if (value.receiptSeq <= cursor.seq) return this.reject(method, value, "stale_sequence");
    }
    if (this.#asyncTransport) {
      this.#asyncTransport = false;
      this.trace.recordResult(trace(method, value, "unknown", "transport_unavailable"));
      return Result.err(Object.freeze({ _tag: "transport_unavailable", certainty: "unknown", retryable: true }));
    }
    if (this.#failTransport) {
      this.#failTransport = false;
      this.trace.recordResult(trace(method, value, "unknown", "transport_unavailable"));
      return Result.err(Object.freeze({ _tag: "transport_unavailable", certainty: "unknown", retryable: true }));
    }
    this.#cursors.set(key, { generation: value.watchGeneration, seq: value.receiptSeq, closed: value.type === "agent_terminal" });
    this.published.push(value);
    this.trace.recordResult(trace(method, value, "applied", "published"));
    return Result.ok(undefined);
  }

  private invalid(method: string): ResultValue<never, ProjectionSinkError> {
    this.trace.recordResult({ contract: "EF-S08", method, effectId: "invalid-projection", certainty: "not_applied", resultTag: "protected_payload" });
    return Result.err(Object.freeze({ _tag: "protected_payload", certainty: "not_applied", retryable: false }));
  }

  private reject(method: string, value: PublicAgentProjection, tag: ProjectionSinkErrorTag, certainty: ProjectionSinkError["certainty"] = "not_applied", retryable = false): ResultValue<never, ProjectionSinkError> {
    this.trace.recordResult(trace(method, value, certainty, tag));
    return Result.err(Object.freeze({ _tag: tag, certainty, retryable }));
  }
}

function ownerKey(owner: ProjectionOwner): string { return JSON.stringify([owner.chatJid, owner.operationId, owner.harnessOperationId]); }
function trace(method: string, value: PublicAgentProjection, certainty: ProjectionSinkError["certainty"] | null, resultTag: string) {
  return { contract: "EF-S08", method, effectId: `${ownerKey(value)}:${value.watchGeneration}:${value.receiptSeq}`, operationId: value.operationId, sourceSeq: value.receiptSeq, version: value.watchGeneration, certainty, resultTag };
}
const BASE = ["type", "chatJid", "operationId", "harnessOperationId", "watchGeneration", "receiptSeq"];
const KEYS: Record<PublicAgentProjection["type"], Set<string>> = {
  agent_snapshot: new Set([...BASE, "phase", "modelLabel", "activeToolNames", "cancellationRequested"]),
  phase_changed: new Set([...BASE, "phase"]), assistant_delta: new Set([...BASE, "textDelta"]),
  tool_started: new Set([...BASE, "toolCallId", "toolName"]), tool_updated: new Set([...BASE, "toolCallId", "publicSummary"]),
  tool_finished: new Set([...BASE, "toolCallId", "outcome"]), usage_updated: new Set([...BASE, "inputTokens", "outputTokens"]),
  agent_terminal: new Set([...BASE, "terminalCommitRef", "disposition", "messageRowId", "errorCode"]),
};
function normaliseProjection(value: unknown): PublicAgentProjection | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const candidate = value as Record<string, unknown>; const type = candidate.type;
    if (typeof type !== "string") return null; const allowed = KEYS[type as PublicAgentProjection["type"]];
    if (!allowed || !Object.keys(candidate).every((key) => allowed.has(key))) return null;
    const chatJid = candidate.chatJid; const operationId = candidate.operationId; const harnessOperationId = candidate.harnessOperationId; const watchGeneration = candidate.watchGeneration; const receiptSeq = candidate.receiptSeq;
    if (!["type", "chatJid", "operationId", "harnessOperationId", "watchGeneration", "receiptSeq"].every((key) => stable(candidate, key, ({ type, chatJid, operationId, harnessOperationId, watchGeneration, receiptSeq } as Record<string, unknown>)[key])) || !nonEmpty(chatJid) || !nonEmpty(operationId) || (harnessOperationId !== null && !nonEmpty(harnessOperationId)) || !safe(watchGeneration) || !safe(receiptSeq)) return null;
    const base = { type, chatJid, operationId, harnessOperationId, watchGeneration, receiptSeq };
    if (type === "agent_snapshot") { const phase = candidate.phase; const modelLabel = candidate.modelLabel; const tools = candidate.activeToolNames; const cancellationRequested = candidate.cancellationRequested; const activeToolNames = stableArray(candidate, "activeToolNames", tools); return stable(candidate, "phase", phase) && stable(candidate, "modelLabel", modelLabel) && stable(candidate, "cancellationRequested", cancellationRequested) && PHASES.has(phase as string) && (modelLabel === null || typeof modelLabel === "string") && activeToolNames && typeof cancellationRequested === "boolean" ? Object.freeze({ ...base, type, phase, modelLabel, activeToolNames, cancellationRequested } as PublicAgentProjection) : null; }
    if (type === "phase_changed") { const phase = candidate.phase; return stable(candidate, "phase", phase) && PHASES.has(phase as string) ? Object.freeze({ ...base, type, phase } as PublicAgentProjection) : null; }
    if (type === "assistant_delta") { const textDelta = candidate.textDelta; return stable(candidate, "textDelta", textDelta) && typeof textDelta === "string" ? Object.freeze({ ...base, type, textDelta } as PublicAgentProjection) : null; }
    if (type === "tool_started") { const toolCallId = candidate.toolCallId; const toolName = candidate.toolName; return stable(candidate, "toolCallId", toolCallId) && stable(candidate, "toolName", toolName) && nonEmpty(toolCallId) && nonEmpty(toolName) ? Object.freeze({ ...base, type, toolCallId, toolName } as PublicAgentProjection) : null; }
    if (type === "tool_updated") { const toolCallId = candidate.toolCallId; const publicSummary = candidate.publicSummary; return stable(candidate, "toolCallId", toolCallId) && stable(candidate, "publicSummary", publicSummary) && nonEmpty(toolCallId) && (publicSummary === null || typeof publicSummary === "string") ? Object.freeze({ ...base, type, toolCallId, publicSummary } as PublicAgentProjection) : null; }
    if (type === "tool_finished") { const toolCallId = candidate.toolCallId; const outcome = candidate.outcome; return stable(candidate, "toolCallId", toolCallId) && stable(candidate, "outcome", outcome) && nonEmpty(toolCallId) && OUTCOMES.has(outcome as string) ? Object.freeze({ ...base, type, toolCallId, outcome } as PublicAgentProjection) : null; }
    if (type === "usage_updated") { const inputTokens = candidate.inputTokens; const outputTokens = candidate.outputTokens; return stable(candidate, "inputTokens", inputTokens) && stable(candidate, "outputTokens", outputTokens) && safe(inputTokens) && safe(outputTokens) ? Object.freeze({ ...base, type, inputTokens, outputTokens } as PublicAgentProjection) : null; }
    if (type === "agent_terminal") { const terminalCommitRef = candidate.terminalCommitRef; const disposition = candidate.disposition; const messageRowId = candidate.messageRowId; const errorCode = candidate.errorCode; return stable(candidate, "terminalCommitRef", terminalCommitRef) && stable(candidate, "disposition", disposition) && stable(candidate, "messageRowId", messageRowId) && stable(candidate, "errorCode", errorCode) && nonEmpty(terminalCommitRef) && DISPOSITIONS.has(disposition as string) && (messageRowId === null || (Number.isSafeInteger(messageRowId) && (messageRowId as number) > 0)) && (errorCode === null || typeof errorCode === "string") ? Object.freeze({ ...base, type, terminalCommitRef, disposition, messageRowId, errorCode } as PublicAgentProjection) : null; }
    return null;
  } catch { return null; }
}
function stable(candidate: Record<string, unknown>, key: string, value: unknown): boolean { return Object.is(candidate[key], value); }
function stableArray(candidate: Record<string, unknown>, key: string, value: unknown): readonly string[] | null { if (!Array.isArray(value) || !stable(candidate, key, value)) return null; const first = Array.from(value as unknown[]); const second = Array.from(value as unknown[]); return first.length === second.length && first.every((entry, index) => nonEmpty(entry) && Object.is(entry, second[index])) ? Object.freeze(first as string[]) : null; }
const PHASES = new Set(["idle", "accepted", "running", "waiting", "suspended", "cancelling"]);
const OUTCOMES = new Set(["completed", "failed", "cancelled"]);
const DISPOSITIONS = new Set(["completed", "cancelled", "failed", "skipped", "superseded"]);
function nonEmpty(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function safe(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
