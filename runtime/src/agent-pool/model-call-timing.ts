import { hrtime } from "node:process";

export interface ModelCallTimingState {
  sequence: number;
  callStartedAt: number;
  responseStartedAt: number | null;
  firstOutputAt: number | null;
  lastOutputAt: number | null;
  firstTextAt: number | null;
  lastTextAt: number | null;
}

export interface ModelCallTimingResult {
  callDurationMs: number;
  responseDurationMs: number | null;
  responseStartLatencyMs: number | null;
  timeToFirstOutputMs: number | null;
  timeToFirstTextMs: number | null;
  generationDurationMs: number | null;
  textGenerationDurationMs: number | null;
}

function nowMs(): number {
  return Number(hrtime.bigint()) / 1_000_000;
}

export function createModelCallTiming(sequence: number, startedAt = nowMs()): ModelCallTimingState {
  return {
    sequence,
    callStartedAt: startedAt,
    responseStartedAt: null,
    firstOutputAt: null,
    lastOutputAt: null,
    firstTextAt: null,
    lastTextAt: null,
  };
}

export function markModelResponseStarted(state: ModelCallTimingState, observedAt = nowMs()): void {
  state.responseStartedAt ??= observedAt;
}

export function markModelOutputObserved(
  state: ModelCallTimingState,
  eventType: string | undefined,
  delta: string | undefined,
  observedAt = nowMs(),
): void {
  const isToolCallStart = eventType === "toolcall_start";
  const hasOutputDelta = (
    eventType === "text_delta" || eventType === "thinking_delta" || eventType === "toolcall_delta"
  ) && typeof delta === "string" && delta.length > 0;
  if (!isToolCallStart && !hasOutputDelta) return;
  state.firstOutputAt ??= observedAt;
  state.lastOutputAt = observedAt;
  if (eventType === "text_delta" && typeof delta === "string" && delta.length > 0) {
    state.firstTextAt ??= observedAt;
    state.lastTextAt = observedAt;
  }
}

export function completeModelCallTiming(
  state: ModelCallTimingState,
  completedAt = nowMs(),
): ModelCallTimingResult {
  return {
    callDurationMs: Math.max(0, completedAt - state.callStartedAt),
    responseDurationMs: state.responseStartedAt == null ? null : Math.max(0, completedAt - state.responseStartedAt),
    responseStartLatencyMs: state.responseStartedAt == null ? null : Math.max(0, state.responseStartedAt - state.callStartedAt),
    timeToFirstOutputMs: state.firstOutputAt == null ? null : Math.max(0, state.firstOutputAt - state.callStartedAt),
    timeToFirstTextMs: state.firstTextAt == null ? null : Math.max(0, state.firstTextAt - state.callStartedAt),
    generationDurationMs: state.firstOutputAt == null || state.lastOutputAt == null
      ? null
      : Math.max(0, state.lastOutputAt - state.firstOutputAt),
    textGenerationDurationMs: state.firstTextAt == null || state.lastTextAt == null
      ? null
      : Math.max(0, state.lastTextAt - state.firstTextAt),
  };
}
