import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import ts from "typescript";

import {
  readRepositorySourceTree,
  resolveRepositoryModule,
} from "./fixtures/repository-tool-family-oracle.js";

const LATENT_ROOT = "src/service-effects/earendil-harness-v3-compatibility/";
const EXPECTED_LATENT_FILES = [
  `${LATENT_ROOT}direct-assignments.ts`,
  `${LATENT_ROOT}manifest.ts`,
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

function parse(path: string, source: string): ts.SourceFile {
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function moduleSpecifiers(path: string, source: string): readonly string[] {
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const argument = node.arguments[0];
      const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const commonJsRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      const importMetaResolve = ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "resolve" && ts.isMetaProperty(node.expression.expression);
      if ((dynamicImport || commonJsRequire || importMetaResolve) && ts.isStringLiteral(argument)) specifiers.push(argument.text);
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expression = node.moduleReference.expression;
      if (expression && ts.isStringLiteral(expression)) specifiers.push(expression.text);
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      specifiers.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(path, source));
  return specifiers;
}

function calledName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
}

describe("latent Earendil Harness v3 non-interference boundary", () => {
  const tree = readRepositorySourceTree();
  const latentFiles = Object.keys(tree.files).filter((path) => path.startsWith(LATENT_ROOT)).sort();

  test("contains exactly the two authorized latent source files and no barrel", () => {
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

  test("uses type-only public roots and emits no assignment runtime", () => {
    const assignmentsPath = EXPECTED_LATENT_FILES[0];
    const assignments = tree.files[assignmentsPath];
    const ast = parse(assignmentsPath, assignments);
    const imports = ast.statements.filter(ts.isImportDeclaration);
    expect(imports.every((declaration) => declaration.importClause?.isTypeOnly === true)).toBe(true);
    expect(moduleSpecifiers(assignmentsPath, assignments).filter((specifier) => specifier.startsWith("@earendil-works/")))
      .toEqual([
        "@earendil-works/pi-ai",
        "@earendil-works/pi-agent-core",
        "@earendil-works/pi-coding-agent",
      ]);
    const emitted = ts.transpileModule(assignments, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText.trim();
    expect(emitted).toBe("export {};");
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
      const ast = parse(path, source);
      for (const specifier of moduleSpecifiers(path, source)) {
        if (specifier.startsWith("@earendil-works/") && !APPROVED_PUBLIC_EARENDIL_SPECIFIERS.has(specifier)) {
          findings.push(`${path}: non-public or unapproved import ${specifier}`);
        }
        if (specifier.includes("/dist/") || /0\.84\.\d/.test(specifier)) {
          findings.push(`${path}: private or version-qualified runtime import ${specifier}`);
        }
      }
      const visit = (node: ts.Node): void => {
        if (ts.isClassDeclaration(node)) findings.push(`${path}: class declaration`);
        if ((ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && prohibitedDeclarations.has(node.name.text)) {
          findings.push(`${path}: compatibility shim ${node.name.text}`);
        }
        if (ts.isCallExpression(node)) {
          const name = calledName(node.expression);
          if (name && PROHIBITED_CALL_NAMES.has(name)) findings.push(`${path}: prohibited call ${name}`);
        }
        if (ts.isAwaitExpression(node)) findings.push(`${path}: import-time-capable await expression`);
        ts.forEachChild(node, visit);
      };
      visit(ast);
      expect(source).not.toMatch(/\b(?:process|Bun|Deno)\.env\b/);
    }
    expect(findings).toEqual([]);
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
