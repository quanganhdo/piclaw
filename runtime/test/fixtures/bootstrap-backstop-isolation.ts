import { expect, test } from "bun:test";

// Accelerate only a leaked process backstop, not ordinary fixture deadlines.
// Test-owned inert placeholder timers retain their normal teardown semantics.
const nativeSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = ((run: TimerHandler, ms?: number, ...args: unknown[]) =>
  nativeSetTimeout(run, ms === 15_000 ? 25 : ms, ...args)) as typeof setTimeout;
await import("../runtime/bootstrap.test.js");

test("bootstrap fixtures survive process-backstop teardown", async () => {
  await Bun.sleep(100);
  expect(true).toBe(true);
  console.log("PICLAW_BOOTSTRAP_SUITE_COMPLETED");
});
