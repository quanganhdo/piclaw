import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as syntax from "@babel/types";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AgentHarnessConstructor, AgentHarnessOptions, AgentHarnessTool,
  Events, Storage, SessionMutation, UsageRow,
} from "@earendil-works/pi-agent-core";
import type { EarendilDirectAssignments } from "../../src/service-effects/earendil-harness-v3-compatibility/direct-assignments.js";
import {
  EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST,
  normalizeEarendilHarnessCompatibilityManifest,
} from "../../src/service-effects/earendil-harness-v3-compatibility/manifest.js";
import type { PiclawToolContext } from "../../src/service-effects/contracts/execution-context-resolver.js";
import { ensureTypeScriptCompilerExecutable } from "../../scripts/repo-dev-command.js";
import {
  collectModuleSpecifiers,
  forEachSyntaxChild,
  literalString,
  parseTypeScriptSource,
  propertyKeyName,
  syntaxText,
} from "./fixtures/typescript-syntax-oracle.js";
import {
  EARENDIL_HARNESS_DIRECT_OPERATIONS,
  readInstalledEarendilAgentCoreVersion,
} from "./fixtures/earendil-harness-direct-probe.js";
import { SELECTED_HARNESS_EVIDENCE_LINKS } from "./fixtures/earendil-harness-selected-catalogue.js";

type _PublicSelectedContracts = [AgentHarnessConstructor, Events, Storage, SessionMutation, UsageRow, AgentHarnessOptions<PiclawToolContext>, AgentHarnessTool<PiclawToolContext>];
type _CompileOnlyDirectAssignments = EarendilDirectAssignments;

const compatibilityTestPath = fileURLToPath(import.meta.url);
const runtimeRoot = resolve(dirname(compatibilityTestPath), "../..");
const directAssignmentsPath = resolve(runtimeRoot, "src/service-effects/earendil-harness-v3-compatibility/direct-assignments.ts");
const tsconfigPath = resolve(runtimeRoot, "tsconfig.json");
const tscPath = resolve(runtimeRoot, "../node_modules/typescript/bin/tsc");

interface CompilerDiagnostic {
  readonly code: number;
  readonly message: string;
}

