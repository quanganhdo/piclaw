import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import * as syntax from "@babel/types";

import {
  calledName,
  collectModuleSpecifiers,
  parseTypeScriptSource,
  walkSyntax,
} from "./fixtures/typescript-syntax-oracle.js";
import {
  readRepositorySourceTree,
  resolveRepositoryModule,
} from "./fixtures/repository-tool-family-oracle.js";

const LATENT_ROOT = "src/service-effects/earendil-harness-v3-compatibility/";
const EXPECTED_LATENT_FILES = [
  `${LATENT_ROOT}direct-assignments.ts`,
  `${LATENT_ROOT}manifest.ts`,
  `${LATENT_ROOT}preparation-contract.ts`,
] as const;
const APPROVED_PUBLIC_EARENDIL_SPECIFIERS = new Set([
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-agent-core/node",
  "@earendil-works/pi-agent-core/package.json",
  "@earendil-works/pi-agent-core/session/testing",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-ai/compat",
  "@earendil-works/pi-coding-agent",
]);
const PROHIBITED_CALL_NAMES = new Set([
  "addEventListener",
  "connect",
  "createServer",
  "exec",
  "fetch",
  "listen",
  "queueMicrotask",
  "register",
  "route",
  "setInterval",
  "setTimeout",
  "spawn",
  "writeFile",
]);

function moduleSpecifiers(path: string, source: string): readonly string[] {
  return collectModuleSpecifiers(path, source);
}

function isTypeOnlyStatement(statement: syntax.Statement): boolean {
  if (syntax.isImportDeclaration(statement)) return statement.importKind === "type";
  if (syntax.isTSTypeAliasDeclaration(statement) || syntax.isTSInterfaceDeclaration(statement) || syntax.isTSDeclareFunction(statement)) return true;
  if (!syntax.isExportNamedDeclaration(statement)) return false;
  if (statement.exportKind === "type") return true;
  return !!statement.declaration && (
    syntax.isTSTypeAliasDeclaration(statement.declaration)
    || syntax.isTSInterfaceDeclaration(statement.declaration)
    || syntax.isTSDeclareFunction(statement.declaration)
  );
}

