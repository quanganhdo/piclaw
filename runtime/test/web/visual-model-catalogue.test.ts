import { expect, test } from "bun:test";

import { normaliseVisualModelPickerOptions } from "../../web/static/visual/frontend/src/components/model-context-bar/useModelPicker.ts";

test("visual model picker keeps shared normalized identity and current state for non-canonical backend labels", () => {
  const [entry] = normaliseVisualModelPickerOptions({
    current: "gpt-5",
    models: [],
    model_options: [{
      provider: "openai",
      id: "gpt-5",
      label: "gpt-5",
      name: "GPT-5",
      reasoning: true,
      pricing: { input_per_million: 1, output_per_million: 2 },
    }],
  } as any);

  expect(entry).toMatchObject({
    key: "openai/gpt-5",
    provider: "openai",
    id: "gpt-5",
    displayName: "GPT-5",
    current: true,
    reasoning: true,
    reasoningKnown: true,
    contextWindow: null,
    pricing: {
      inputPerMillion: 1,
      outputPerMillion: 2,
      cacheReadPerMillion: null,
      cacheWritePerMillion: null,
    },
  });
});

test("visual model picker marks reasoning metadata as unknown for legacy string payloads", () => {
  const [entry] = normaliseVisualModelPickerOptions({
    current: "openai/gpt-4.1",
    models: ["openai/gpt-4.1"],
    model_options: [],
  } as any);

  expect(entry).toMatchObject({
    key: "openai/gpt-4.1",
    provider: "openai",
    id: "gpt-4.1",
    displayName: "openai/gpt-4.1",
    current: true,
    reasoning: false,
    reasoningKnown: false,
    contextWindow: null,
    pricing: null,
  });
});
