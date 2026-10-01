import { expect, test } from "bun:test";
import { readFileSync, readlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
const commonModes = ["manual-success", "callback-success", "callback-invalid-first", "callback-denied", "token-denied", "malformed-json", "cancel-prompt", "cancel-exchange", "pre-abort"];
const enabled = process.env.PICLAW_RUN_AUTH_BROWSER_MATRIX === "1" && process.env.PICLAW_E2E_DISPOSABLE === "1";
(enabled ? test : test.skip)("public Anthropic/OpenRouter methods execute the pinned synthetic matrix with mandatory namespace isolation", async () => {
  const child = Bun.spawn(["sudo", "-n", "unshare", "--net", "/bin/sh", "-c",
    'ip link set lo up && exec setpriv --reuid="$1" --regid="$2" --clear-groups --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs env -i PATH="$3" HOME=/nonexistent PI_OFFLINE=1 PI_TELEMETRY=0 OTEL_SDK_DISABLED=true PI_OAUTH_CALLBACK_HOST=127.0.0.1 SYNTHETIC_PARENT_NETNS="$4" SYNTHETIC_EXPECT_UID="$1" timeout --kill-after=2s 15s "$5" --no-env-file "$6"',
    "provider-browser-namespace", String(process.getuid?.()), String(process.getgid?.()), `${dirname(process.execPath)}:/usr/bin:/bin`, readlinkSync("/proc/self/ns/net"), process.execPath,
    resolve(import.meta.dir, "fixtures/provider-browser-matrix-0991.mjs")], {
    env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: "/nonexistent" }, stdout: "pipe", stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
  try {
    const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit, err).toBe(0); expect(err).toBe("");
    const executed = JSON.parse(out);
    expect(executed.results.map((row: { provider: string; mode: string }) => [row.provider, row.mode])).toEqual(
      ["anthropic", "openrouter"].flatMap(provider => [...commonModes, provider === "anthropic" ? "manual-bad-state" : "missing-key"].map(mode => [provider, mode])));
    expect(executed.results.every((row: { status: string; requests: { unexpected: number } }) => row.status === "pass" && row.requests.unexpected === 0)).toBe(true);
    expect(executed.credentialPersistence).toBe("none"); expect(executed.inference).toBe("not_invoked");
    expect(executed.bootstrapRequests).toBe(0);
    expect(executed.networkGuard).toBe("distinct_loopback_only_os_namespace_guarded_fetch_and_owned_ipv4_callbacks");
    for (const runtime of ["bun", "node"]) {
      const receipt = JSON.parse(readFileSync(resolve(import.meta.dir, `../../../docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-0991-provider-browser-${runtime}.json`), "utf8"));
      expect(receipt.results).toEqual(executed.results); expect(receipt.sdkFileSha256).toEqual(executed.sdkFileSha256);
      expect(receipt.scope).toBe("public_anthropic_openrouter_browser_manual_methods_only");
      expect(receipt.runtime).toMatch(runtime === "node" ? /^Node / : /^Bun /);
    }
    expect(out).not.toContain("synthetic-browser-access"); expect(out).not.toContain("synthetic-browser-refresh");
    expect(out).not.toContain("synthetic-openrouter-key"); expect(out).not.toContain("synthetic-browser-code");
  } finally { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; }
}, 25_000);
