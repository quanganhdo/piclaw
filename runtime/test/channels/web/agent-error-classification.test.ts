/**
 * test/channels/web/agent-error-classification.test.ts
 *
 * Tests for provider error classification and user-visible error formatting.
 */

// Import the non-exported functions by re-exporting via a dynamic wrapper
import { describe, expect, test } from "bun:test";
import {
  formatProviderError,
  parseProviderError,
  sanitizeProviderErrorDetail,
} from "../../../src/channels/web/handlers/provider-error-format.js";
import { classifyOpaqueAgentFailure } from "../../../src/agent-pool/automatic-recovery.js";
import { isOrphanFunctionCallOutputError } from "../../../src/utils/provider-payload-errors.js";

// We test through the module's internal functions by importing the file
// and accessing the exported formatUserVisibleError indirectly.
// Since the functions are module-level but not exported, we test via patterns.

describe("provider error classification", () => {
  // We'll test the patterns directly since the classification functions
  // use regex matching on error text.

  const authPatterns = /authentication failed|credentials may have expired|no api key found|re-authenticate|unauthorized|\b401\b|\b403\b|invalid.*api.*key|api.*key.*invalid|token.*expired|oauth.*expired|refresh.*token/i;
  const quotaPatterns = /quota|usage.*limit|out of.*usage|billing|insufficient.*funds|exceeded.*limit|credit/i;
  const rateLimitPatterns = /\b429\b|rate[ -]?limit|too many requests|retry-after/i;
  const sessionCorruptionPatterns = /invalid_request_error|\b400\b.*(?:image|media_type|content|base64|tool_use_id|tool_result|tool_use)|media_type|image.*source|unexpected [`'\"]?tool_use_id[`'\"]?|tool_result.*corresponding.*tool_use/i;
  const modelConfigPatterns = /no model selected|select a model|use \/model|use \/login/i;
  const modelAvailabilityPatterns = /unsupported model|model(?:\s+is)?\s+not supported|model unavailable/i;

  test("detects Anthropic auth expiry", () => {
    expect(authPatterns.test('Authentication failed for "anthropic". Credentials may have expired or network is unavailable. Run \'/login anthropic\' to re-authenticate.')).toBe(true);
  });

  test("detects missing API key", () => {
    expect(authPatterns.test("No API key found for openai.")).toBe(true);
  });

  test("detects HTTP 401", () => {
    expect(authPatterns.test("Error: 401 Unauthorized")).toBe(true);
  });

  test("detects HTTP 403", () => {
    expect(authPatterns.test("Error: 403 Forbidden")).toBe(true);
  });

  test("detects OAuth token expiry", () => {
    expect(authPatterns.test("OAuth token expired for github-copilot")).toBe(true);
  });

  test("keeps OAuth refresh 5xx responses in the transient server/network category", () => {
    const errorText = "OAuth refresh token failed for github-copilot: 502 Bad Gateway";

    expect(classifyOpaqueAgentFailure(errorText)).toBe("network");
    expect(formatProviderError(errorText)).toMatchObject({
      category: "server",
      title: "GitHub Copilot server error",
    });
  });

  test("detects invalid API key", () => {
    expect(authPatterns.test("Invalid API key provided")).toBe(true);
  });

  test("detects quota/billing errors", () => {
    expect(quotaPatterns.test('Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"You\'re out of extra usage."}}')).toBe(true);
    expect(quotaPatterns.test("Billing limit exceeded")).toBe(true);
    expect(quotaPatterns.test("Insufficient funds in your account")).toBe(true);
    expect(quotaPatterns.test("Monthly usage limit reached")).toBe(true);
  });

  test("detects rate limits", () => {
    expect(rateLimitPatterns.test("429 Too Many Requests")).toBe(true);
    expect(rateLimitPatterns.test("Rate limit exceeded")).toBe(true);
    expect(rateLimitPatterns.test("Retry-After: 30")).toBe(true);
  });

  test("detects session corruption from image, orphaned tool-result and Responses output errors", () => {
    expect(sessionCorruptionPatterns.test('400 messages.2.content.1.image.source.base64.data: Image format image/png not supported')).toBe(true);
    expect(sessionCorruptionPatterns.test("invalid_request_error")).toBe(true);
    expect(sessionCorruptionPatterns.test('400 messages.2.content.0: unexpected `tool_use_id` found in `tool_result` blocks: toolu_test. Each `tool_result` block must have a corresponding `tool_use` block in the previous message.')).toBe(true);
    expect(isOrphanFunctionCallOutputError("No tool call found for function call output with call_id call_orphan.")).toBe(true);
    expect(isOrphanFunctionCallOutputError("invalid_request_body: unrelated malformed request")).toBe(false);
  });

  test("detects model config errors", () => {
    expect(modelConfigPatterns.test("No model selected. Use /model to select a model.")).toBe(true);
  });

  test("detects model availability errors", () => {
    expect(modelAvailabilityPatterns.test("400 Model not supported")).toBe(true);
    expect(modelAvailabilityPatterns.test("unsupported model: github-copilot/gpt-5.5")).toBe(true);
  });

  test("does not false-positive on normal errors", () => {
    const normalError = "Connection reset by peer";
    expect(authPatterns.test(normalError)).toBe(false);
    expect(quotaPatterns.test(normalError)).toBe(false);
    expect(rateLimitPatterns.test(normalError)).toBe(false);
    expect(sessionCorruptionPatterns.test(normalError)).toBe(false);
    expect(modelConfigPatterns.test(normalError)).toBe(false);
    expect(modelAvailabilityPatterns.test(normalError)).toBe(false);
  });

  test("parses Codex JSON server error envelopes for display", () => {
    const errorText = 'Codex error: {"type":"error","error":{"type":"server_error","code":"server_error","message":"An error occurred while processing your request. You can retry your request, or contact us through our help center at help.openai.com if the error persists. Please include the request ID 7b101289-798a-4b84-bec4-fef42cc49469 in your message.","param":null},"sequence_number":4}';

    const parsed = parseProviderError(errorText);
    expect(parsed?.provider).toBe("Codex");
    expect(parsed?.type).toBe("server_error");
    expect(parsed?.code).toBe("server_error");
    expect(parsed?.requestId).toBe("7b101289-798a-4b84-bec4-fef42cc49469");
    expect(parsed?.sequenceNumber).toBe(4);

    const formatted = formatProviderError(errorText);
    expect(formatted?.category).toBe("server");
    expect(formatted?.title).toBe("Codex server error");
    expect(formatted?.label).toBe("provider");
    expect(formatted?.severity).toBe("warning");
    expect(formatted?.detail).toContain("request id: 7b101289-798a-4b84-bec4-fef42cc49469");
    expect(formatted?.detail).toContain("sequence: 4");
  });

  test("classifies WebSocket 1006 provider disconnects as network errors for display", () => {
    const formatted = formatProviderError("Codex error: WebSocket closed 1006 Connection ended");

    expect(formatted?.category).toBe("network");
    expect(formatted?.title).toBe("Codex connection closed");
    expect(formatted?.label).toBe("network");
    expect(formatted?.detail).toContain("Retry the message");
  });

  test("sanitizes Bun fetch verbose hints from provider socket disconnects", () => {
    const raw = "The socket connection was closed unexpectedly. For more information, pass verbose: true in the second argument to fetch()";

    expect(sanitizeProviderErrorDetail(raw)).toBe("The socket connection was closed unexpectedly.");

    const formatted = formatProviderError(raw);
    expect(formatted?.category).toBe("network");
    expect(formatted?.title).toBe("Provider connection closed");
    expect(formatted?.label).toBe("network");
    expect(formatted?.severity).toBe("error");
    expect(formatted?.detail).toContain("The socket connection was closed unexpectedly.");
    expect(formatted?.detail).toContain("Retry the message");
    expect(formatted?.detail).not.toContain("verbose: true");
  });

  test("classifies plain model-not-supported outage text for display", () => {
    const formatted = formatProviderError("400 Model not supported during GitHub provider outage");

    expect(formatted?.category).toBe("model_availability");
    expect(formatted?.title).toBe("GitHub Copilot model unavailable");
    expect(formatted?.label).toBe("model");
    expect(formatted?.severity).toBe("warning");
    expect(formatted?.detail).toContain("temporary provider outage");
  });
});
