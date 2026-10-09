import { expect, test } from "bun:test";
import { readFileSync, readlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";

const enabled = process.env.PICLAW_RUN_AUTH_BROWSER_MATRIX === "1" && process.env.PICLAW_E2E_DISPOSABLE === "1";
(enabled ? test : test.skip)("Pi 1.0.3 Anthropic browser/copy-code and OpenRouter public methods execute in an isolated namespace", async () => {
  const child = Bun.spawn(["sudo", "-n", "unshare", "--net", "/bin/sh", "-c",
    'ip link set lo up && exec setpriv --reuid="$1" --regid="$2" --clear-groups --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs env -i PATH="$3" HOME=/nonexistent PI_OFFLINE=1 PI_TELEMETRY=0 OTEL_SDK_DISABLED=true PI_OAUTH_CALLBACK_HOST=127.0.0.1 SYNTHETIC_PARENT_NETNS="$4" SYNTHETIC_EXPECT_UID="$1" timeout --kill-after=2s 30s "$5" --no-env-file "$6"',
    "browser-103-namespace", String(process.getuid?.()), String(process.getgid?.()), `${dirname(process.execPath)}:/usr/bin:/bin`, readlinkSync("/proc/self/ns/net"), process.execPath,
    resolve(import.meta.dir, "fixtures/provider-browser-matrix-103.mjs")], {
    env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: "/nonexistent" }, stdout: "pipe", stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 40_000);
  try {
    const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit, err).toBe(0); expect(err).toBe("");
    const executed = JSON.parse(out);
    const receipt = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-103-provider-browser-bun.json"), "utf8"));
    expect(executed).toEqual(receipt);
    expect(executed.results).toHaveLength(20); expect(executed.copyCodeResults).toHaveLength(17);
    for (const sentinel of ["synthetic-browser-access", "synthetic-browser-refresh", "synthetic-browser-rotated", "synthetic-browser-rotated-refresh", "synthetic-browser-code", "synthetic-openrouter-key", "synthetic-copy-code", "synthetic-copy-access", "synthetic-copy-refresh", "synthetic-copy-rotated", "synthetic-copy-refresh-rotated"]) expect(out).not.toContain(sentinel);
  } finally { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; }
}, 45_000);
