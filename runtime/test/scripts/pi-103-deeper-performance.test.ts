import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const receipt = JSON.parse(readFileSync(resolve(root, "docs/development/receipts/pi-103-deeper-performance.json"), "utf8"));
const text = readFileSync(resolve(root, "docs/development/pi-103-deeper-performance.md"), "utf8");

test("deeper performance evidence preserves scoped success and unqualified comparison provenance", () => {
  expect(receipt.target.pi).toBe("1.0.3");
  expect(receipt.scope).toMatchObject({ productionDatabase: false, liveCredentials: false, inference: false, restart: false, deployment: false, wholeSystemPerformanceAcceptance: false, productionDelegateActivated: false });
  expect(receipt.workloads).toHaveLength(4);
  for (const row of receipt.workloads) {
    expect(row.plainRuns).toBe(3);
    expect(row.cpuRuns).toBe(1);
    expect(row.logHashes).toHaveLength(4);
    for (const log of row.logHashes) {
      expect(log.exit).toBe(0);
      expect(log.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  }
  expect(receipt.sourceBinding.before).toEqual(receipt.sourceBinding.after);
  expect(receipt.comparisonBinding.executionTimeSourceCaptured).toBe(false);
  for (const row of receipt.comparisons) {
    expect(row.ackMs).toBeUndefined();
    expect(row.contentionBatchMs.min).toBeGreaterThan(0);
    expect(row.responseStatus).toBe(row.mode === "release" ? 201 : 403);
  }
  expect(receipt.failures.every((row: { qualifying: boolean }) => row.qualifying === false)).toBe(true);
  for (const phrase of ["execution-time source", "explicit GC", "synthetic", "postcommit", "separate permission"]) expect(text).toContain(phrase);
});
