import { describe, expect, test } from "bun:test";
import { resolveProviderModelPricing } from "../../skills/operator/token-chart/provider-model-pricing-reference.ts";

describe("provider/model pricing reference", () => {
  test("keeps route-specific prices separate", () => {
    expect(resolveProviderModelPricing("azure-foundry", "deepseek-v4-flash")).toMatchObject({
      canonicalModel: "DeepSeek V4 Flash (Azure Foundry)",
      inputPerMTok: 0.19,
      outputPerMTok: 0.51,
    });
    expect(resolveProviderModelPricing("deepseek", "deepseek-v4-flash")).toMatchObject({
      canonicalModel: "DeepSeek V4 Flash (native)",
      inputPerMTok: 0.14,
      cacheReadPerMTok: 0.0028,
    });
    expect(resolveProviderModelPricing("openrouter", "deepseek/deepseek-v4-flash")).toMatchObject({
      canonicalModel: "DeepSeek V4 Flash (OpenRouter)",
      inputPerMTok: 0.08358,
      outputPerMTok: 0.16716,
    });
  });

  test("does not inherit a bare model from the wrong provider", () => {
    expect(resolveProviderModelPricing("openrouter", "deepseek-v4-flash").basis).toContain("Unpriced fallback");
    expect(resolveProviderModelPricing("openrouter", "mistral-large-3").basis).toContain("Unpriced fallback");
  });

  test("leaves subscription-only research previews unpriced", () => {
    expect(resolveProviderModelPricing("openai-codex", "gpt-5.3-codex-spark").basis).toContain("Unpriced fallback");
  });

  test("resolves current aliases without conflating GPT-5 Mini variants", () => {
    expect(resolveProviderModelPricing("openai-codex", "gpt-5-4-mini")).toMatchObject({
      canonicalModel: "GPT-5.4 Mini",
      inputPerMTok: 0.75,
      outputPerMTok: 4.5,
    });
    expect(resolveProviderModelPricing("openai-codex", "gpt-5-mini")).toMatchObject({
      canonicalModel: "GPT-5 Mini",
      inputPerMTok: 0.25,
      outputPerMTok: 2,
    });
  });

  test("resolves Opus 5 and Kimi K3 first-party and routed prices", () => {
    expect(resolveProviderModelPricing("anthropic", "claude-opus-5")).toMatchObject({
      canonicalModel: "Claude Opus 5",
      inputPerMTok: 5,
      outputPerMTok: 25,
      cacheReadPerMTok: 0.5,
      cacheWritePerMTok: 6.25,
    });
    expect(resolveProviderModelPricing("anthropic", "claude-opus-5-fast")).toMatchObject({
      canonicalModel: "Claude Opus 5 Fast",
      inputPerMTok: 10,
      outputPerMTok: 50,
      cacheReadPerMTok: 1,
      cacheWritePerMTok: 12.5,
    });
    expect(resolveProviderModelPricing("openrouter", "anthropic/claude-opus-5")).toMatchObject({
      canonicalModel: "Claude Opus 5 (OpenRouter)",
      inputPerMTok: 5,
      outputPerMTok: 25,
    });
    expect(resolveProviderModelPricing("moonshot", "kimi-k3")).toMatchObject({
      canonicalModel: "Kimi K3",
      inputPerMTok: 3,
      outputPerMTok: 15,
      cacheReadPerMTok: 0.3,
      cacheWritePerMTok: 3,
    });
    expect(resolveProviderModelPricing("openrouter", "moonshotai/kimi-k3")).toMatchObject({
      canonicalModel: "Kimi K3 (OpenRouter)",
      inputPerMTok: 3,
      outputPerMTok: 15,
      cacheReadPerMTok: 0.3,
    });
  });

  test("prices Fable successors and Astra without treating missing cache meters as free", () => {
    expect(resolveProviderModelPricing("anthropic", "claude-fable-5.1")).toMatchObject({ inputPerMTok: 10, outputPerMTok: 50, cacheReadPerMTok: 0.25, cacheWritePerMTok: 12.5 });
    expect(resolveProviderModelPricing("openrouter", "anthropic/claude-fable-5").cacheReadPerMTok).toBe(1);
    expect(resolveProviderModelPricing("github-copilot", "claude-fable-5.1").cacheReadPerMTok).toBe(0.25);
    expect(resolveProviderModelPricing("openai-codex", "gpt-6-astra")).toMatchObject({ inputPerMTok: 10, outputPerMTok: 50, cacheReadPerMTok: 1, cacheWritePerMTok: 12.5 });
    expect(resolveProviderModelPricing("openai", "gpt-5.4-pro").cacheReadPerMTok).toBe(30);
  });

  test("preserves the Sol route discount", () => {
    expect(resolveProviderModelPricing("github-copilot", "gpt-5.6-sol").inputPerMTok).toBe(4);
    expect(resolveProviderModelPricing("openrouter", "openai/gpt-5.6-sol").inputPerMTok).toBe(2);
    expect(resolveProviderModelPricing("openai-codex", "gpt-5.6-sol").outputPerMTok).toBe(20);
  });

  test("prices local inference at zero metered API cost", () => {
    expect(resolveProviderModelPricing("milkv-local", "gemma4-e4b-qat-mtp")).toMatchObject({
      inputPerMTok: 0,
      outputPerMTok: 0,
      cacheReadPerMTok: 0,
      cacheWritePerMTok: 0,
    });
  });
});
