import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, readlinkSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const fingerprints: Record<string, string> = {
  "xai.js": "d34783560dc2ac75d6e717b248136eb75a902fbd53b3e56fb9f2ec50c6c793d7",
  "meta.js": "852ceb0cb0d14e92f78dbc5aacbe345e0416e3b65c574f6acc1f5191566b6870",
  "device-code.js": "8f197cc9af67be64b82939573d719d1b55388f96f2e53cb8c47f9618fc1297eb",
  "providers/xai.js": "e5d69e97c788ce044f6c225fb38c04ec5b04defa639c02abfb022b466a90b9e9",
  "providers/meta.js": "f0ba7b97a407336f30cfb230c4c32bece9e0fd23b0ebdbdae11503374e5ab44c",
  "auth/helpers.js": "afa67f03895ace888d574c0c86c226cab35521cecc51fe4c0320ba710fb32a97",
  "auth/oauth/load.js": "fb73105e414825e6c599ed8c00783fbd597fea1913e5625cc56910e27b761182",
};
const commonModes = ["pending-success", "slow-down", "denied", "malformed-device", "malformed-token", "unsafe-device-uri", "unsafe-complete-safe-basic", "unsafe-basic-safe-complete", "expiry", "initial-wait-cancel", "blocked-start-cancel", "blocked-poll-cancel", "pre-abort"];
test("Bun device receipt pins reviewed xAI/Meta SDK modules and all synthetic outcomes", () => {
  const receipt = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-0991-xai-meta-device-bun.json"), "utf8"));
  expect(receipt).toMatchObject({ version: "0.99.1", runtime: "Bun 1.4.2", scope: "public_xai_meta_device_and_refresh_methods_only", bootstrapRequests: 0,
    credentialPersistence: "none", inference: "not_invoked", networkGuard: "distinct_loopback_only_os_namespace_and_guarded_fetch" });
  expect(receipt.results.map((row: { provider: string; mode: string }) => [row.provider, row.mode])).toEqual(
    ["xai", "meta"].flatMap(provider => [...commonModes, ...(provider === "xai" ? ["refresh-preserves-token", "refresh-denied", "token-default-lifetime"] : ["mint-missing-key", "mint-session-expired", "blocked-mint-cancel", "refresh-session-expired"])].map(mode => [provider, mode])));
  expect(receipt.sdkFileSha256).toEqual(fingerprints);
  const root = import.meta.resolve("@earendil-works/pi-ai");
  for (const [file, expected] of Object.entries(fingerprints)) expect(createHash("sha256").update(readFileSync(fileURLToPath(new URL(file.includes("/") ? file : `auth/oauth/${file}`, root)))).digest("hex")).toBe(expected);
  for (const row of receipt.results) {
    expect(row.status).toBe("pass"); expect(row.requests.unexpected).toBe(0);
    expect(row.lateEvents).toBe(0); expect(row.lateRequests).toBe(0); expect(row.postSettlementObservationMs).toBe(100);
    expect(row.preAbortedFetchObserved).toBe(row.mode === "pre-abort");
    if (row.mode.startsWith("blocked-") || row.mode === "pre-abort") expect(row.transportCancellationObserved).toBe(true);
    if (row.mode === "pending-success" || row.mode === "slow-down") expect(row.backoffVerified).toBe(true);
  }
});

test("device qualification refuses ordinary-namespace execution before imports", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", resolve(import.meta.dir, "fixtures/xai-meta-device-0991.mjs")], {
    env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent", SYNTHETIC_PARENT_NETNS: readlinkSync("/proc/self/ns/net"), SYNTHETIC_EXPECT_UID: String(process.getuid?.()) }, stdout: "pipe", stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit).not.toBe(0); expect(out).toBe(""); expect(err).toContain("A distinct network namespace is required.");
  } finally { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; }
});
