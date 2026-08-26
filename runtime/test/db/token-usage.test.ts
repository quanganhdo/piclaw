/**
 * test/db/token-usage.test.ts – Tests for token usage tracking.
 *
 * Verifies token_usage table operations: recording, querying by time
 * range, aggregation, and summary formatting.
 */

import { describe, test, expect } from "bun:test";
import "../helpers.js";

import {
  getLatestTokenUsage,
  getLatestTokenUsageModel,
  getTokenUsageByModel,
  getTokenUsageByProvider,
  getTokenUsageTotals,
  initDatabase,
  storeTokenUsage,
} from "../../src/db.js";
import { getDb } from "../../src/db/connection.js";

describe("token-usage", () => {
  test("storeTokenUsage inserts a record", () => {
    initDatabase();
    const db = getDb();

    storeTokenUsage({
      chat_jid: "test:token",
      run_at: new Date().toISOString(),
      input_tokens: 100,
      output_tokens: 50,
      reasoning_tokens: 7,
      cache_read_tokens: 10,
      cache_write_tokens: 5,
      total_tokens: 165,
      cost_input: 0.001,
      cost_output: 0.002,
      cost_cache_read: 0.0001,
      cost_cache_write: 0.00005,
      cost_total: 0.00315,
      model: "gpt-4",
      provider: "openai",
      api: "chat",
      turns: 3,
    });

    const row = db.prepare("SELECT * FROM token_usage WHERE chat_jid = ?").get("test:token") as any;
    expect(row).toBeDefined();
    expect(row.input_tokens).toBe(100);
    expect(row.output_tokens).toBe(50);
    expect(row.reasoning_tokens).toBe(7);
    expect(row.total_tokens).toBe(165);
    expect(row.model).toBe("gpt-4");
    expect(row.response_model).toBeNull();
    expect(row.provider).toBe("openai");
    expect(row.turns).toBe(3);
  });

  test("storeTokenUsage preserves cache and cost provenance fields", () => {
    initDatabase();
    const chatJid = "test:token-provenance";

    storeTokenUsage({
      chat_jid: chatJid,
      run_at: "2026-08-25T12:00:00.000Z",
      input_tokens: 100,
      output_tokens: 20,
      cache_read_tokens: 0,
      cache_write_tokens: 5,
      cache_read_reported: true,
      cache_write_reported: false,
      total_tokens: 125,
      cost_input: 0.001,
      cost_output: 0.002,
      cost_cache_read: 0,
      cost_cache_write: 0.0001,
      cost_total: 0.00123,
      provider_cost_total: 0.00123,
      catalogue_cost_total: 0.0031,
      cost_provenance: "provider_reported",
      model: "auto",
      provider: "openrouter",
    });

    const latest = getLatestTokenUsage(chatJid);
    expect(latest).toMatchObject({
      cache_read_reported: 1,
      cache_write_reported: 0,
      provider_cost_total: 0.00123,
      catalogue_cost_total: 0.0031,
      cost_total: 0.00123,
      cost_provenance: "provider_reported",
    });
    const totals = getTokenUsageTotals(chatJid);
    expect(totals.provider_reported_cost_runs).toBe(1);
    expect(totals.catalogue_estimate_cost_runs).toBe(0);
    expect(totals.unavailable_cost_runs).toBe(0);
    expect(totals.legacy_cost_runs).toBe(0);
  });

  test("storeTokenUsage handles null optional fields", () => {
    initDatabase();
    const db = getDb();

    storeTokenUsage({
      chat_jid: "test:token-null",
      run_at: new Date().toISOString(),
      input_tokens: 10,
      output_tokens: 5,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      total_tokens: 15,
      cost_input: 0,
      cost_output: 0,
      cost_cache_read: 0,
      cost_cache_write: 0,
      cost_total: 0,
    });

    const row = db.prepare("SELECT * FROM token_usage WHERE chat_jid = ?").get("test:token-null") as any;
    expect(row).toBeDefined();
    expect(row.model).toBeNull();
    expect(row.response_model).toBeNull();
    expect(row.provider).toBeNull();
    expect(row.turns).toBeNull();
  });

  test("aggregates overall totals, provider totals, and model totals", () => {
    initDatabase();

    const chatJid = "test:aggregate";
    storeTokenUsage({
      chat_jid: chatJid,
      run_at: new Date().toISOString(),
      input_tokens: 100,
      output_tokens: 50,
      reasoning_tokens: 15,
      cache_read_tokens: 10,
      cache_write_tokens: 0,
      total_tokens: 160,
      cost_input: 0,
      cost_output: 0,
      cost_cache_read: 0,
      cost_cache_write: 0,
      cost_total: 0.16,
      provider: "openai",
      model: "gpt-4o",
    });

    storeTokenUsage({
      chat_jid: chatJid,
      run_at: new Date().toISOString(),
      input_tokens: 90,
      output_tokens: 30,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      total_tokens: 120,
      cost_input: 0,
      cost_output: 0,
      cost_cache_read: 0,
      cost_cache_write: 0,
      cost_total: 0.12,
      provider: "openai",
      model: "gpt-4o",
    });

    storeTokenUsage({
      chat_jid: chatJid,
      run_at: new Date().toISOString(),
      input_tokens: 40,
      output_tokens: 20,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      total_tokens: 60,
      cost_input: 0,
      cost_output: 0,
      cost_cache_read: 0,
      cost_cache_write: 0,
      cost_total: 0.06,
      provider: "anthropic",
      model: "claude",
    });

    const totals = getTokenUsageTotals(chatJid);
    expect(totals.total_tokens).toBe(340);
    expect(totals.reasoning_tokens).toBe(15);
    expect(totals.runs).toBe(3);

    const provider = getTokenUsageByProvider(chatJid, 10);
    expect(provider.length).toBe(2);
    expect(provider[0].provider).toBe("openai");
    expect(provider[0].total_tokens).toBe(280);
    expect(provider[0].runs).toBe(2);

    const model = getTokenUsageByModel(chatJid, 10);
    expect(model.length).toBe(2);
    expect(model[0].model).toBe("gpt-4o");
    expect(model[0].total_tokens).toBe(280);
    expect(model[0].runs).toBe(2);
  });

  test("groups model totals by concrete response model when present", () => {
    initDatabase();
    const chatJid = "test:response-model";

    storeTokenUsage({
      chat_jid: chatJid,
      run_at: new Date().toISOString(),
      input_tokens: 20,
      output_tokens: 10,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      total_tokens: 30,
      cost_input: 0,
      cost_output: 0,
      cost_cache_read: 0,
      cost_cache_write: 0,
      cost_total: 0.03,
      provider: "openrouter",
      model: "auto",
      response_model: "anthropic/claude-sonnet-4-5",
    });

    const model = getTokenUsageByModel(chatJid, 10);
    expect(model).toHaveLength(1);
    expect(model[0].model).toBe("anthropic/claude-sonnet-4-5");
    expect(model[0].total_tokens).toBe(30);
  });

  test("returns the latest requested and response model metadata for compose status", () => {
    initDatabase();
    const chatJid = "test:latest-response-model";

    storeTokenUsage({
      chat_jid: chatJid,
      run_at: "2026-05-01T10:00:00.000Z",
      input_tokens: 1,
      output_tokens: 1,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      total_tokens: 2,
      cost_input: 0,
      cost_output: 0,
      cost_cache_read: 0,
      cost_cache_write: 0,
      cost_total: 0,
      provider: "openrouter",
      model: "auto",
      response_model: "anthropic/claude-sonnet-4-5",
    });
    storeTokenUsage({
      chat_jid: chatJid,
      run_at: "2026-05-01T10:01:00.000Z",
      input_tokens: 2,
      output_tokens: 2,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      total_tokens: 4,
      cost_input: 0,
      cost_output: 0,
      cost_cache_read: 0,
      cost_cache_write: 0,
      cost_total: 0,
      provider: "openrouter",
      model: "auto",
      response_model: "google/gemini-2.5-pro",
    });

    expect(getLatestTokenUsageModel(chatJid)).toEqual({
      model: "auto",
      response_model: "google/gemini-2.5-pro",
      provider: "openrouter",
      run_at: "2026-05-01T10:01:00.000Z",
    });
  });

  test("coalesces grouped token usage aggregates when legacy rows contain null counts", () => {
    initDatabase();
    const db = getDb();
    const chatJid = "test:aggregate-null";
    db.prepare(
      `INSERT INTO token_usage (
        chat_jid,
        run_at,
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_write_tokens,
        total_tokens,
        cost_input,
        cost_output,
        cost_cache_read,
        cost_cache_write,
        cost_total,
        model,
        provider,
        api,
        turns
      ) VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, 0, 0, 0, 0, NULL, ?, ?, NULL, NULL)`
    ).run(chatJid, new Date().toISOString(), "legacy-model", "legacy-provider");

    const provider = getTokenUsageByProvider(chatJid, 10);
    expect(provider).toEqual([{
      provider: "legacy-provider",
      input_tokens: 0,
      output_tokens: 0,
      reasoning_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      total_tokens: 0,
      cost_total: 0,
      runs: 1,
      provider_reported_cost_runs: 0,
      catalogue_estimate_cost_runs: 0,
      unavailable_cost_runs: 0,
      legacy_cost_runs: 1,
    }]);

    const model = getTokenUsageByModel(chatJid, 10);
    expect(model).toEqual([{
      model: "legacy-model",
      input_tokens: 0,
      output_tokens: 0,
      reasoning_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      total_tokens: 0,
      cost_total: 0,
      runs: 1,
      provider_reported_cost_runs: 0,
      catalogue_estimate_cost_runs: 0,
      unavailable_cost_runs: 0,
      legacy_cost_runs: 1,
    }]);
  });
});