describe("latent Earendil Harness v3 non-interference boundary", () => {
  const tree = readRepositorySourceTree();
  const latentFiles = Object.keys(tree.files).filter((path) => path.startsWith(LATENT_ROOT)).sort();

  test("contains exactly the authorized latent source files and no barrel", () => {
    expect(latentFiles).toEqual([...EXPECTED_LATENT_FILES]);
    expect(latentFiles.some((path) => path.endsWith("/index.ts"))).toBe(false);
  });

  test("has no production importer, export, registration, or reachability edge", () => {
    const incoming: string[] = [];
    for (const [path, source] of Object.entries(tree.files)) {
      if (path.startsWith(LATENT_ROOT) || !path.endsWith(".ts")) continue;
      for (const specifier of moduleSpecifiers(path, source)) {
        const resolved = resolveRepositoryModule(path, specifier, tree.files);
        if (resolved?.startsWith(LATENT_ROOT)) incoming.push(`${path} -> ${resolved}`);
      }
      expect(source).not.toContain("earendil-harness-v3-compatibility");
    }
    expect(incoming).toEqual([]);
    expect(tree.files["package.json"]).not.toContain("earendil-harness-v3-compatibility");
  });

  test("uses type-only public roots and emits no assignment or preparation runtime", () => {
    const assignmentsPath = EXPECTED_LATENT_FILES[0];
    const assignments = tree.files[assignmentsPath];
    const assignmentsAst = parseTypeScriptSource(assignmentsPath, assignments);
    const assignmentImports = assignmentsAst.statements.filter(syntax.isImportDeclaration);
    expect(assignmentImports.every((declaration) => declaration.importKind === "type")).toBe(true);
    expect(moduleSpecifiers(assignmentsPath, assignments).filter((specifier) => specifier.startsWith("@earendil-works/")))
      .toEqual([
        "@earendil-works/pi-ai",
        "@earendil-works/pi-agent-core",
        "@earendil-works/pi-coding-agent",
      ]);
    expect(assignmentsAst.statements.every(isTypeOnlyStatement)).toBe(true);

    const preparationPath = EXPECTED_LATENT_FILES[2];
    const preparation = tree.files[preparationPath];
    const preparationAst = parseTypeScriptSource(preparationPath, preparation);
    expect(preparationAst.statements.filter(syntax.isImportDeclaration)
      .every((declaration) => declaration.importKind === "type")).toBe(true);
    expect(moduleSpecifiers(preparationPath, preparation)).toEqual([
      "../contracts/execution-context-resolver.js",
    ]);
    expect(preparationAst.statements.every(isTypeOnlyStatement)).toBe(true);
    expect(preparation).not.toContain("@earendil-works/chord");
    expect(preparation).not.toContain("@earendil-works/pi-agent-core");
  });

  test("contains no runtime package import, activation primitive, shim declaration, or import-time I/O", () => {
    const prohibitedDeclarations = new Set([
      "AgentHarnessConstructor",
      "HarnessEventBus",
      "HarnessExecutionPort",
      "Storage",
      "Transaction",
      "UsageRow",
    ]);
    const findings: string[] = [];
    for (const path of latentFiles) {
      const source = tree.files[path];
      const ast = parseTypeScriptSource(path, source);
      for (const specifier of moduleSpecifiers(path, source)) {
        if (specifier.startsWith("@earendil-works/") && !APPROVED_PUBLIC_EARENDIL_SPECIFIERS.has(specifier)) {
          findings.push(`${path}: non-public or unapproved import ${specifier}`);
        }
        if (specifier.includes("/dist/") || /0\.84\.\d/.test(specifier)) {
          findings.push(`${path}: private or version-qualified runtime import ${specifier}`);
        }
      }
      walkSyntax(ast.program, (node) => {
        if (syntax.isClassDeclaration(node)) findings.push(`${path}: class declaration`);
        if ((syntax.isTSInterfaceDeclaration(node) || syntax.isTSTypeAliasDeclaration(node)) && prohibitedDeclarations.has(node.id.name)) {
          findings.push(`${path}: compatibility shim ${node.id.name}`);
        }
        if (syntax.isCallExpression(node)) {
          const name = calledName(node.callee);
          if (name && PROHIBITED_CALL_NAMES.has(name)) findings.push(`${path}: prohibited call ${name}`);
        }
        if (syntax.isAwaitExpression(node)) findings.push(`${path}: import-time-capable await expression`);
      });
      expect(source).not.toMatch(/\b(?:process|Bun|Deno)\.env\b/);
    }
    expect(findings).toEqual([]);
  });

  test("keeps version-specific preparation isolated from version-neutral Piclaw authority contracts", () => {
    const preparation = tree.files[EXPECTED_LATENT_FILES[2]];
    expect(preparation).toContain("PiclawExecutionAuthority");
    expect(preparation).toContain("PiclawToolContext");
    expect(preparation).not.toMatch(/interface\s+(?:ServiceWorkStore|TerminalSettlementStore|ServiceOutboxStore|ScheduledRunStore|AgentProjectionSink)\b/);
    for (const path of [
      "src/service-effects/contracts/service-work-store.ts",
      "src/service-effects/contracts/terminal-settlement-store.ts",
      "src/service-effects/contracts/service-outbox-store.ts",
      "src/service-effects/contracts/scheduled-run-store.ts",
      "src/service-effects/contracts/agent-projection-sink.ts",
    ]) {
      expect(tree.files[path]).not.toContain("EarendilV3");
      expect(tree.files[path]).not.toContain("0.85");
    }
  });

  test("keeps both test fixtures on declared public exports and outside production source", async () => {
    const runtimeRoot = resolve(import.meta.dir, "../..");
    const fixtureNames = [
      "earendil-harness-direct-probe.ts",
      "earendil-session-backend-fixtures.ts",
    ];
    for (const fixtureName of fixtureNames) {
      const path = resolve(runtimeRoot, "test/service-effects/fixtures", fixtureName);
      const source = await Bun.file(path).text();
      const specifiers = moduleSpecifiers(path, source);
      for (const specifier of specifiers.filter((entry) => entry.startsWith("@earendil-works/"))) {
        expect(APPROVED_PUBLIC_EARENDIL_SPECIFIERS.has(specifier)).toBe(true);
        expect(specifier).not.toContain("/dist/");
      }
      expect(specifiers.some((specifier) => /0\.84\.\d/.test(specifier))).toBe(false);
    }
  });
});