function compileCompatibilitySource(source: string): readonly CompilerDiagnostic[] {
  const directory = dirname(compatibilityTestPath);
  const suffix = `${process.pid}-${crypto.randomUUID()}`;
  const probePath = resolve(directory, `.earendil-compatibility-${suffix}.ts`);
  const configPath = resolve(directory, `.earendil-compatibility-${suffix}.json`);
  const localPath = (path: string): string => relative(directory, path).replaceAll("\\", "/");
  try {
    writeFileSync(probePath, source);
    writeFileSync(configPath, `${JSON.stringify({
      extends: localPath(tsconfigPath),
      compilerOptions: { noEmit: true, rootDir: localPath(runtimeRoot) },
      files: [basename(probePath), localPath(directAssignmentsPath)],
    })}\n`);
    ensureTypeScriptCompilerExecutable(resolve(runtimeRoot, ".."));
    const compiler = Bun.spawnSync([process.execPath, tscPath, "--project", configPath, "--pretty", "false"], {
      cwd: runtimeRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = `${compiler.stdout.toString()}\n${compiler.stderr.toString()}`;
    const diagnostics = [...output.matchAll(/error TS(\d+): ([^\r\n]+)/g)].map((match) => Object.freeze({
      code: Number(match[1]),
      message: match[2],
    }));
    if (compiler.exitCode !== 0 && diagnostics.length === 0) {
      throw new Error(`TypeScript compatibility probe exited ${compiler.exitCode}: ${output.trim()}`);
    }
    return Object.freeze(diagnostics);
  } finally {
    rmSync(probePath, { force: true });
    rmSync(configPath, { force: true });
  }
}

function earendilModuleSpecifiers(source: string): readonly string[] {
  return collectModuleSpecifiers("compile-probe.ts", source).filter((specifier) => specifier.startsWith("@earendil-works/"));
}

function expectDeepFrozen(value: unknown): void {
  if (!value || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

function activeTestNames(path: string, source: string): readonly string[] {
  const parsed = parseTypeScriptSource(path, source);
  const names: string[] = [];
  type RegistrationRoot = "describe" | "it" | "test";
  interface RegistrationModifier {
    readonly name: string;
    readonly arguments?: syntax.CallExpression["arguments"];
  }
  interface RegistrationChain {
    readonly root: RegistrationRoot;
    readonly modifiers: readonly RegistrationModifier[];
  }
  const registrationChain = (node: syntax.Node | null | undefined): RegistrationChain | null => {
    if (syntax.isIdentifier(node) && (node.name === "test" || node.name === "it" || node.name === "describe")) {
      return { root: node.name, modifiers: [] };
    }
    if (syntax.isMemberExpression(node) && !node.computed) {
      const chain = registrationChain(node.object);
      const name = propertyKeyName(node.property);
      return chain && name ? { ...chain, modifiers: [...chain.modifiers, { name }] } : null;
    }
    if (syntax.isCallExpression(node)) {
      const chain = registrationChain(node.callee);
      if (!chain || chain.modifiers.length === 0) return chain;
      const modifiers = [...chain.modifiers];
      const last = modifiers.at(-1);
      if (!last || last.arguments) throw new SyntaxError(`Ambiguous registration modifier call: ${path}`);
      modifiers[modifiers.length - 1] = { ...last, arguments: node.arguments };
      return { ...chain, modifiers };
    }
    if (syntax.isTaggedTemplateExpression(node)) {
      const chain = registrationChain(node.tag);
      if (!chain || chain.modifiers.length === 0) return chain;
      const modifiers = [...chain.modifiers];
      const last = modifiers.at(-1);
      if (!last || last.arguments) throw new SyntaxError(`Ambiguous registration modifier template: ${path}`);
      modifiers[modifiers.length - 1] = { ...last, arguments: [] };
      return { ...chain, modifiers };
    }
    return null;
  };
  const staticBoolean = (modifier: RegistrationModifier): boolean => {
    const value = modifier.arguments?.[0];
    if (value && value.type !== "SpreadElement" && value.type !== "ArgumentPlaceholder"
      && syntax.isBooleanLiteral(value)) return value.value;
    throw new SyntaxError(`Dynamic ${modifier.name} registration is not closed evidence: ${path}`);
  };
  const registration = (node: syntax.CallExpression): { root: RegistrationRoot; disabled: boolean } | null => {
    const chain = registrationChain(node.callee);
    if (!chain) return null;
    const last = chain.modifiers.at(-1);
    if (last && ["each", "if", "onlyIf", "skipIf", "todoIf"].includes(last.name) && !last.arguments) return null;
    let disabled = false;
    for (const modifier of chain.modifiers) {
      if (modifier.name === "only" || modifier.name === "onlyIf") {
        throw new SyntaxError(`Focused ${chain.root} registration is not closed evidence: ${path}`);
      }
      if (modifier.name === "skip" || modifier.name === "todo") disabled = true;
      else if (modifier.name === "skipIf" || modifier.name === "todoIf") disabled ||= staticBoolean(modifier);
      else if (modifier.name === "if") disabled ||= !staticBoolean(modifier);
      else if (modifier.name !== "each") {
        throw new SyntaxError(`Unknown ${chain.root}.${modifier.name} registration modifier: ${path}`);
      }
    }
    return { root: chain.root, disabled };
  };
  const registrationName = (node: syntax.Node): string | null => {
    const literal = literalString(node);
    if (literal !== null) return literal;
    if (!syntax.isTemplateLiteral(node)) return null;
    return node.quasis.map((quasi, index) => {
      const text = quasi.value.cooked ?? quasi.value.raw;
      const expression = node.expressions[index];
      return expression ? `${text}\${${syntaxText(parsed, expression)}}` : text;
    }).join("");
  };
  const visit = (node: syntax.Node, disabled: boolean): void => {
    const currentCall = syntax.isCallExpression(node) ? node : null;
    const current = currentCall ? registration(currentCall) : null;
    if (current && current.root !== "describe" && !current.disabled && !disabled && currentCall && currentCall.arguments.length > 0) {
      const first = currentCall.arguments[0];
      if (first.type !== "SpreadElement" && first.type !== "ArgumentPlaceholder") {
        const name = registrationName(first);
        if (name !== null) names.push(name);
      }
    }
    const childDisabled = disabled || current?.disabled === true;
    forEachSyntaxChild(node, (child) => visit(child, childDisabled));
  };
  visit(parsed.program, false);
  return Object.freeze(names);
}

describe("latent Earendil Harness v3 compatibility evidence", () => {
  test("normalizes only the exact accepted closed manifest and deeply freezes it", () => {
    const normalized = normalizeEarendilHarnessCompatibilityManifest(EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST);
    expect(normalized.ok).toBe(true);
    expect(normalized.issues).toEqual([]);
    if (!normalized.ok) throw new Error("Expected the accepted manifest to normalize.");
    expect(normalized.value).toEqual(EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST);
    expectDeepFrozen(normalized.value);

    expect(normalized.value.authority).toEqual({ currentRuntimeVersion: "0.85.1", harnessActivation: "latent_only", unsupportedCountsAsPass: false });
    expect(normalized.value.historical.authority).toEqual({
      currentRuntimeVersion: "0.84.4",
      harnessBaselineVersion: "0.84.1",
      harnessCandidateVersion: "0.84.4",
      harnessCandidateSelection: "rejected_evidence_only",
      unsupportedCountsAsPass: false,
      harnessActivation: "latent_only",
      designCommit: "5f7195c51eac43cdf329f813a7ef020d7bd74527",
      draftEvidenceCommit: "fd389abc4677b4e0fa5dc9b2bbd2e63418f079b4",
    });
    expect(normalized.value.historical.releases.map((release) => [
      release.tag,
      release.commit,
      release.runtimeSelection,
      release.harnessSelection,
    ])).toEqual([
      ["v0.84.1", "53fa77ccd8a279eb87e92294ef3687b03ff80112", "historical", "baseline_evidence"],
      ["v0.84.4", "b79e4cc834970cca69daebffab7df1da7d1e52c4", "installed", "rejected_evidence_only"],
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

  test("retains all historical unsupported HC rows and historical operation catalogue", () => {
    const manifest = EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST.historical;
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

  test("CI compiles positive selected public contracts without negative suppressions", async () => {
    const source = await Bun.file(compatibilityTestPath).text();
    const assignments = await Bun.file(directAssignmentsPath).text();
    expect(source.match(/^\s*\/\/ @ts-expect-error/gm) ?? []).toHaveLength(0);
    expect(compileCompatibilitySource(source)).toEqual([]);
    expect(assignments).toContain("sixArgumentExecution");
    expect(assignments).not.toContain("fiveArgumentExecution");
    for (const specifier of earendilModuleSpecifiers(source + "\n" + assignments)) {
      expect(specifier).not.toContain("/dist/");
      expect(specifier).not.toMatch(/0\.84\./);
    }
  });

  test("preserves the historical negative receipt without executing it against 0.85.1", async () => {
    const receipt = await Bun.file(resolve(runtimeRoot, "../docs/design/earendil-agent-harness-integration-adr/evidence/earendil-0844-historical-negatives.json")).json();
    expect(receipt.version).toBe("0.84.4");
    expect(receipt.negativeCompilerChecks).toBe(7);
    expect(receipt.toolExecuteArgumentCount).toBe(5);
    expect(receipt.operations.map((r: { operation: string }) => r.operation)).toEqual(EARENDIL_HARNESS_DIRECT_OPERATIONS);
    expect(receipt.operations).toHaveLength(25);
    expect(receipt.operations.every((r: { status: string; errorName: string }) => r.status === "unsupported" && r.errorName === "HarnessNotImplemented")).toBe(true);
    expect(await readInstalledEarendilAgentCoreVersion()).toBe("0.85.1");
  });

  test("maps every selected HC row and status to exact active public test registrations", () => {
    const evidenceFiles = [
      "earendil-harness-selected-semantics.test.ts",
      "earendil-harness-broader-semantics.test.ts",
      "earendil-jsonl-process-loss.test.ts",
      "earendil-session-backend-conformance.test.ts",
    ];
    const registered = evidenceFiles.flatMap((name) => {
      const path = resolve(import.meta.dir, name);
      return activeTestNames(path, readFileSync(path, "utf8"));
    });
    const selected = EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST.selected.capabilities;
    expect(SELECTED_HARNESS_EVIDENCE_LINKS.map((link) => [link.id, link.status])).toEqual(
      selected.map((capability) => [capability.id, capability.status]),
    );
    for (const link of SELECTED_HARNESS_EVIDENCE_LINKS) {
      expect(link.tests.length).toBeGreaterThan(0);
      for (const testName of link.tests) expect(registered.filter((name) => name === testName)).toHaveLength(1);
    }
    expect(readdirSync(resolve(import.meta.dir, "fixtures")).filter((name) => name.startsWith("earendil-")).sort()).toContain(
      "earendil-harness-deterministic-controls.ts",
    );
  });

  test("active test extraction rejects textual and disabled evidence while retaining templates", () => {
    const source = [
      '// test("comment-only evidence", () => {});',
      'test.skip("skipped evidence", () => {});',
      'it.todo("todo evidence", () => {});',
      'describe.skip("disabled", () => { test("nested disabled evidence", () => {}); });',
      'describe.skip.each([[1]])("disabled %s", () => { test("nested skipped-each evidence", () => {}); });',
      'describe.skipIf(true)("conditional disabled", () => { test("nested skip-if evidence", () => {}); });',
      'describe.skipIf(false)("conditional active", () => { test("nested conditional active evidence", () => {}); });',
      'test.skip("disabled callback", () => { test("nested skipped-test evidence", () => {}); });',
      'test("active evidence", () => {});',
      'test(`active template ${value}`, () => {});',
      'test.each([[1]])("active parameterized $value", () => {});',
      'test.each`value\\n${1}`("active tagged parameterized %s", () => {});',
    ].join("\n");
    expect(activeTestNames("synthetic-evidence.test.ts", source)).toEqual([
      "nested conditional active evidence",
      "active evidence",
      'active template ${value}',
      "active parameterized $value",
      "active tagged parameterized %s",
    ]);
    expect(() => activeTestNames("focused-test.ts", 'test.only("focused", () => {});')).toThrow(/Focused test/);
    expect(() => activeTestNames("focused-chain.ts", 'test.only.each([[1]])("focused %s", () => {});')).toThrow(/Focused test/);
    expect(() => activeTestNames("focused-describe.ts", 'describe.each([[1]]).only("focused %s", () => { test("nested", () => {}); });')).toThrow(/Focused describe/);
    expect(() => activeTestNames("dynamic-skip.ts", 'describe.skipIf(flag)("ambiguous", () => { test("nested", () => {}); });')).toThrow(/Dynamic skipIf/);
  });

  test("selected-release partial HC coverage never counts as full promotion", () => {
    const selected = EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST.selected;
    expect(selected.version).toBe("0.85.1");
    const selectedIds: readonly string[] = selected.capabilities.map((capability) => capability.id);
    expect(selectedIds).toEqual(
      Array.from({ length: 25 }, (_, index) => `HC-${String(index + 1).padStart(3, "0")}`),
    );
    expect(selected.capabilities).toHaveLength(25);
    expect(selected.capabilities.filter((capability) => capability.status === "partial")).toHaveLength(24);
    expect(selected.capabilities.filter((capability) => capability.status === "unsupported").map((capability) => capability.id)).toEqual(["HC-024"]);
    const statuses: readonly string[] = selected.capabilities.map((capability) => capability.status);
    expect(statuses).not.toContain("pass");
    expect(selected.productionActivation).toBe(false);
    expect(selected.watchSession.status).toBe("unsupported");
  });

});
