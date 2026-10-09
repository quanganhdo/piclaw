import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
const root = resolve(import.meta.dir, "../../.."), receipts = join(root, "docs/design/earendil-agent-harness-integration-adr/evidence/receipts");
const names = ["chord", "pi-agent-core", "pi-ai", "pi-codemode", "pi-coding-agent", "pi-mcp", "pi-telemetry", "pi-tui"].map(name => "@earendil-works/" + name).sort();
test("actual exact1.0.1 admission binds exact package payloads, registry and providers", () => {
  const r = JSON.parse(readFileSync(join(receipts, "earendil-101-package-admission.json"), "utf8"));
  const registry = JSON.parse(readFileSync(join(receipts, "earendil-101-registry.json"), "utf8"));
  const providers = JSON.parse(readFileSync(join(receipts, "earendil-101-provider-auth.json"), "utf8"));
  expect(r.expected).toEqual({ version: "1.0.1", gitHead: "a7229ddc21810d6245105978033b7df645ecc2f7" });
  expect(r.tarballVerification.map((p: { name: string }) => p.name).sort()).toEqual(names);
  expect(r.registryReceipt.packages.map((p: { name: string }) => p.name).sort()).toEqual(names);
  expect(registry.map((p: { name: string }) => p.name).sort()).toEqual(names);
  expect(r.providerAuthReceipt.version).toBe(providers.version); expect(r.providerAuthReceipt.gitHead).toBe(providers.gitHead); expect(r.providerAuthReceipt.providers).toEqual(providers.providers);
  expect(r.runtimes).toHaveLength(1);
  expect(r.runtimes[0].sideEffectEnforcement).toMatchObject({ networkDenied: true, childProcessDenied: true, networkAttempts: 0, childProcessAttempts: 0 });
  for (const p of r.tarballVerification) {
    const registered = registry.find((entry: { name: string }) => entry.name === p.name); expect(registered).toBeDefined();
    expect(registered.version).toBe("1.0.1"); expect(registered.gitHead).toBe(r.expected.gitHead);
    expect(p.shasum).toBe(registered.dist.shasum); expect(p.integrity).toBe(registered.dist.integrity); expect(p.tarball).toContain("-1.0.1.tgz");
    const canonical = r.registryReceipt.packages.find((entry: { name: string }) => entry.name === p.name);
    expect(canonical.version).toBe("1.0.1"); expect(canonical.shasum).toBe(p.shasum); expect(canonical.integrity).toBe(p.integrity);
    expect(p.installedTreeSha256).toMatch(/^[a-f0-9]{64}$/); // Historical payload identity; no current-version equality.
  }
  // Raw paths were redacted for publication. This hash identifies the local
  // raw receipt; it is metadata, not an independently re-computed CI guard.
  expect(r.rawReceiptSha256).toMatch(/^[a-f0-9]{64}$/);
});
