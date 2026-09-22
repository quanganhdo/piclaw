import { expect, test } from "bun:test";
import {
  mergeModelStatePayload,
  resolveModelStateUpdate,
} from "../../web/src/ui/app-model-state";
const known = {
  current: "test/one",
  thinking_level: "high",
  thinking_level_label: "High",
  supports_thinking: true,
  model_options: [{ id: "test/one", context_window: 10000 }],
  provider_usage: { provider: "test" },
};
test("partial updates preserve same-model thinking/capability and absent sections preserve metadata", () => {
  expect(mergeModelStatePayload(known, null)).toBe(known);
  expect(
    mergeModelStatePayload(known, {
      provider_usage: { provider: "test", hint_short: "new" },
    }),
  ).toMatchObject({
    current: "test/one",
    thinking_level: "high",
    supports_thinking: true,
  });
  expect(mergeModelStatePayload(known, { current: "test/one" })).toMatchObject({
    thinking_level: "high",
    supports_thinking: true,
  });
  expect(
    resolveModelStateUpdate({ thinking_level_label: "Maximum" }),
  ).toMatchObject({ hasThinkingLevel: true, thinkingLevelLabel: "Maximum" });
});
test("new model clears model-specific fields until the new snapshot supplies them", () => {
  const next = mergeModelStatePayload(known, { model: "test/two" });
  expect(next).toMatchObject({
    current: "test/two",
    thinking_level: null,
    thinking_level_label: null,
    supports_thinking: false,
    model_options: [],
    provider_usage: null,
  });
  expect(mergeModelStatePayload(known, { current: null })).toMatchObject({
    current: null,
    thinking_level: null,
    model_options: [],
  });
});
test("raw thinking changes cannot retain an old formatted label; explicit off and clears survive", () => {
  expect(
    mergeModelStatePayload(known, { thinking_level: "off" }),
  ).toMatchObject({ thinking_level: "off", thinking_level_label: "off" });
  expect(mergeModelStatePayload(known, { thinking_level: null })).toMatchObject(
    { thinking_level: null, thinking_level_label: null },
  );
  expect(
    mergeModelStatePayload(known, { thinking_level_label: "Maximum" }),
  ).toMatchObject({ thinking_level: "high", thinking_level_label: "Maximum" });
});
