import { Result, type Result as ResultValue } from "../contracts/result.js";

import type {
  AgentProjectionSink,
  ProjectionAuthority,
  ProjectionOwner,
  ProjectionSinkError,
  ProjectionSinkErrorTag,
  ProjectionTransport,
  PublicAgentEvent,
  PublicAgentProjection,
  PublicAgentSnapshot,
  PublicTerminalProjection,
} from "../contracts/agent-projection-sink.js";
import type { CurrentPiclawAdapterRuntime } from "./adapter-runtime.js";

type ProjectionCursor = {
  generation: number;
  receiptSeq: number;
  closed: boolean;
};

export class CurrentPiclawAgentProjectionSink implements AgentProjectionSink {
  private readonly cursors = new Map<string, ProjectionCursor>();

  constructor(
    private readonly authority: ProjectionAuthority,
    private readonly transport: ProjectionTransport,
    private readonly runtime: CurrentPiclawAdapterRuntime,
  ) {}

  publishSnapshot(snapshot: PublicAgentSnapshot): Promise<ResultValue<void, ProjectionSinkError>> {
    return this.publish("publishSnapshot", snapshot as unknown);
  }

  publishEvent(event: PublicAgentEvent): Promise<ResultValue<void, ProjectionSinkError>> {
    return this.publish("publishEvent", event as unknown);
  }

  publishTerminal(terminal: PublicTerminalProjection): Promise<ResultValue<void, ProjectionSinkError>> {
    return this.publish("publishTerminal", terminal as unknown);
  }

  private async publish(
    method: string,
    candidate: unknown,
  ): Promise<ResultValue<void, ProjectionSinkError>> {
    const projection = normaliseProjection(candidate);
    if (!projection) return this.invalid(method, candidate);
    this.call(method, projection);
    let authorized: boolean;
    try { authorized = this.authority.isCurrentOwner(projection); } catch { return this.fail(method, projection, "transport_unavailable", "not_applied", true); }
    if (typeof authorized !== "boolean") return this.fail(method, projection, "transport_unavailable", "not_applied", true);
    if (!authorized) return this.fail(method, projection, "owner_conflict");
    if (projection.type === "agent_terminal") {
      let committed: boolean;
      try { committed = this.authority.isCommittedTerminalRef(projection, projection.terminalCommitRef); } catch { return this.fail(method, projection, "transport_unavailable", "not_applied", true); }
      if (typeof committed !== "boolean") return this.fail(method, projection, "transport_unavailable", "not_applied", true);
      if (!committed) return this.fail(method, projection, "terminal_not_committed");
    }

    const ownerKey = keyOf(projection);
    const cursor = this.cursors.get(ownerKey);
    if (!cursor) {
      if (projection.type !== "agent_snapshot") return this.fail(method, projection, "stale_generation");
    } else if (projection.watchGeneration < cursor.generation) {
      return this.fail(method, projection, "stale_generation");
    } else if (projection.watchGeneration > cursor.generation) {
      if (projection.type !== "agent_snapshot") return this.fail(method, projection, "stale_generation");
    } else {
      if (cursor.closed) return this.fail(method, projection, "generation_closed");
      if (projection.type === "agent_snapshot") return this.fail(method, projection, "stale_generation");
      if (projection.receiptSeq <= cursor.receiptSeq) return this.fail(method, projection, "stale_sequence");
    }

    if (this.runtime.hitFault("before_effect")) return this.fail(method, projection, "transport_unavailable", "not_applied", true);
    try {
      const transportResult = this.transport.publish(projection) as unknown;
      if (transportResult !== undefined) {
        if (transportResult && typeof (transportResult as { catch?: unknown }).catch === "function") {
          void (transportResult as Promise<unknown>).catch(() => undefined);
        }
        return this.fail(method, projection, "transport_unavailable", "unknown", true);
      }
      this.cursors.set(ownerKey, {
        generation: projection.watchGeneration,
        receiptSeq: projection.receiptSeq,
        closed: projection.type === "agent_terminal",
      });
      this.runtime.recordTrace(traceInput(method, projection, "applied", "published"));
      return Result.ok(undefined);
    } catch {
      return this.fail(method, projection, "transport_unavailable", "unknown", true);
    }
  }

