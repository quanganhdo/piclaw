import { expect, test } from "bun:test";

import {
  createOpenRouterOutputBudgetState,
  decideOpenRouterAffordabilityRetry,
  parseOpenRouterAffordabilityError,
  sanitizeOpenRouterProviderErrorText,
} from "../../src/core/openrouter-output-budget.js";

const observedError = '402: {"message":"This request requires more credits, or fewer max_tokens. You requested up to 384000 tokens, but can only afford 71428. To increase, visit https://openrouter.ai/settings/credits"}';

function preparedState(limit = 384_000) {
  const state = createOpenRouterOutputBudgetState("web:test", "turn-1");
  state.requestAttempt = 1;
  state.lastAppliedLimit = limit;
  state.lastOriginalLimit = limit;
  state.lastTokenField = "max_tokens";
  return state;
}

test("parses the exact bounded OpenRouter affordability response", () => {
  expect(parseOpenRouterAffordabilityError(observedError)).toEqual({
    requested: 384_000,
    affordable: 71_428,
  });
});

test("rejects generic, malformed, negative, and implausibly large 402 responses", () => {
  expect(parseOpenRouterAffordabilityError("402: insufficient credits")).toBeNull();
  expect(parseOpenRouterAffordabilityError("401: This request requires more credits, or fewer max_tokens. You requested up to 1000 tokens, but can only afford 500.")).toBeNull();
  expect(parseOpenRouterAffordabilityError("402: This request requires more credits, or fewer max_tokens. You requested up to -1000 tokens, but can only afford 500.")).toBeNull();
  expect(parseOpenRouterAffordabilityError("402: This request requires more credits, or fewer max_tokens. You requested up to 999999999 tokens, but can only afford 500.")).toBeNull();
});

test("derives one 90-percent parameter-changing retry", () => {
  const state = preparedState();
  const decision = decideOpenRouterAffordabilityRetry(observedError, "openrouter/deepseek/test", state);

  expect(decision).toMatchObject({
    kind: "retry",
    requested: 384_000,
    affordable: 71_428,
    appliedLimit: 64_285,
  });
  expect(state.adaptiveRetryAttempted).toBe(true);
  expect(state.adaptiveLimit).toBe(64_285);
  expect(decision.kind === "retry" ? decision.detail : "").not.toContain("https://");
});

test("makes a repeated affordability failure terminal", () => {
  const state = preparedState(10_000);
  state.adaptiveRetryAttempted = true;
  state.adaptiveLimit = 10_000;
  const error = "HTTP 402: This request requires more credits, or fewer max_tokens. You requested up to 10000 tokens, but can only afford 5000.";

  expect(decideOpenRouterAffordabilityRetry(error, "openrouter/test", state)).toMatchObject({
    kind: "terminal",
    reason: "adaptive_retry_exhausted",
    requested: 10_000,
    affordable: 5_000,
  });
});

test("rejects mismatched, non-reducing, and unusably small adaptive limits", () => {
  const mismatch = decideOpenRouterAffordabilityRetry(observedError, "openrouter/test", preparedState(32_768));
  expect(mismatch).toMatchObject({ kind: "terminal", reason: "request_limit_mismatch" });

  const nonReducing = decideOpenRouterAffordabilityRetry(
    "402: This request requires more credits, or fewer max_tokens. You requested up to 10000 tokens, but can only afford 20000.",
    "openrouter/test",
    preparedState(10_000),
  );
  expect(nonReducing).toMatchObject({ kind: "terminal", reason: "adaptive_limit_not_reducing" });

  const tooSmall = decideOpenRouterAffordabilityRetry(
    "402: This request requires more credits, or fewer max_tokens. You requested up to 10000 tokens, but can only afford 1000.",
    "openrouter/test",
    preparedState(10_000),
  );
  expect(tooSmall).toMatchObject({ kind: "terminal", reason: "adaptive_limit_too_small" });
});

test("sanitizes OpenRouter 402 event and log text before recovery", () => {
  const raw = `${observedError}${" provider-body".repeat(2_000)}`;
  const sanitized = sanitizeOpenRouterProviderErrorText(raw, "openrouter/deepseek/test");
  expect(sanitized).toBe("OpenRouter output budget rejected (HTTP 402): requested 384000 tokens; affordable 71428 tokens.");
  expect(sanitized).not.toContain("https://");
  expect(sanitized).not.toContain("provider-body");

  expect(sanitizeOpenRouterProviderErrorText("HTTP 402: arbitrary upstream body https://provider.invalid", "openrouter/test"))
    .toBe("OpenRouter rejected the request with HTTP 402; provider response details were omitted.");
  expect(sanitizeOpenRouterProviderErrorText(observedError, "openai/test")).toBe(observedError);
});

test("does not classify other providers or non-402 failures", () => {
  expect(decideOpenRouterAffordabilityRetry(observedError, "openai/test", preparedState())).toEqual({ kind: "not_applicable" });
  expect(decideOpenRouterAffordabilityRetry("503: unavailable", "openrouter/test", preparedState())).toEqual({ kind: "not_applicable" });
});
