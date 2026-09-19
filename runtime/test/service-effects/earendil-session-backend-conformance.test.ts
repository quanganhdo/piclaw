import { describe, expect, test } from "bun:test";

import {
  createSessionRepoConformance,
  createSessionRepoForkBehaviorConformance,
  createSessionRepoForkSourceSnapshotConformance,
  createSessionRepoLifecycleConformance,
  createSessionRepoMessageConformance,
  createSessionRepoOwnershipConformance,
  type ConformanceCase,
} from "@earendil-works/pi-agent-core/harness/session/testing";

import {
  createEarendilJsonlSessionFixture,
  createEarendilMemorySessionFixture,
} from "./fixtures/earendil-session-backend-fixtures.js";

const HISTORICAL_0_84_COUNTS = {
  casesPerBackend: 30,
  backendExecutions: 60,
} as const;

const EXPECTED_CURRENT_CATALOG_IDS = [
  "fork coordination / captures one coherent boundary between source commits",
  "fork coordination / publishes create when it reserves a shared destination id first",
  "fork coordination / publishes fork when it reserves a shared destination id first",
  "forks / enforces branch ancestry for at and before placement",
  "forks / forks a closed source session",
  "forks / forks one named configured branch with scoped values and a zero ledger",
  "forks / forks the whole configured tree with fresh lane state",
  "forks / rejects a data-only branch and releases its destination id",
  "forks / rejects only surviving unknown reserved scalar state",
  "forks / tree-forks a fresh session before first attachment",
  "lifecycle / close drains an acquired scope and rejects a queued mutation callback",
  "lifecycle / creates a session with no implicit branch and rejects duplicate ids",
  "lifecycle / deletes closed sessions without affecting other sessions",
  "lifecycle / lists metadata and preserves state across close and reopen",
  "messages / preserves every settled assistant stop reason",
  "messages / rejects pending assistant messages without changing the tree",
  "ownership / rejects opening an already-open session",
] as const;

// Direct Storage conformance is not admitted: the public release exports the suite
// and Storage type, but not MemoryStorage/JsonlStorage constructors. Reaching through
// Session private fields would invalidate public-boundary evidence.

const memoryFixture = createEarendilMemorySessionFixture();
const jsonlFixture = createEarendilJsonlSessionFixture();
const memoryCases = createSessionRepoConformance(memoryFixture.createRepository, memoryFixture.closeRepository);
// Exact suite used by d981de1 packages/agent/test/harness/jsonl-session-repo-conformance.test.ts.
const jsonlCases = [
  ...createSessionRepoLifecycleConformance(jsonlFixture.createRepository, jsonlFixture.closeRepository),
  ...createSessionRepoOwnershipConformance(jsonlFixture.createRepository, jsonlFixture.closeRepository),
  ...createSessionRepoMessageConformance(jsonlFixture.createRepository, jsonlFixture.closeRepository),
  ...createSessionRepoForkBehaviorConformance(jsonlFixture.createRepository, jsonlFixture.closeRepository),
  ...createSessionRepoForkSourceSnapshotConformance(jsonlFixture.createRepository, jsonlFixture.closeRepository),
];
const BACKENDS = [["Memory", memoryCases], ["JSONL", jsonlCases]] as const;
const caseId = (c: ConformanceCase) => c.group + " / " + c.name;
const ids = [...new Set(BACKENDS.flatMap(([, cases]) => cases.map(caseId)))].sort();
let completed = 0;
describe("Earendil 0.85.1 public repository conformance", () => {
  test("HC-024/025 pins public SessionRepo scope and rejects raw Storage/SQLite promotion", async () => {
    const root = await import("@earendil-works/pi-agent-core");
    const session = await import("@earendil-works/pi-agent-core/harness/session");
    const testing = await import("@earendil-works/pi-agent-core/harness/session/testing");
    expect("MemoryStorage" in root).toBeFalse();
    expect("JsonlStorage" in root).toBeFalse();
    expect("MemoryStorage" in session).toBeFalse();
    expect("JsonlStorage" in session).toBeFalse();
    expect(typeof testing.createStorageConformance).toBe("function");
    expect(Object.keys(testing).some((name) => /StorageFixture|createMemoryStorage|createJsonlStorage/.test(name))).toBeFalse();
  });

  test("HC-025 pins selected repository catalogue separately from historical counts", () => {
    expect(HISTORICAL_0_84_COUNTS).toEqual({ casesPerBackend: 30, backendExecutions: 60 });
    expect(ids).toEqual(EXPECTED_CURRENT_CATALOG_IDS);
    expect(memoryCases).toHaveLength(17);
    expect(jsonlCases).toHaveLength(15);
  });
  for (const [backend, cases] of BACKENDS) describe(backend, () => {
    for (const c of cases) test(caseId(c), async () => { await c.run(); completed++; });
  });
  test("executed every selected repository case", () => { expect(completed).toBe(32); });
});