  private invalid(method: string, _candidate: unknown): ResultValue<never, ProjectionSinkError> {
    this.runtime.recordTrace({ contract: "EF-S08", method, effectId: "invalid-projection", certainty: "not_applied", resultTag: "protected_payload" });
    return Result.err(Object.freeze({ _tag: "protected_payload", certainty: "not_applied", retryable: false }));
  }

  private call(method: string, projection: PublicAgentProjection): void {
    this.runtime.recordTrace(traceInput(method, projection, null, "call"));
  }

  private fail(
    method: string,
    projection: PublicAgentProjection,
    tag: ProjectionSinkErrorTag,
    certainty: ProjectionSinkError["certainty"] = "not_applied",
    retryable = false,
  ): ResultValue<never, ProjectionSinkError> {
    this.runtime.recordTrace(traceInput(method, projection, certainty, tag));
    return Result.err(Object.freeze({ _tag: tag, certainty, retryable }));
  }
}

function keyOf(owner: ProjectionOwner): string {
  return JSON.stringify([owner.chatJid, owner.operationId, owner.harnessOperationId]);
}

function traceInput(method: string, value: PublicAgentProjection, certainty: ProjectionSinkError["certainty"] | null, resultTag: string) {
  return { contract: "EF-S08", method, effectId: `${keyOf(value)}:${value.watchGeneration}:${value.receiptSeq}`, operationId: value.operationId, sourceSeq: value.receiptSeq, version: value.watchGeneration, certainty, resultTag };
}

