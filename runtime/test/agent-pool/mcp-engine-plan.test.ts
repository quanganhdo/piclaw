import { expect, test } from "bun:test";
import type { McpBridgeSnapshot } from "../../src/secure/mcp-keychain.js";
import type { McpServerConfig } from "@earendil-works/pi-coding-agent";
import type { ServerEntry } from "pi-mcp-adapter/types";
import { planMcpEnginePolicy } from "../../src/agent-pool/mcp-engine-plan.js";

function snapshot(servers: Record<string, ServerEntry> = {}, exposure: McpServerConfig["exposure"] = "deferred"): McpBridgeSnapshot {
  return { revision: "fixture-revision", adapterConfig: { mcpServers: servers },
    nativePreview: { servers: Object.entries(servers).map(([name, config]) => ({ name, source: "fixture", config: { type: "stdio", command: config.command ?? "fixture", enabled: config.disabled !== true, exposure } })), errors: [] },
    provenance: [], diagnostics: [], sourceRevisions: {}, dryRun: { revision: "fixture-revision", rows: Object.keys(servers).map(serverName => ({ serverName, status: "mapped", mappings: [], reasons: [] })), diagnostics: [], secretValuesPresent: false } };
}
const ready = { adapter: true, native: true, codemode: true };
const native = { engine: "native", codemode: "auto" } as const;

test("adapter default plan preserves independent proxy exposure without requiring codemode", () => {
  const value = snapshot({ fixture: { command: "fixture", lifecycle: "lazy", directTools: false } });
  expect(planMcpEnginePolicy({ engine: "adapter", codemode: "auto" }, value, ready)).toEqual({ policy: { engine: "adapter", codemode: "auto" }, bridgeRevision: value.revision,
    applicable: true, codemodeEnabled: false, enabledServerNames: ["fixture"], issues: [] });
  expect(planMcpEnginePolicy({ engine: "adapter", codemode: "on" }, value, ready).codemodeEnabled).toBe(true);
  expect(planMcpEnginePolicy({ engine: "adapter", codemode: "off" }, value, ready).applicable).toBe(true);
});

test("native plan respects enabled default and per-tool codemode exposures", () => {
  for (const exposure of ["codemode", "codemode-deferred"] as const) {
    const value = snapshot({ fixture: { command: "fixture" } }, exposure);
    expect(planMcpEnginePolicy(native, value, ready)).toMatchObject({ applicable: true, codemodeEnabled: true });
    const off = planMcpEnginePolicy({ engine: "native", codemode: "off" }, value, ready);
    expect(off.applicable).toBe(false); expect(off.issues.map(issue => issue.code)).toEqual(["codemode_required"]);
  }
  const value = snapshot({ fixture: { command: "fixture" }, disabled: { command: "disabled", disabled: true } }, "direct");
  value.nativePreview.servers[0].config.toolExposure = { script: "codemode" };
  expect(planMcpEnginePolicy(native, value, ready).codemodeEnabled).toBe(true);
  delete value.nativePreview.servers[0].config.toolExposure;
  value.nativePreview.servers[1].config.exposure = "codemode";
  expect(planMcpEnginePolicy(native, value, ready)).toMatchObject({ applicable: true, codemodeEnabled: false, enabledServerNames: ["fixture"] });
  delete value.nativePreview.servers[0].config.exposure;
  expect(planMcpEnginePolicy(native, value, ready).codemodeEnabled).toBe(true);
});

test("runtime readiness is independent of exports and refuses unavailable codemode", () => {
  expect(planMcpEnginePolicy(native, snapshot(), { ...ready, native: false }).issues.map(issue => issue.field)).toEqual(["engine"]);
  expect(planMcpEnginePolicy({ engine: "adapter", codemode: "on" }, snapshot(), { ...ready, codemode: false }).issues.map(issue => issue.field)).toEqual(["codemode"]);
  expect(planMcpEnginePolicy({ engine: "adapter", codemode: "auto" }, snapshot(), { ...ready, codemode: false }).applicable).toBe(true);
});

test("blocked and quarantined bridge entries fail closed without exposing diagnostic values", () => {
  const value = snapshot({ blocked: { command: "fixture" }, quarantine: { disabled: true } });
  value.dryRun.rows[0].status = "blocked"; value.dryRun.rows[0].reasons = ["PRIVATE-SENTINEL"];
  value.dryRun.rows[1].status = "quarantined";
  value.diagnostics.push({ serverName: "(configuration)", reason: "PRIVATE-SENTINEL" });
  const plan = planMcpEnginePolicy(native, value, ready);
  expect(plan.applicable).toBe(false); expect(plan.issues.map(issue => issue.code)).toContain("configuration_quarantined");
  expect(plan.issues.map(issue => issue.code)).toContain("native_incompatible");
  expect(JSON.stringify(plan)).not.toContain("PRIVATE-SENTINEL");
  expect(planMcpEnginePolicy({ engine: "adapter", codemode: "auto" }, value, ready).applicable).toBe(false);
});

