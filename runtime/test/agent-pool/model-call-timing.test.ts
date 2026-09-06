import { expect, test } from "bun:test";

import {
  completeModelCallTiming,
  createModelCallTiming,
  markModelOutputObserved,
  markModelResponseStarted,
} from "../../src/agent-pool/model-call-timing.js";

test("default model-call timing clock stays finite and monotonic", () => {
  const state = createModelCallTiming(1);
  markModelResponseStarted(state);
  markModelOutputObserved(state, "text_delta", "hello");
  const timing = completeModelCallTiming(state);

  expect(Object.values(timing).every((value) => value === null || Number.isFinite(value))).toBe(true);
  expect(timing.responseDurationMs).toBeLessThanOrEqual(timing.callDurationMs);
  expect(timing.responseStartLatencyMs).toBeLessThanOrEqual(timing.callDurationMs);
});

test("model-call timing separates call, response, first output, visible text, and generation intervals", () => {
  const state = createModelCallTiming(3, 1_000);
  markModelResponseStarted(state, 1_120);
  markModelOutputObserved(state, "thinking_start", undefined, 1_180);
  markModelOutputObserved(state, "thinking_delta", "reasoning", 1_260);
  markModelOutputObserved(state, "text_start", undefined, 1_300);
  markModelOutputObserved(state, "text_delta", "hello", 1_340);
  markModelOutputObserved(state, "text_delta", " world", 1_500);

  expect(completeModelCallTiming(state, 1_550)).toEqual({
    callDurationMs: 550,
    responseDurationMs: 430,
    responseStartLatencyMs: 120,
    timeToFirstOutputMs: 260,
    timeToFirstTextMs: 340,
    generationDurationMs: 240,
    textGenerationDurationMs: 160,
  });
});

test("model-call timing handles tool-only output and missing stream boundaries", () => {
  const toolOnly = createModelCallTiming(1, 10);
  markModelResponseStarted(toolOnly, 20);
  markModelOutputObserved(toolOnly, "toolcall_start", undefined, 30);
  markModelOutputObserved(toolOnly, "toolcall_delta", '{"path":', 40);
  expect(completeModelCallTiming(toolOnly, 50)).toEqual({
    callDurationMs: 40,
    responseDurationMs: 30,
    responseStartLatencyMs: 10,
    timeToFirstOutputMs: 20,
    timeToFirstTextMs: null,
    generationDurationMs: 10,
    textGenerationDurationMs: null,
  });

  expect(completeModelCallTiming(createModelCallTiming(2, 100), 90)).toEqual({
    callDurationMs: 0,
    responseDurationMs: null,
    responseStartLatencyMs: null,
    timeToFirstOutputMs: null,
    timeToFirstTextMs: null,
    generationDurationMs: null,
    textGenerationDurationMs: null,
  });
});

test("empty deltas do not count as visible text", () => {
  const state = createModelCallTiming(1, 0);
  markModelResponseStarted(state, 10);
  markModelOutputObserved(state, "text_start", undefined, 20);
  markModelOutputObserved(state, "text_delta", "", 30);
  expect(completeModelCallTiming(state, 40)).toEqual({
    callDurationMs: 40,
    responseDurationMs: 30,
    responseStartLatencyMs: 10,
    timeToFirstOutputMs: null,
    timeToFirstTextMs: null,
    generationDurationMs: null,
    textGenerationDurationMs: null,
  });
});
