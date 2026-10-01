import { expect, test } from "bun:test";
import { readFileSync, readlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
const enabled = process.env.PICLAW_RUN_RADIUS_AUTH_TESTS === "1" && process.env.PICLAW_E2E_DISPOSABLE === "1";
(enabled ? test : test.skip)("Bun public Radius browser/device/refresh methods execute in a mandatory network namespace", async () => {
  const child = Bun.spawn(["sudo", "-n", "unshare", "--net", "/bin/sh", "-c",
    'ip link set lo up && exec setpriv --reuid="$1" --regid="$2" --clear-groups --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs env -i PATH="$3" HOME=/nonexistent PI_OFFLINE=1 PI_TELEMETRY=0 OTEL_SDK_DISABLED=true SYNTHETIC_PARENT_NETNS="$4" SYNTHETIC_EXPECT_UID="$1" timeout --kill-after=2s 75s "$5" --no-env-file "$6"',
    "radius-namespace", String(process.getuid?.()), String(process.getgid?.()), `${dirname(process.execPath)}:/usr/bin:/bin`, readlinkSync("/proc/self/ns/net"), process.execPath,
    resolve(import.meta.dir, "fixtures/radius-auth-0991.mjs")], {
    env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: "/nonexistent" }, stdout: "pipe", stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 85_000);
  try {
    const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit, err).toBe(0); expect(err).toBe("");
    const executed = JSON.parse(out);
    const receipt = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-0991-radius-auth-bun.json"), "utf8"));
    expect(executed.results).toEqual(receipt.results); expect(executed.sdkFileSha256).toEqual(receipt.sdkFileSha256);
    expect(executed).toMatchObject({ version: "0.99.1", runtime: `Bun ${Bun.version}`, scope: "public_radius_browser_device_refresh_methods_only", bootstrapRequests: 0,
      credentialPersistence: "none", inference: "not_invoked", networkGuard: "distinct_loopback_only_os_namespace_guarded_fetch_owned_ipv4_callback" });
    expect(executed.results).toHaveLength(17);
    for (const sentinel of ["synthetic-radius-access", "synthetic-radius-refresh", "synthetic-radius-code", "SYNTHETIC-RADIUS-CODE"]) expect(out).not.toContain(sentinel);
  } finally { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; }
}, 95_000);