const referenceCases: Array<[string, ServerEntry]> = [
  ["auth", { url: "https://fixture.invalid/mcp?secret=PRIVATE-SENTINEL" }],
  ["requestTimeoutMs", { command: "fixture", requestTimeoutMs: 2000 }],
  ["command", { command: "${PRIVATE_SENTINEL}" }],
  ["cwd", { command: "fixture", cwd: "${PRIVATE_SENTINEL}" }],
  ["args", { command: "fixture", args: ["${PRIVATE_SENTINEL}"] }],
  ["env", { command: "fixture", env: { KEY: "${PRIVATE_SENTINEL}" } }],
  ["auth", { command: "fixture", bearerTokenEnv: "PRIVATE_SENTINEL" }],
];
for (const [field, config] of referenceCases) {
  test(`native ${field} compatibility refusal is structural and omits server values`, () => {
    const plan = planMcpEnginePolicy(native, snapshot({ fixture: config }), ready);
    expect(plan.applicable).toBe(false); expect(plan.issues.map(issue => issue.field)).toContain(field);
    expect(JSON.stringify(plan)).not.toContain("PRIVATE-SENTINEL"); expect(JSON.stringify(plan)).not.toContain("PRIVATE_SENTINEL");
    expect(plan.bridgeRevision).toBe("fixture-revision");
  });
}

test("planning never mutates the snapshot or accepts unknown policy fields", () => {
  const value = snapshot({ fixture: { command: "fixture" } });
  const before = JSON.stringify(value);
  planMcpEnginePolicy(native, value, ready); expect(JSON.stringify(value)).toBe(before);
  expect(() => planMcpEnginePolicy({ ...native, token: "private" }, value, ready)).toThrow();
});

test("native-only blocked projection does not invalidate valid adapter policy", () => {
  const value = snapshot({ fixture: { command: "fixture", lifecycle: "lazy" } });
  value.dryRun.rows[0].status = "blocked";
  value.nativePreview.servers = [];
  expect(planMcpEnginePolicy({ engine: "adapter", codemode: "auto" }, value, ready).applicable).toBe(true);
  expect(planMcpEnginePolicy(native, value, ready).applicable).toBe(false);
});

for (const mode of ["disabled", "extra", "duplicate", "missing", "errors", "sanitization", "dryrun-diagnostic"]) {
  test(`native projection rejects ${mode} drift with no private diagnostic value`, () => {
    const value = snapshot({ fixture: { command: "fixture" } });
    if (mode === "disabled") value.nativePreview.servers[0].config.enabled = false;
    if (mode === "extra") value.nativePreview.servers.push({ name: "extra", source: "fixture", config: { type: "stdio", command: "PRIVATE-SENTINEL" } });
    if (mode === "duplicate") value.nativePreview.servers.push(structuredClone(value.nativePreview.servers[0]));
    if (mode === "missing") value.nativePreview.servers = [];
    if (mode === "errors") value.nativePreview.errors.push("PRIVATE-SENTINEL");
    if (mode === "sanitization") Object.assign(value.dryRun, { secretValuesPresent: true });
    if (mode === "dryrun-diagnostic") value.dryRun.diagnostics.push({ serverName: "(configuration)", reason: "PRIVATE-SENTINEL" });
    const plan = planMcpEnginePolicy(native, value, ready);
    expect(plan.applicable).toBe(false); expect(plan.issues.length).toBeGreaterThan(0);
    expect(JSON.stringify(plan)).not.toContain("PRIVATE-SENTINEL");
  });
}

test("native structural refusal includes explicit zero, empty auth and command resolvers", () => {
  for (const [field, config] of [
    ["requestTimeoutMs", { command: "fixture", requestTimeoutMs: 0 }],
    ["auth", { command: "fixture", auth: false }],
    ["command", { command: "!echo PRIVATE-SENTINEL" }],
  ] as const) {
    const plan = planMcpEnginePolicy(native, snapshot({ fixture: config }), ready);
    expect(plan.applicable).toBe(false); expect(plan.issues.map(issue => issue.field)).toContain(field);
    expect(JSON.stringify(plan)).not.toContain("PRIVATE-SENTINEL");
  }
});

test("inherited native server names never satisfy an own configuration entry", () => {
  for (const name of ["__proto__", "constructor", "toString"]) {
    const value = snapshot();
    value.nativePreview.servers.push({ name, source: "fixture", config: { type: "stdio", command: "fixture" } });
    expect(planMcpEnginePolicy(native, value, ready).applicable).toBe(false);
  }
});

test("missing disabled projections cannot silently lose configured servers", () => {
  const value = snapshot({ disabled: { command: "fixture", disabled: true } });
  value.nativePreview.servers = [];
  expect(planMcpEnginePolicy(native, value, ready).issues.map(issue => issue.serverName)).toContain("disabled");
});
