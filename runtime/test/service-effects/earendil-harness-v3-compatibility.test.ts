import { describe, expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// @ts-expect-error -- 0.84.2 has no public v3 constructor contract.
import type { AgentHarnessConstructor } from "@earendil-works/pi-agent-core";
// @ts-expect-error -- 0.84.2 has only the non-generic Events registry.
import type { HarnessEventBus } from "@earendil-works/pi-agent-core";
// @ts-expect-error -- 0.84.2 has no public harness Storage contract.
import type { Storage } from "@earendil-works/pi-agent-core";
// @ts-expect-error -- 0.84.2 has no public harness Transaction contract.
import type { Transaction } from "@earendil-works/pi-agent-core";
// @ts-expect-error -- 0.84.2 has no public durable UsageRow contract.
import type { UsageRow } from "@earendil-works/pi-agent-core";
import type {
  AgentHarnessOptions,
  AgentHarnessTool,
  HarnessTool,
} from "@earendil-works/pi-agent-core";

import type { EarendilDirectAssignments } from "../../src/service-effects/earendil-harness-v3-compatibility/direct-assignments.js";
import {
  EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST,
  normalizeEarendilHarnessCompatibilityManifest,
} from "../../src/service-effects/earendil-harness-v3-compatibility/manifest.js";
import type { PiclawToolContext } from "../../src/service-effects/contracts/execution-context-resolver.js";
import {
  EARENDIL_HARNESS_DIRECT_OPERATIONS,
  readInstalledEarendilAgentCoreVersion,
  runEarendilHarnessDirectProbe,
} from "./fixtures/earendil-harness-direct-probe.js";

// @ts-expect-error -- released-v2 AgentHarnessOptions is deliberately non-generic.
type _UnsupportedContextualOptions = AgentHarnessOptions<PiclawToolContext>;
function _assignContextualToolToReleasedV2(tool: AgentHarnessTool<PiclawToolContext>): void {
  // @ts-expect-error -- contextual v3 tools are not released-v2 HarnessTool values.
  const releasedTool: HarnessTool = tool;
  void releasedTool;
}

type _CompileOnlyMissingExports = [AgentHarnessConstructor, HarnessEventBus, Storage, Transaction, UsageRow];
type _CompileOnlyDirectAssignments = EarendilDirectAssignments;

const compatibilityTestPath = fileURLToPath(import.meta.url);
const runtimeRoot = resolve(dirname(compatibilityTestPath), "../..");
const directAssignmentsPath = resolve(runtimeRoot, "src/service-effects/earendil-harness-v3-compatibility/direct-assignments.ts");
const tsconfigPath = resolve(runtimeRoot, "tsconfig.json");

function compilerOptions(): ts.CompilerOptions {
  const config = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, runtimeRoot, {
    noEmit: true,
    rootDir: runtimeRoot,
  }, tsconfigPath);
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("\n"));
  }
  return parsed.options;
}

function compileCompatibilitySource(source: string): readonly ts.Diagnostic[] {
  const options = compilerOptions();
  const host = ts.createCompilerHost(options, true);
  const readSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (resolve(fileName) === compatibilityTestPath) {
      return ts.createSourceFile(fileName, source, languageVersion, true, ts.ScriptKind.TS);
    }
    return readSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  };
  const program = ts.createProgram({ rootNames: [compatibilityTestPath, directAssignmentsPath], options, host });
  return ts.getPreEmitDiagnostics(program);
}

