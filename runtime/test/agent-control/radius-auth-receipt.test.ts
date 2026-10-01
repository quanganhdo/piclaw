import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, readlinkSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const fingerprints: Record<string, string> = {
  "auth/oauth/radius.js": "60fc2bbff997b56f312bb3707ea20345e5de83a2d75d1a6c6d5d9af173021638",
  "auth/oauth/callback-server.js": "2dda468f4937edcf7bb5e8528de4bf7753efbe5b48610a3f9ea47ff2c4908ede",
  "auth/oauth/device-code.js": "8f197cc9af67be64b82939573d719d1b55388f96f2e53cb8c47f9618fc1297eb",
  "auth/oauth/pkce.js": "d54668654e89d6fe6994a09a7f9399e732a411fcb31c99eb8b5e60349763708c",
  "providers/radius.js": "c50694f71a7cac5d15630b3d8c2e7dee830eb756b4296f899899e7729889969e",
  "providers/radius-config.js": "d9d863bda4b33f3d98c2717c912cc7f394b93301f9c87d73adc7c8c7e8f8cb5e",
  "auth/helpers.js": "afa67f03895ace888d574c0c86c226cab35521cecc51fe4c0320ba710fb32a97",
  "auth/oauth/load.js": "fb73105e414825e6c599ed8c00783fbd597fea1913e5625cc56910e27b761182",
};
const modes = ["browser-success", "browser-bad-state-first", "browser-denied", "browser-token-denied", "browser-discovery-malformed", "browser-cancel", "device-pending-success", "device-slow-down", "device-denied", "device-malformed", "device-expiry", "device-poll-cancel", "device-wait-cancel", "refresh-success", "refresh-denied", "unknown-selection", "pre-abort"];
test("Bun Radius receipt pins reviewed SDK modules and seventeen synthetic outcomes", () => {
  const receipt = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-0991-radius-auth-bun.json"), "utf8"));
  expect(receipt).toMatchObject({ version: "0.99.1", runtime: "Bun 1.4.2", scope: "public_radius_browser_device_refresh_methods_only", bootstrapRequests: 0,
    credentialPersistence: "none", inference: "not_invoked", networkGuard: "distinct_loopback_only_os_namespace_guarded_fetch_owned_ipv4_callback" });
  expect(receipt.results.map((row: { mode: string }) => row.mode)).toEqual(modes);
  expect(receipt.sdkFileSha256).toEqual(fingerprints);
  const root = import.meta.resolve("@earendil-works/pi-ai");
  for (const [file, expected] of Object.entries(fingerprints)) expect(createHash("sha256").update(readFileSync(fileURLToPath(new URL(file, root)))).digest("hex")).toBe(expected);
  for (const row of receipt.results) {
    expect(row.status).toBe("pass"); expect(row.requests.unexpected).toBe(0); expect(row.callbackPortReleased).toBe(true);
    expect(row.lateEvents).toBe(0); expect(row.lateRequests).toBe(0); expect(row.postSettlementObservationMs).toBe(100);
    expect(row.preAbortPromptObserved).toBe(row.mode === "pre-abort");
    const success = ["browser-success", "browser-bad-state-first", "device-pending-success", "device-slow-down", "refresh-success"].includes(row.mode);
    expect(row.requests.discovery).toBe(row.mode.startsWith("browser-") ? 1 : 0);
    expect(row.requests.device).toBe(row.mode.startsWith("device-") ? 1 : 0);
    expect(row.requests.token).toBe(["browser-success", "browser-bad-state-first", "browser-token-denied", "device-denied", "device-expiry", "device-poll-cancel", "device-wait-cancel"].includes(row.mode) ? 1 : ["device-pending-success", "device-slow-down"].includes(row.mode) ? 2 : 0);
    expect(row.requests.refresh).toBe(success || row.mode === "refresh-denied" ? 1 : 0);
    expect(row.requests.callback).toBe(row.mode === "browser-bad-state-first" ? 2 : ["browser-success", "browser-token-denied", "browser-denied"].includes(row.mode) ? 1 : 0);
    expect(row.deviceEventObserved).toBe(row.mode.startsWith("device-") && row.mode !== "device-malformed");
    expect(row.timingVerified).toBe(["device-pending-success", "device-slow-down", "device-expiry"].includes(row.mode));
    expect(row.transportCancellationObserved).toBe(row.mode === "device-poll-cancel");
  }
});

test("Radius executable fixture refuses ordinary-namespace execution before SDK imports", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", resolve(import.meta.dir, "fixtures/radius-auth-0991.mjs")], {
    env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent", SYNTHETIC_PARENT_NETNS: readlinkSync("/proc/self/ns/net"), SYNTHETIC_EXPECT_UID: String(process.getuid?.()) }, stdout: "pipe", stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit).not.toBe(0); expect(out).toBe(""); expect(err).toContain("A distinct network namespace is required.");
  } finally { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; }
});
