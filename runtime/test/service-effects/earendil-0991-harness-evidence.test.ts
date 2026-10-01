import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@earendil-works/pi-agent-core";
import * as session from "@earendil-works/pi-agent-core/harness/session";
import * as testing from "@earendil-works/pi-agent-core/harness/session/testing";
import { createSessionRepoStreamingForkConformance } from "@earendil-works/pi-agent-core/harness/session/testing";
import { EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST as manifest } from "../../src/service-effects/earendil-harness-v3-compatibility/manifest.js";
import { createSelectedHarnessFixture } from "./fixtures/earendil-harness-direct-probe.js";
import { createEarendilJsonlSessionFixture, createEarendilMemorySessionFixture } from "./fixtures/earendil-session-backend-fixtures.js";

const packageRoot = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-agent-core/package.json")));
const repositoryRoot = resolve(import.meta.dir, "../../..");
const current = manifest.currentRuntime;
const caseId = (entry: { group: string; name: string }) => `${entry.group} / ${entry.name}`;
const memory = createEarendilMemorySessionFixture(), jsonl = createEarendilJsonlSessionFixture();
const backends = [
  ["Memory", createSessionRepoStreamingForkConformance(memory.createRepository, memory.closeRepository)],
  ["JSONL", createSessionRepoStreamingForkConformance(jsonl.createRepository, jsonl.closeRepository)],
] as const;
const expectedIds = [
  ...["closed", "open"].flatMap(state => [
    `branch fork application state (${state} source) / excludes deleted/reappended and untouched application lists`,
    `branch fork application state (${state} source) / excludes overwritten and unchanged application values`,
    ...["asc", "desc"].map(order => `fork application lists (${state} source) / tree fork continues ${order} pagination using source cursors`),
    `fork application lists (${state} source) / tree fork copies lists at distinct addresses`,
    `fork application lists (${state} source) / tree fork copies only survivors after list deletion and reappend`,
    `fork application lists (${state} source) / tree fork preserves list element sequences including gaps`,
  ]),
  "fork lane validation / ignores malformed unrelated lanes",
].sort();
const completed = new Map<string, string[]>();