function earendilModuleSpecifiers(source: string): readonly string[] {
  const result: string[] = [];
  const sourceFile = ts.createSourceFile("compile-probe.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith("@earendil-works/")) {
      result.push(node.moduleSpecifier.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}

function expectDeepFrozen(value: unknown): void {
  if (!value || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

describe("latent Earendil Harness v3 compatibility evidence", () => {
  test("normalizes only the exact accepted closed manifest and deeply freezes it", () => {
    const normalized = normalizeEarendilHarnessCompatibilityManifest(EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST);
    expect(normalized.ok).toBe(true);
    expect(normalized.issues).toEqual([]);
    if (!normalized.ok) throw new Error("Expected the accepted manifest to normalize.");
    expect(normalized.value).toEqual(EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST);
    expectDeepFrozen(normalized.value);

    expect(normalized.value.authority).toEqual({
      currentRuntimeVersion: "0.84.2",
      harnessBaselineVersion: "0.84.1",
      harnessCandidateVersion: "0.84.2",
      harnessCandidateSelection: "rejected_evidence_only",
      unsupportedCountsAsPass: false,
      harnessActivation: "latent_only",
      designCommit: "5f7195c51eac43cdf329f813a7ef020d7bd74527",
      draftEvidenceCommit: "fd389abc4677b4e0fa5dc9b2bbd2e63418f079b4",
    });
    expect(normalized.value.releases.map((release) => [
      release.tag,
      release.commit,
      release.runtimeSelection,
      release.harnessSelection,
    ])).toEqual([
      ["v0.84.1", "53fa77ccd8a279eb87e92294ef3687b03ff80112", "historical", "baseline_evidence"],
      ["v0.84.2", "914cf1472e715297caa30db4b9535d534a9eb718", "installed", "rejected_evidence_only"],
    ]);
  });

  test("rejects mutation, corruption, accessors, symbols, cycles, and hostile reflection", () => {
    const drifted = structuredClone(EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST);
    Object.defineProperty(drifted.authority, "currentRuntimeVersion", { value: "0.84.9", enumerable: true });
    const driftResult = normalizeEarendilHarnessCompatibilityManifest(drifted);
    expect(driftResult.ok).toBe(false);
    expect(driftResult.issues[0]?.code).toBe("manifest_drift");

    const widened = structuredClone(EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST);
    Object.defineProperty(widened, "unexpected", { value: true, enumerable: true });
    const widenedResult = normalizeEarendilHarnessCompatibilityManifest(widened);
    expect(widenedResult.ok).toBe(false);
    expect(widenedResult.issues[0]?.code).toBe("closed_shape_mismatch");

    let getterCalls = 0;
    const accessor = Object.defineProperty({}, "schemaVersion", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 1;
      },
    });
    const accessorResult = normalizeEarendilHarnessCompatibilityManifest(accessor);
    expect(accessorResult.ok).toBe(false);
    expect(accessorResult.issues[0]?.code).toBe("accessor_rejected");
    expect(getterCalls).toBe(0);

    const symbol = Object.defineProperty(structuredClone(EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST), Symbol("drift"), {
      value: true,
    });
    expect(normalizeEarendilHarnessCompatibilityManifest(symbol).issues[0]?.code).toBe("symbol_rejected");

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(normalizeEarendilHarnessCompatibilityManifest(cyclic).issues[0]?.code).toBe("cycle_rejected");

    const hostile = new Proxy({}, {
      ownKeys() {
        throw new Error("hostile reflection");
      },
    });
    expect(normalizeEarendilHarnessCompatibilityManifest(hostile).issues[0]?.code).toBe("invalid_container");
  });

  test("keeps every HC row explicitly unsupported and every operation backed by the direct probe catalogue", () => {
    const manifest = EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST;
    expect(manifest.capabilities.map((capability) => capability.id).join(",")).toBe(
      Array.from({ length: 20 }, (_, index) => `HC-${String(index + 1).padStart(3, "0")}`).join(","),
    );
    expect(manifest.capabilities.every((capability) => capability.status === "unsupported")).toBe(true);
    expect(manifest.capabilities.every((capability) => capability.requirement.length >= 40)).toBe(true);
    expect(manifest.capabilities.map((capability) => capability.requirement)).toHaveLength(20);
    expect(manifest.capabilities.map((capability) => capability.status)).not.toContain("pass");
    expect(manifest.authority.unsupportedCountsAsPass).toBe(false);

    const directOperations = new Set<string>(EARENDIL_HARNESS_DIRECT_OPERATIONS);
    for (const capability of manifest.capabilities) {
      for (const operation of capability.operations) expect(directOperations.has(operation)).toBe(true);
    }
    expect(manifest.boundaries.map((boundary) => [boundary.id, boundary.compileStatus, boundary.runtimeStatus])).toEqual([
      ["EB-01", "pass", "unsupported"],
      ["EB-02", "fail", "unsupported"],
      ["EB-03", "fail", "unsupported"],
      ["EB-04", "pass", "unsupported"],
      ["EB-05", "fail", "unsupported"],
    ]);
  });

  test("CI-compiles the direct assignments and exactly seven negative incompatibilities", async () => {
    const source = await Bun.file(compatibilityTestPath).text();
    const directAssignments = await Bun.file(directAssignmentsPath).text();
    const directives = source.match(/^\s*\/\/ @ts-expect-error -- .*$/gm) ?? [];
    expect(directives).toHaveLength(7);
    expect(compileCompatibilitySource(source)).toEqual([]);

    const exposedSource = source.replace(/^\s*\/\/ @ts-expect-error -- .*$/gm, "// expected incompatibility exposed");
    const diagnostics = compileCompatibilitySource(exposedSource);
    const expected = [
      [2305, "AgentHarnessConstructor"],
      [2305, "HarnessEventBus"],
      [2305, "Storage"],
      [2305, "Transaction"],
      [2305, "UsageRow"],
      [2315, "AgentHarnessOptions"],
      [2322, "AgentHarnessTool<PiclawToolContext>"],
    ] as const;
    expect(diagnostics).toHaveLength(expected.length);
    for (const [index, diagnostic] of diagnostics.entries()) {
      const [code, marker] = expected[index];
      expect(diagnostic.code).toBe(code);
      expect(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).toContain(marker);
    }

    const specifiers = earendilModuleSpecifiers(`${source}\n${directAssignments}`);
    expect([...new Set(specifiers)].sort()).toEqual([
      "@earendil-works/pi-agent-core",
      "@earendil-works/pi-ai",
      "@earendil-works/pi-coding-agent",
    ]);
    expect(specifiers.every((specifier) => !specifier.includes("/dist/") && !specifier.includes("/src/"))).toBe(true);
  });

  test("resolves the package-root public package.json export to the selected 0.84.2 current runtime", async () => {
    expect(await readInstalledEarendilAgentCoreVersion()).toBe("0.84.2");
  });

  test("observes the 25 exact public HarnessNotImplemented outcomes without converting them to passes", async () => {
    const rows = await runEarendilHarnessDirectProbe();
    expect(rows.map((row) => row.operation)).toEqual([...EARENDIL_HARNESS_DIRECT_OPERATIONS]);
    expect(rows).toHaveLength(25);
    for (const row of rows) {
      expect(row).toEqual({
        operation: row.operation,
        status: "unsupported",
        reportedOperation: row.operation,
        errorName: "HarnessNotImplemented",
      });
    }
  });
});
