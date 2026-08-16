import "./terminal-settlement-schema-composition.test.js";
import "./terminal-settlement-lookup.test.js";
import "./terminal-settlement-atomicity-races.test.js";
import "./terminal-settlement-authority-fts.test.js";
import "./terminal-settlement-concurrency-corruption.test.js";
import "./terminal-settlement-payload-redaction.test.js";
import "./terminal-settlement-import-boundary.test.js";

import { describe, test } from "bun:test";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { defineTerminalSettlementStoreContract } from "../../src/service-effects/testing/contract-suites/terminal-settlement-store-contract.js";
import { context, fakeFactory, sqliteFactory } from "./terminal-settlement-test-support.js";

describe("EF-S02 TerminalSettlementStore shared contract", () => {
  // This aggregate runs 23 contract/recovery cases with repeated private-schema creation and fresh SQLite restores.
  test("isolated SQLite adapter", async () => {
    const before = readdirSync(tmpdir())
      .filter((name) => name.startsWith("piclaw-s02-"))
      .sort();
    await defineTerminalSettlementStoreContract(sqliteFactory, context);
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
