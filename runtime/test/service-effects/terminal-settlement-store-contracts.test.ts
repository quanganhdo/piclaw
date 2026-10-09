import "./terminal-settlement-schema-composition.test.js";
import "./terminal-settlement-lookup.test.js";
import "./terminal-settlement-atomicity-races.test.js";
import "./terminal-settlement-authority-fts.test.js";
import "./terminal-settlement-concurrency-corruption.test.js";
import "./terminal-settlement-payload-redaction.test.js";
import "./terminal-settlement-import-boundary.test.js";

import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { defineTerminalSettlementStoreContract, TERMINAL_SETTLEMENT_CONTRACT_CASE_NAMES } from "../../src/service-effects/testing/contract-suites/terminal-settlement-store-contract.js";
import { context, fakeFactory, sqliteFactory } from "./terminal-settlement-test-support.js";

describe("EF-S02 TerminalSettlementStore shared contract", () => {
  // Each independent contract keeps its assertions and fresh subject/restore.
  // A single aggregate deadline must not hide which case exhausted its bound.
  for (const caseName of TERMINAL_SETTLEMENT_CONTRACT_CASE_NAMES) test(`isolated SQLite adapter: ${caseName}`, async () => {
    const before = readdirSync(tmpdir())
      .filter((name) => name.startsWith("piclaw-s02-"))
      .sort();
    const result = await defineTerminalSettlementStoreContract(sqliteFactory, context, caseName);
    expect(result).toHaveLength(1);
    expect(result[0].caseName).toBe(caseName);
    const after = readdirSync(tmpdir())
      .filter((name) => name.startsWith("piclaw-s02-"))
      .sort();
    if (JSON.stringify(after) !== JSON.stringify(before)) {
      throw new Error("EF-S02 SQLite contract leaked a temporary database.");
    }
  }, 15_000);

  test("independent deterministic fake", async () => {
    await defineTerminalSettlementStoreContract(fakeFactory, context);
  });
});
