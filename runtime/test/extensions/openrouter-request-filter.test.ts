import { expect, test } from "bun:test";

import {
  filterOpenRouterRequestPayload,
  openRouterRequestFilter,
  type OpenRouterBudgetDiagnostic,
} from "../../src/extensions/openrouter-request-filter.js";
import {
  beginOpenRouterRequestAttempt,
  createOpenRouterOutputBudgetState,
  decideOpenRouterAffordabilityRetry,
  withOpenRouterOutputBudgetState,
} from "../../src/core/openrouter-output-budget.js";

const DEFAULT_LIMIT = 32_768;

function filter(payload: unknown, provider = "openrouter", state = createOpenRouterOutputBudgetState("web:test")) {
  return filterOpenRouterRequestPayload(payload, provider, "test-model", {
    configuredDefaultMaxTokens: DEFAULT_LIMIT,
    state,
  });
}

test("leaves lower explicit OpenRouter max_tokens unchanged and records the applied limit", () => {
  const state = createOpenRouterOutputBudgetState("web:test");
  const payload = { model: "test", messages: [], max_tokens: 8_192 };
  const result = filter(payload, "openrouter", state);

  expect(result).toBe(payload);
  expect(state.lastAppliedLimit).toBe(8_192);
  expect(state.lastTokenField).toBe("max_tokens");
});

test("clamps excessive max_tokens with a shallow clone", () => {
  const messages: unknown[] = [];
  const payload = { model: "test", messages, max_tokens: 384_000 };
  const result = filter(payload) as typeof payload;

  expect(result).not.toBe(payload);
  expect(result.messages).toBe(messages);
  expect(result.max_tokens).toBe(DEFAULT_LIMIT);
  expect(payload.max_tokens).toBe(384_000);
});

test("adds only max_tokens when the OpenRouter payload has no output limit", () => {
  const payload = { model: "test", messages: [] };
  const result = filter(payload) as Record<string, unknown>;

  expect(result.max_tokens).toBe(DEFAULT_LIMIT);
  expect(result).not.toHaveProperty("max_completion_tokens");
});

test("preserves and clamps the existing max_completion_tokens field", () => {
  const payload = { model: "test", input: [], max_completion_tokens: 90_000 };
  const result = filter(payload) as Record<string, unknown>;

  expect(result.max_completion_tokens).toBe(DEFAULT_LIMIT);
  expect(result).not.toHaveProperty("max_tokens");
});

test("replaces malformed token limits without mutating unrelated fields", () => {
  const metadata = { trace: true };
  const payload = { max_tokens: "384000", metadata };
  const result = filter(payload) as Record<string, unknown>;

  expect(result.max_tokens).toBe(DEFAULT_LIMIT);
  expect(result.metadata).toBe(metadata);
  expect(payload.max_tokens).toBe("384000");
});

test("leaves non-OpenRouter and non-object payloads unchanged", () => {
  const payload = { max_tokens: 384_000 };
  expect(filter(payload, "openai")).toBe(payload);
  expect(filter("payload")).toBe("payload");
});

test("applies a turn-scoped adaptive ceiling and emits bounded diagnostics", () => {
  const diagnostics: OpenRouterBudgetDiagnostic[] = [];
  const state = createOpenRouterOutputBudgetState("web:test", "turn-1");
  state.adaptiveRetryAttempted = true;
  state.adaptiveLimit = 9_000;
  beginOpenRouterRequestAttempt(state);
  beginOpenRouterRequestAttempt(state);
  const payload = { max_tokens: 384_000, messages: ["unchanged"] };

  const result = filterOpenRouterRequestPayload(payload, "openrouter", "model/id", {
    configuredDefaultMaxTokens: DEFAULT_LIMIT,
    state,
    onApplied: (value) => diagnostics.push(value),
  }) as Record<string, unknown>;

  expect(result.max_tokens).toBe(9_000);
  expect(diagnostics).toEqual([{
    provider: "openrouter",
    modelId: "model/id",
    originalLimit: 384_000,
    appliedLimit: 9_000,
    reason: "adaptive_retry",
    attempt: 2,
    field: "max_tokens",
  }]);
});

test("affordability retry produces a parameter-changing second payload", () => {
  const state = createOpenRouterOutputBudgetState("web:test");
  beginOpenRouterRequestAttempt(state);
  const advertised = { max_tokens: 384_000, messages: [] };
  const first = filter(advertised, "openrouter", state) as Record<string, unknown>;
  expect(first.max_tokens).toBe(32_768);

  const decision = decideOpenRouterAffordabilityRetry(
    "402: This request requires more credits, or fewer max_tokens. You requested up to 32768 tokens, but can only afford 10000.",
    "openrouter/test-model",
    state,
  );
  expect(decision).toMatchObject({ kind: "retry", appliedLimit: 9_000 });

  beginOpenRouterRequestAttempt(state);
  const second = filter(advertised, "openrouter", state) as Record<string, unknown>;
  expect(second.max_tokens).toBe(9_000);
  expect(second).not.toEqual(first);
});

test("extension reads the current turn-scoped override", async () => {
  let handler: ((event: any, ctx: any) => Promise<any>) | undefined;
  openRouterRequestFilter({
    on: (event: string, callback: typeof handler) => {
      if (event === "before_provider_request") handler = callback;
    },
  } as any);
  const state = createOpenRouterOutputBudgetState("web:test");
  state.adaptiveLimit = 7_500;
  beginOpenRouterRequestAttempt(state);

  const result = await withOpenRouterOutputBudgetState(state, async () => await handler!(
    { payload: { max_tokens: 100_000 } },
    { model: { provider: "openrouter", id: "test-model" } },
  ));

  expect(result.max_tokens).toBe(7_500);
  expect(state.lastAppliedLimit).toBe(7_500);
});