describe("exact 0.99.1 inactive Harness assessment", () => {
  test("pins separate runtime/declaration fingerprints and retains historical versions", () => {
    const installed = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
    const publication = JSON.parse(readFileSync(resolve(repositoryRoot, "runtime/test/fixtures/earendil-package-admission/registry-0.99.1.json"), "utf8")) as Array<{ name: string; version: string; gitHead: string }>;
    const receipt = publication.find(entry => entry.name === installed.name);
    expect(installed.version).toBe(current.version);
    expect(current.commit).toBe("d86654abb8862e201933517d6f1fce9f88dd117f");
    expect(receipt).toMatchObject({ version: current.version, gitHead: current.commit });
    expect(manifest.selected.version).toBe("0.87.1");
    expect(manifest.publishedCandidate.version).toBe("0.87.0");
    expect(current.fingerprints).toHaveLength(10);
    for (const fingerprint of current.fingerprints) {
      expect(createHash("sha256").update(readFileSync(resolve(packageRoot, fingerprint.path))).digest("hex"), fingerprint.path).toBe(fingerprint.sha256);
    }
    expect(current.capabilities).toHaveLength(25);
    expect(current.capabilities.map(row => [row.id, row.status])).toEqual(manifest.selected.capabilities.map(row => [row.id, row.status]));
    expect(current.productionImport).toBe(false);
    expect(current.productionActivation).toBe(false);
    expect(manifest.authority.harnessActivation).toBe("latent_only");
    expect(manifest.schemaVersion).toBe(6);
    expect(manifest.authority.currentRuntimeVersion).toBe(current.version);
    // JSON digests captured independently from the pre-assessment e27f6401f baseline.
    for (const [key, sha256] of [
      ["historical", "94fb0c7f294e7a710dc176a23e2e9014bdcf1f4c590173d825a65f3a497cfbe4"],
      ["selected", "5d1d5f861964673d0979db1e8bb56f62fe5291f02b21087873724080e564e823"],
      ["publishedCandidate", "15fb83ff90bf330df28efe37bb252f400c6ed325e664c2901c6c762a6d1581e1"],
      ["experimentalPico3", "1ede405a32b24ae4ed6631dc922fd528420515951ab7b500493d91b610ef3c88"],
    ] as const) expect(createHash("sha256").update(JSON.stringify(manifest[key])).digest("hex"), key).toBe(sha256);
  });

  test("watchSession executes the public stub and HC-024 admits no raw Storage", async () => {
    const fixture = await createSelectedHarnessFixture();
    try {
      await expect(fixture.harness.watchSession(fixture.context)).rejects.toMatchObject({
        name: "SliceNotImplemented",
        message: "watchSession is not implemented until its later AgentHarness slice",
      });
      expect(fixture.faux.state.callCount).toBe(0);
      for (const exported of [core, session]) {
        expect("MemoryStorage" in exported).toBe(false);
        expect("JsonlStorage" in exported).toBe(false);
      }
    } finally {
      await fixture.harness.close(fixture.context);
      await fixture.repo.close(fixture.context);
    }
  });

  test("public-only standalone consumer executes the same catalogue under Bun", async () => {
    const probe = resolve(import.meta.dir, "fixtures/earendil-0991-public-probe.mjs");
    const child = Bun.spawn([process.execPath, probe], {
      cwd: repositoryRoot,
      env: { PATH: "/usr/local/lib/bun/bin:/usr/bin:/bin", HOME: "/nonexistent", PI_OFFLINE: "1", PI_TELEMETRY: "0", OTEL_SDK_DISABLED: "true" },
      stdout: "pipe", stderr: "pipe",
    });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
    try {
      const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(stderr).toBe("");
      expect(exit).toBe(0);
      const receipt = JSON.parse(stdout);
      expect(receipt).toMatchObject({ version: "0.99.1", rawStorageConstructors: false, providerExecution: "no_provider_constructed_by_probe", productionActivation: false });
      expect(receipt.exports).toEqual({ root: Object.keys(core).sort(), session: Object.keys(session).sort(), testing: Object.keys(testing).sort() });
      expect(receipt.streamingFork).toMatchObject({ uniqueCases: 15, backendExecutions: 30 });
      expect(receipt.streamingFork.backends.map((backend: { backend: string }) => backend.backend)).toEqual(["Memory", "JSONL"]);
      for (const backend of receipt.streamingFork.backends) expect(backend.caseIds).toEqual(expectedIds);
    } finally { clearTimeout(timeout); }
  }, 15_000);

  test("freezes 15 unique streaming-fork cases independently of 30 backend executions", () => {
    expect(new Set(backends.flatMap(([, cases]) => cases.map(caseId))).size).toBe(15);
    for (const [, cases] of backends) expect(cases.map(caseId).sort()).toEqual(expectedIds);
    expect(current.streamingForkConformance).toEqual({ uniqueCases: 15, memoryExecutions: 15, jsonlExecutions: 15 });
    expect(current.repositoryConformance).toEqual({ uniqueCases: 17, memoryExecutions: 17, jsonlExecutions: 15 });
  });

  test("archived real Node and Bun receipts match the executed catalogue and public exports", () => {
    const catalogueSha256 = createHash("sha256").update(JSON.stringify(expectedIds)).digest("hex");
    for (const runtime of ["node", "bun"]) {
      const path = resolve(repositoryRoot, `docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-0991-harness-${runtime}.json`);
      const receipt = JSON.parse(readFileSync(path, "utf8"));
      expect(receipt.version).toBe(current.version);
      expect(receipt.runtime).toMatch(runtime === "node" ? /^Node / : /^Bun /);
      expect(receipt.exports.root).toEqual(Object.keys(core).sort());
      expect(receipt.exports.session).toEqual(Object.keys(session).sort());
      expect(receipt.exports.testing).toEqual(Object.keys(testing).sort());
      expect(receipt.streamingFork).toMatchObject({ uniqueCases: 15, backendExecutions: 30, catalogueSha256 });
      expect(receipt.streamingFork.backends.map((backend: { backend: string }) => backend.backend)).toEqual(["Memory", "JSONL"]);
      expect(receipt.streamingFork.backends.reduce((total: number, backend: { executions: number }) => total + backend.executions, 0)).toBe(30);
      for (const backend of receipt.streamingFork.backends) {
        expect(backend.executions).toBe(15);
        expect(backend.caseIds).toEqual(expectedIds);
      }
      expect(receipt.rawStorageConstructors).toBe(false);
      expect(receipt.providerExecution).toBe("no_provider_constructed_by_probe");
      expect(receipt.productionActivation).toBe(false);
    }
  });

  for (const [backend, cases] of backends) describe(backend, () => {
    for (const entry of cases) test(caseId(entry), async () => {
      await entry.run();
      const executions = completed.get(backend) ?? [];
      executions.push(caseId(entry));
      completed.set(backend, executions);
    });
  });

  test("executes every backend case and retains SQLite/host authority limits", () => {
    for (const [backend] of backends) expect(completed.get(backend)?.sort()).toEqual(expectedIds);
    expect(current.sqlite).toBe("streaming_fork_support_pending");
    expect(current.hostOwnership).toBe("cross_process_authority_unproved");
    expect(current.serviceEffectAuthority).toBe("retained_piclaw");
  });
});
