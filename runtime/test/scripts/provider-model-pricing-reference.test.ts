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
      inputPerMTok: 0.15,
      cacheReadPerMTok: 0.003,
    });
    expect(resolveProviderModelPricing("openrouter", "deepseek/deepseek-v4-flash")).toMatchObject({
      canonicalModel: "DeepSeek V4 Flash (OpenRouter)",
      inputPerMTok: 0.049,
      outputPerMTok: 0.098,
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

  test("refreshes September 22 launches without assuming Copilot availability", () => {
    expect(resolveProviderModelPricing("openai", "gpt-6-sol")).toMatchObject({ inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2, cacheWritePerMTok: 2.5 });
    expect(resolveProviderModelPricing("openai", "gpt-6-luna")).toMatchObject({ inputPerMTok: 0.1, outputPerMTok: 0.5, cacheReadPerMTok: 0.01, cacheWritePerMTok: 0.125 });
    expect(resolveProviderModelPricing("github-copilot", "gpt-6-sol").basis).toContain("Unpriced");
    expect(resolveProviderModelPricing("anthropic", "claude-opus-5-5")).toMatchObject({ inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.2, cacheWritePerMTok: 5 });
    expect(resolveProviderModelPricing("anthropic", "claude-opus-5.5-fast")).toMatchObject({ inputPerMTok: 8, outputPerMTok: 40, cacheReadPerMTok: 0.4, cacheWritePerMTok: 10 });
    expect(resolveProviderModelPricing("github-copilot", "claude-sonnet-5")).toMatchObject({ inputPerMTok: 2, outputPerMTok: 10 });
    expect(resolveProviderModelPricing("anthropic", "claude-fable-5-1").cacheReadPerMTok).toBe(0.25);
  });

  test("preserves peer route differences and explicitly dated fallbacks", () => {
    expect(resolveProviderModelPricing("xai", "grok-4.5").cacheReadPerMTok).toBe(0.3);
    expect(resolveProviderModelPricing("github-copilot", "grok-4.5").cacheReadPerMTok).toBe(0.5);
    expect(resolveProviderModelPricing("google", "gemini-3.8-flash")).toMatchObject({ inputPerMTok: 0.75, outputPerMTok: 3.75 });
    expect(resolveProviderModelPricing("zai", "glm-5.3-flash")).toMatchObject({ inputPerMTok: 0.15, outputPerMTok: 0.5, cacheReadPerMTok: 0.03 });
    expect(resolveProviderModelPricing("groq", "openai/gpt-oss-120b")).toMatchObject({ inputPerMTok: 0.15, outputPerMTok: 0.6 });
    expect(resolveProviderModelPricing("moonshot", "kimi-k3").cacheWritePerMTok).toBe(3);
    expect(resolveProviderModelPricing("azure-foundry", "deepseek-v4-flash").notes).toContain("not reverified");
    expect(resolveProviderModelPricing("groq", "openai/gpt-oss-120b").notes).toContain("ordinary input fallback");
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