function normaliseProjection(value: unknown): PublicAgentProjection | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const candidate = value as Record<string, unknown>;
    const type = candidate.type;
    if (typeof type !== "string") return null;
    const allowed = ALLOWED_KEYS[type as PublicAgentProjection["type"]];
    if (!allowed || !Object.keys(candidate).every((key) => allowed.has(key))) return null;
    const chatJid = candidate.chatJid; const operationId = candidate.operationId; const harnessOperationId = candidate.harnessOperationId;
    const watchGeneration = candidate.watchGeneration; const receiptSeq = candidate.receiptSeq;
    if (!stable(candidate, "type", type) || !stable(candidate, "chatJid", chatJid) || !stable(candidate, "operationId", operationId) || !stable(candidate, "harnessOperationId", harnessOperationId) || !stable(candidate, "watchGeneration", watchGeneration) || !stable(candidate, "receiptSeq", receiptSeq)) return null;
    if (!nonEmpty(chatJid) || !nonEmpty(operationId) || (harnessOperationId !== null && !nonEmpty(harnessOperationId)) || !nonNegativeSafeInteger(watchGeneration) || !nonNegativeSafeInteger(receiptSeq)) return null;
    const identity = { type, chatJid, operationId, harnessOperationId, watchGeneration, receiptSeq };
    switch (type) {
      case "agent_snapshot": {
        const phase = candidate.phase; const modelLabel = candidate.modelLabel; const tools = candidate.activeToolNames; const cancellationRequested = candidate.cancellationRequested;
        const activeToolNames = stableStringArray(candidate, "activeToolNames", tools);
        if (!stable(candidate, "phase", phase) || !stable(candidate, "modelLabel", modelLabel) || !stable(candidate, "cancellationRequested", cancellationRequested) || !PHASES.has(phase as string) || !nullableString(modelLabel) || !activeToolNames || typeof cancellationRequested !== "boolean") return null;
        return Object.freeze({ ...identity, type, phase, modelLabel, activeToolNames, cancellationRequested } as PublicAgentSnapshot);
      }
      case "phase_changed": { const phase = candidate.phase; return stable(candidate, "phase", phase) && PHASES.has(phase as string) ? Object.freeze({ ...identity, type, phase } as PublicAgentEvent) : null; }
      case "assistant_delta": { const textDelta = candidate.textDelta; return stable(candidate, "textDelta", textDelta) && typeof textDelta === "string" ? Object.freeze({ ...identity, type, textDelta }) : null; }
      case "tool_started": { const toolCallId = candidate.toolCallId; const toolName = candidate.toolName; return stable(candidate, "toolCallId", toolCallId) && stable(candidate, "toolName", toolName) && nonEmpty(toolCallId) && nonEmpty(toolName) ? Object.freeze({ ...identity, type, toolCallId, toolName }) : null; }
      case "tool_updated": { const toolCallId = candidate.toolCallId; const publicSummary = candidate.publicSummary; return stable(candidate, "toolCallId", toolCallId) && stable(candidate, "publicSummary", publicSummary) && nonEmpty(toolCallId) && nullableString(publicSummary) ? Object.freeze({ ...identity, type, toolCallId, publicSummary }) : null; }
      case "tool_finished": { const toolCallId = candidate.toolCallId; const outcome = candidate.outcome; return stable(candidate, "toolCallId", toolCallId) && stable(candidate, "outcome", outcome) && nonEmpty(toolCallId) && TOOL_OUTCOMES.has(outcome as string) ? Object.freeze({ ...identity, type, toolCallId, outcome } as PublicAgentEvent) : null; }
      case "usage_updated": { const inputTokens = candidate.inputTokens; const outputTokens = candidate.outputTokens; return stable(candidate, "inputTokens", inputTokens) && stable(candidate, "outputTokens", outputTokens) && nonNegativeSafeInteger(inputTokens) && nonNegativeSafeInteger(outputTokens) ? Object.freeze({ ...identity, type, inputTokens, outputTokens }) : null; }
      case "agent_terminal": {
        const terminalCommitRef = candidate.terminalCommitRef; const disposition = candidate.disposition; const messageRowId = candidate.messageRowId; const errorCode = candidate.errorCode;
        if (!stable(candidate, "terminalCommitRef", terminalCommitRef) || !stable(candidate, "disposition", disposition) || !stable(candidate, "messageRowId", messageRowId) || !stable(candidate, "errorCode", errorCode) || !nonEmpty(terminalCommitRef) || !DISPOSITIONS.has(disposition as string) || (messageRowId !== null && (!Number.isSafeInteger(messageRowId) || (messageRowId as number) <= 0)) || !nullableString(errorCode)) return null;
        return Object.freeze({ ...identity, type, terminalCommitRef, disposition, messageRowId, errorCode } as PublicTerminalProjection);
      }
      default: return null;
    }
  } catch { return null; }
}
function stable(candidate: Record<string, unknown>, key: string, value: unknown): boolean { return Object.is(candidate[key], value); }
function stableStringArray(candidate: Record<string, unknown>, key: string, value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || !stable(candidate, key, value)) return null;
  const first = Array.from(value as unknown[]); const second = Array.from(value as unknown[]);
  if (first.length !== second.length || first.some((entry, index) => !nonEmpty(entry) || !Object.is(entry, second[index]))) return null;
  return Object.freeze(first as string[]);
}
const PHASES = new Set(["idle", "accepted", "running", "waiting", "suspended", "cancelling"]);
const TOOL_OUTCOMES = new Set(["completed", "failed", "cancelled"]);
const DISPOSITIONS = new Set(["completed", "cancelled", "failed", "skipped", "superseded"]);
function nonEmpty(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function nullableString(value: unknown): value is string | null { return value === null || typeof value === "string"; }
function nonNegativeSafeInteger(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }

const IDENTITY_KEYS = ["type", "chatJid", "operationId", "harnessOperationId", "watchGeneration", "receiptSeq"];
const ALLOWED_KEYS: Record<PublicAgentProjection["type"], ReadonlySet<string>> = {
  agent_snapshot: new Set([...IDENTITY_KEYS, "phase", "modelLabel", "activeToolNames", "cancellationRequested"]),
  phase_changed: new Set([...IDENTITY_KEYS, "phase"]),
  assistant_delta: new Set([...IDENTITY_KEYS, "textDelta"]),
  tool_started: new Set([...IDENTITY_KEYS, "toolCallId", "toolName"]),
  tool_updated: new Set([...IDENTITY_KEYS, "toolCallId", "publicSummary"]),
  tool_finished: new Set([...IDENTITY_KEYS, "toolCallId", "outcome"]),
  usage_updated: new Set([...IDENTITY_KEYS, "inputTokens", "outputTokens"]),
  agent_terminal: new Set([...IDENTITY_KEYS, "terminalCommitRef", "disposition", "messageRowId", "errorCode"]),
};
