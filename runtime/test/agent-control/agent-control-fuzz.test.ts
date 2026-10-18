import { expect, test } from "bun:test";

import { DEFAULT_FUZZ_SEED, DEFAULT_FUZZ_TEST_ARTIFACT_DIR, runAgentControlFuzzAudit } from "./fuzz-audit.js";

test("agent-control fuzz audit stays replayable and gap-free for the canonical seed", async () => {
  const summary = await runAgentControlFuzzAudit({
    seed: DEFAULT_FUZZ_SEED,
    iterations: 64,
    artifactDir: DEFAULT_FUZZ_TEST_ARTIFACT_DIR,
  });

  expect(summary.fuzz_gap_count).toBe(0);
  expect(summary.unhandled_exceptions).toBe(0);
  expect(summary.typed_failure_mismatches).toBe(0);
  expect(summary.routing_invariant_failures).toBe(0);
  expect(summary.idempotence_failures).toBe(0);
  expect(summary.artifact_outputs_present).toBe(1);
  expect(summary.summaryPath).toContain(DEFAULT_FUZZ_TEST_ARTIFACT_DIR);
// 64 replayable cases include runtime startup and filesystem receipts; the
// loaded current gate exceeded Bun's implicit 5s, not an individual case bound.
}, 30_000);
