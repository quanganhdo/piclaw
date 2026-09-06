import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readAccessConfig } from "../../src/core/config-access.js";

const dirs: string[] = [];
function config(value?: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "piclaw-access-config-"));
  dirs.push(dir);
  const path = join(dir, "config.json");
  if (value !== undefined) writeFileSync(path, JSON.stringify(value));
  return path;
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

test("missing access mode preserves single-user defaults", () => {
  for (const input of [undefined, {}, { domains: {} }, { domains: { access: {} } }]) {
    expect(readAccessConfig(config(input))).toEqual({ mode: "single-user", isolation: null, modeExplicit: false });
  }
  expect(readAccessConfig(config({ domains: { access: { mode: "single-user" } } })).modeExplicit).toBe(true);
});

test("explicit malformed access configuration never silently defaults", () => {
  for (const input of [null, [], { domains: null }, { domains: [] }, { domains: { access: null } }, { domains: { access: [] } },
    { access: { mode: "family-shared" } }, { domains: { access: { mode: "" } } },
    { domains: { access: { mode: "unknown" } } }, { domains: { access: { mode: null } } },
    { domains: { access: { mode: 1 } } }, { domains: { access: { enabled: true } } }]) {
    expect(() => readAccessConfig(config(input))).toThrow();
  }
  const file = config({});
  writeFileSync(file, "{");
  expect(() => readAccessConfig(file)).toThrow("Invalid JSON");
});

test("family mode parses without enabling execution", () => {
  expect(readAccessConfig(config({ domains: { access: { mode: "family-shared" } } })).mode).toBe("family-shared");
});

test("isolated mode validates component-specific registry and trust references", () => {
  const gateway = { component: "gateway", signingKeyRef: "gateway/signing", backends: [{ id: "alice", ownerUserId: "u-alice", url: "https://alice.internal" }] };
  const backend = { component: "backend", backendId: "alice", ownerUserId: "u-alice", gatewayUrl: "https://gateway.internal", verificationKeyRef: "gateway/public-key" };
  for (const isolation of [gateway, backend]) {
    expect(readAccessConfig(config({ domains: { access: { mode: "isolated-containers", isolation } } })).isolation?.component).toBe(isolation.component);
  }
  for (const isolation of [null, {}, { component: "other" }, { ...gateway, signingKeyRef: "" }, { ...gateway, backends: [] },
    { ...gateway, backends: [...gateway.backends, ...gateway.backends] },
    { ...gateway, backends: [...gateway.backends, { id: "bob", ownerUserId: "u-bob", url: "https://alice.internal/" }] },
    { ...backend, gatewayUrl: "http://gateway" },
    { ...backend, gatewayUrl: "https://user:pass@gateway" }, { ...backend, unexpected: true }]) {
    expect(() => readAccessConfig(config({ domains: { access: { mode: "isolated-containers", isolation } } }))).toThrow();
  }
  expect(() => readAccessConfig(config({ domains: { access: { mode: "single-user", isolation: gateway } } }))).toThrow();
});
