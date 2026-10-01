import { expect, test } from "bun:test";
import { readFileSync, readlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
const enabled = process.env.PICLAW_RUN_XAI_META_AUTH_TESTS === "1" && process.env.PICLAW_E2E_DISPOSABLE === "1";
(enabled ? test : test.skip)("Bun public xAI/Meta device flows qualify synthetic polling and refresh with mandatory namespace isolation", async () => {
  const child = Bun.spawn(["sudo", "-n", "unshare", "--net", "/bin/sh", "-c",
    'ip link set lo up && exec setpriv --reuid="$1" --regid="$2" --clear-groups --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs env -i PATH="$3" HOME=/nonexistent PI_OFFLINE=1 PI_TELEMETRY=0 OTEL_SDK_DISABLED=true SYNTHETIC_PARENT_NETNS="$4" SYNTHETIC_EXPECT_UID="$1" timeout --kill-after=2s 90s "$5" --no-env-file "$6"',
    "xai-meta-namespace", String(process.getuid?.()), String(process.getgid?.()), `${dirname(process.execPath)}:/usr/bin:/bin`, readlinkSync("/proc/self/ns/net"), process.execPath,
    resolve(import.meta.dir, "fixtures/xai-meta-device-0991.mjs")], {
    env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: "/nonexistent" }, stdout: "pipe", stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 100_000);
  try {
    const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit, err).toBe(0); expect(err).toBe("");
    const executed = JSON.parse(out);
    const receipt = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-0991-xai-meta-device-bun.json"), "utf8"));
    expect(executed.results).toEqual(receipt.results); expect(executed.sdkFileSha256).toEqual(receipt.sdkFileSha256);
    expect(executed).toMatchObject({ version: "0.99.1", runtime: `Bun ${Bun.version}`, scope: "public_xai_meta_device_and_refresh_methods_only", bootstrapRequests: 0,
      credentialPersistence: "none", inference: "not_invoked", networkGuard: "distinct_loopback_only_os_namespace_and_guarded_fetch" });
    expect(executed.results).toHaveLength(33);
    expect(out).not.toContain("SYNTHETIC-DEVICE-CODE"); expect(out).not.toContain("synthetic-xai-access");
    expect(out).not.toContain("synthetic-xai-refresh"); expect(out).not.toContain("synthetic-meta-identity"); expect(out).not.toContain("synthetic-meta-key");
  } finally { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; }
}, 110_000);
