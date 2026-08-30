import { expect, test } from "bun:test";

import { refreshAgentModelStateBestEffort } from "../../web/src/components/compose-model-refresh.js";

test("refreshAgentModelStateBestEffort emits latest model state when refresh succeeds", async () => {
  const emitted: unknown[] = [];

  await expect(refreshAgentModelStateBestEffort(async (chatJid: string) => ({ chatJid, model: "gpt-4.1" }), "web:default", (state) => emitted.push(state))).resolves.toBe(true);
  expect(emitted).toEqual([{ chatJid: "web:default", model: "gpt-4.1" }]);
});

test("refreshAgentModelStateBestEffort exposes the confirmed payload after emitting it", async () => {
  const confirmed: unknown[] = [];
  await expect(refreshAgentModelStateBestEffort(
    async () => ({ current: "openai/gpt-5" }),
    "web:default",
    () => {},
    (state) => confirmed.push(state),
  )).resolves.toBe(true);
  expect(confirmed).toEqual([{ current: "openai/gpt-5" }]);
});

test("refreshAgentModelStateBestEffort tolerates failed background refreshes", async () => {
  const emitted: unknown[] = [];

  await expect(refreshAgentModelStateBestEffort(async () => { throw new Error("offline"); }, "web:default", (state) => emitted.push(state))).resolves.toBe(false);
  await expect(refreshAgentModelStateBestEffort(async () => null, "web:default", (state) => emitted.push(state))).resolves.toBe(false);
  expect(emitted).toEqual([]);
});
