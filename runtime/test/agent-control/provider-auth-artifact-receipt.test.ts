import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

test("packed auth receipt preserves exact SDK fingerprints and incomplete CLI/UI qualification", () => {
  const receipt = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-0991-packed-provider-auth-bun.json"), "utf8"));
  expect(receipt.earendil).toBe("0.99.1");
  expect(receipt.runtime).toMatch(/^Bun /);
  expect(receipt.scope).toBe("packed_piclaw_model_services_public_sdk_auth_only");
  expect(receipt.tarballSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(receipt.sourceCommit).toMatch(/^[a-f0-9]{40}$/);
  expect(receipt.results).toEqual(["openai", "openai-codex"].map(provider => ({ provider, login: "pass", rotation: "pass", reopen: "pass", logout: "pass" })));
  expect(receipt.mockedTokenRequests).toBe(4);
  expect(receipt.unexpectedNetwork).toBe(0);
  expect(receipt.cliLogin).toBe("not_exercised");
  expect(receipt.webUi).toBe("not_exercised");
  expect(receipt.networkGuard).toBe("fetch_and_preconnect_only_no_os_network_sandbox");
  expect(Object.keys(receipt.sdkFileSha256)).toHaveLength(5);
  for (const [key, expected] of Object.entries(receipt.sdkFileSha256)) {
    if (typeof expected !== "string") throw new Error("Invalid SDK fingerprint receipt");
    const packageName = key.startsWith("@earendil-works/pi-ai/") ? "@earendil-works/pi-ai" : "@earendil-works/pi-coding-agent";
    const distPath = key.slice(`${packageName}/dist/`.length);
    const path = fileURLToPath(new URL(distPath, import.meta.resolve(packageName)));
    expect(createHash("sha256").update(readFileSync(path)).digest("hex")).toBe(expected);
  }
});
