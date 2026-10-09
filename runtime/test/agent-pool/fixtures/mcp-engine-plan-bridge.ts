import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hydrateMcpKeychainCredentials, getMcpBridgeSnapshot, clearHydratedMcpCredentials } from "../../../src/secure/mcp-keychain.js";
import { planMcpEnginePolicy } from "../../../src/agent-pool/mcp-engine-plan.js";

const mode = process.argv[2];
assert.ok(["mapped", "adapter-only", "quarantined"].includes(mode));
const root = mkdtempSync(join(tmpdir(), "mcp-policy-bridge-"));
const originalFetch = globalThis.fetch;
let network = 0;
const deny = () => { network++; throw new Error("Unexpected network."); };
globalThis.fetch = Object.assign(deny, { preconnect: deny }) as typeof fetch;
try {
  process.env.PICLAW_WORKSPACE = root;
  process.env.PICLAW_PI_AGENT_DIR = join(root, "agent");
  process.env.PI_CODING_AGENT_DIR = join(root, "agent");
  mkdirSync(join(root, ".pi"), { recursive: true });
  writeFileSync(join(root, ".pi", "mcp.json"), JSON.stringify({ mcpServers: {
    fixture: mode === "mapped" ? { command: "fixture", directTools: true }
      : mode === "adapter-only" ? { command: "fixture", lifecycle: "lazy" }
      : { command: "fixture", env: { API_TOKEN: "PRIVATE-BRIDGE-SENTINEL" } },
  } }));
  await hydrateMcpKeychainCredentials(root, () => { throw new Error("Live keychain access forbidden."); });
  const bridge = getMcpBridgeSnapshot();
  const readiness = { adapter: true, native: true, codemode: true };
  const adapter = planMcpEnginePolicy({ engine: "adapter", codemode: "auto" }, bridge, readiness);
  const native = planMcpEnginePolicy({ engine: "native", codemode: "auto" }, bridge, readiness);
  const row = bridge.dryRun.rows.find(row => row.serverName === "fixture");
  assert.equal(row?.status, mode === "mapped" ? "mapped" : mode === "adapter-only" ? "blocked" : "quarantined");
  assert.equal(adapter.applicable, mode !== "quarantined");
  assert.equal(native.applicable, mode === "mapped");
  assert.equal(native.codemodeEnabled, false);
  const secretsExported = JSON.stringify({ bridge, adapter, native }).includes("PRIVATE-BRIDGE-SENTINEL");
  assert.equal(secretsExported, false);
  assert.equal(network, 0);
  console.log(JSON.stringify({ mode, status: "pass", bridgeClassification: row?.status, adapterApplicable: adapter.applicable, nativeApplicable: native.applicable, network, secretsExported }));
} finally {
  clearHydratedMcpCredentials([]); globalThis.fetch = originalFetch;
  rmSync(root, { recursive: true, force: true });
}
