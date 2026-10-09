import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createMcpExtension, createToolSearchExtension, createCodemodeExtension } from "@earendil-works/pi-coding-agent";
import { checkMcpPublic110, matchNegativeDiagnostics, MCP_GIT_HEAD, MCP_VERSION, missingSeams } from "../../../scripts/check-earendil-mcp-public-110.ts";

const root = resolve(import.meta.dir, "../../..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const lock = readFileSync(resolve(root, "bun.lock"), "utf8");
const family = ["chord", "pi-agent-core", "pi-ai", "pi-codemode", "pi-coding-agent", "pi-mcp", "pi-telemetry", "pi-tui"].map(name => "@earendil-works/" + name);

// The exact-target test is active; only the historical 1.0.3 closure is conditional.
test("exact 1.1.0 package, lock and installed eight-package closure excludes durable", () => {
  for (const name of ["chord", "pi-agent-core", "pi-ai", "pi-coding-agent"].map(name => "@earendil-works/" + name)) {
    expect(pkg.dependencies[name], name).toBe("1.1.0");
  }
  for (const name of family) expect(pkg.overrides[name], name).toBe("1.1.0");
  // Parse Bun's JSON-with-trailing-delimiters lock and inspect package values.
  const parsed = JSON.parse(lock.replace(/,\s*([}\]])/g, "$1"));
  const resolved = Object.values(parsed.packages).map((entry: any) => entry[0] as string).filter(id => id.startsWith("@earendil-works/"));
  expect(resolved.sort()).toEqual(family.map(name => name + "@1.1.0").sort());
  for (const name of ["chord", "pi-agent-core", "pi-ai", "pi-coding-agent"].map(name => "@earendil-works/" + name)) {
    expect(parsed.workspaces[""].dependencies[name], name).toBe("1.1.0");
  }
  for (const name of family) {
    const installed = JSON.parse(readFileSync(resolve(root, "node_modules", name, "package.json"), "utf8"));
    expect(installed.name).toBe(name);
    expect(installed.version, name).toBe("1.1.0");
  }
  expect(JSON.stringify({ dependencies: pkg.dependencies, devDependencies: pkg.devDependencies, overrides: pkg.overrides })).not.toContain("pi-durable");
  expect(lock).not.toContain("pi-durable");
  expect(existsSync(resolve(root, "node_modules/@earendil-works/pi-durable"))).toBe(false);
});

test("1.1.0 keeps wrapper ownership and does not activate native MCP or Harness", () => {
  expect(pkg.dependencies["pi-mcp-adapter"]).toBe("github:piclaw-bot/pi-mcp-adapter#dddfcf630508f42c169889c11dee94e69b746e7c");
  const session = readFileSync(resolve(root, "runtime/src/agent-pool/session.ts"), "utf8");
  expect(session).toContain('require("pi-mcp-adapter")');
  expect(session).toContain("initializeOnLoad: false");
  expect(session).toContain("resolveRuntimeEnv");
  for (const factory of ["createMcpExtension", "createToolSearchExtension", "createCodemodeExtension"]) expect(session).not.toContain(factory);
  expect(typeof createMcpExtension).toBe("function");
  expect(typeof createToolSearchExtension).toBe("function");
  expect(typeof createCodemodeExtension).toBe("function");
  expect(session).not.toMatch(/AgentHarness|Pico3|pi-durable/);
  const manifest = readFileSync(resolve(root, "runtime/src/service-effects/earendil-harness-v3-compatibility/manifest.ts"), "utf8");
  expect(manifest).toContain('currentRuntimeVersion: "0.99.1"'); // Frozen evidence, not the installed target.
  expect(manifest).toContain('harnessActivation: "latent_only"');
  expect(manifest).toContain('"productionImport": false');
  expect(manifest).toContain('"productionActivation": false');
});

test("1.1.0 public MCP and ToolLoadout.getPromptGuidelines types compile with all ten exact gaps retained", () => {
  expect(MCP_VERSION).toBe("1.1.0");
  expect(MCP_GIT_HEAD).toBe("abe508e1b89912adde45528136c3221eb69acdd7");
  const receipt = checkMcpPublic110(root);
  expect(receipt).toMatchObject({ version: "1.1.0", referenceGitHead: "abe508e1b89912adde45528136c3221eb69acdd7", positive: "pass", scope: "public_type_contract_only", nativeParity: "not_qualified", productionActivation: false });
  expect(receipt.packages).toEqual(["pi-coding-agent", "pi-mcp", "pi-codemode"].map(name => ({ name: "@earendil-works/" + name, version: "1.1.0" })));
  expect(receipt.negative).toEqual([
    { symbol: "lazy", code: "TS2353", requirement: "MCP-08" },
    { symbol: "statusObserver", code: "TS2353", requirement: "MCP-12" },
    { symbol: "resourceFilter", code: "TS2353", requirement: "MCP-06" },
    { symbol: "authStart", code: "TS2353", requirement: "MCP-10" },
    { symbol: "appRenderer", code: "TS2353", requirement: "MCP-11" },
    { symbol: "absoluteDeadlineMs", code: "TS2353", requirement: "MCP-07" },
    { symbol: "McpOAuthCredentialStore", code: "TS2740", requirement: "MCP-03" },
    { symbol: "socket", code: "TS2322", requirement: "MCP-08" },
    { symbol: "listPrompts", code: "TS2339", requirement: "MCP-11" },
    { symbol: "getPrompt", code: "TS2339", requirement: "MCP-11" },
  ]);
  expect(receipt.positiveSourceSha256).toMatch(/^[0-9a-f]{64}$/);
  expect(receipt.negativeSourceSha256).toMatch(/^[0-9a-f]{64}$/);
}, 65_000);

test("1.1.0 diagnostic matching rejects missing, extra, changed and ambiguous gaps", () => {
  const lines = missingSeams.map(row => `error ${row.code}: ${row.symbol}`);
  expect(matchNegativeDiagnostics(lines.join("\n"))).toEqual(missingSeams);
  expect(() => matchNegativeDiagnostics(lines.slice(1).join("\n"))).toThrow("Expected exactly 10");
  expect(() => matchNegativeDiagnostics([...lines, "error TS9999: unrelated"].join("\n"))).toThrow("Expected exactly 10");
  expect(() => matchNegativeDiagnostics(["error TS2339: lazy", ...lines.slice(1)].join("\n"))).toThrow("Missing or ambiguous TS2353 for lazy");
  expect(() => matchNegativeDiagnostics([lines[0], lines[0], ...lines.slice(2)].join("\n"))).toThrow("Missing or ambiguous TS2353 for lazy");
});
