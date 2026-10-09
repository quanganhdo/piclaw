import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
const enabled = process.env.PICLAW_RUN_AUTH_CLI_TESTS === "1" && process.env.PICLAW_E2E_DISPOSABLE === "1";
(enabled ? test : test.skip)("official 1.0.3 CLI qualifies isolated OpenAI/Codex login and provider-only rejection", async () => {
  const archived = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-103-packaged-cli-auth-bun.json"), "utf8"));
  const results = [];
  for (const provider of ["openai", "openai-codex"]) for (const mode of ["success", "denied", "bad-state", "cancel", "provider-only"]) {
    const root = mkdtempSync(join(tmpdir(), "piclaw-cli-103-"));
    const child = Bun.spawn(["sudo", "-n", "unshare", "--net", "/bin/sh", "-c",
      'ip link set lo up && exec setpriv --reuid="$1" --regid="$2" --clear-groups --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs env -i PATH="$3" HOME=/nonexistent SYNTHETIC_EXPECT_UID="$1" timeout --kill-after=2s 65s "$4" --no-env-file "$5" "$6" "$7" "$8" "$9"',
      "cli-103-namespace", String(process.getuid?.()), String(process.getgid?.()), `${dirname(process.execPath)}:/usr/bin:/bin`, process.execPath,
      resolve(import.meta.dir, "fixtures/packaged-cli-auth-103.ts"), provider, mode, root, readlinkSync("/proc/self/ns/net")], {
      env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: "/nonexistent" }, stdout: "pipe", stderr: "pipe",
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 75_000);
    try {
      const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(exit, `${provider}/${mode}: ${err}`).toBe(0); expect(err).toBe("");
      const result = JSON.parse(out);
      expect(result).toEqual(archived.results.find((row: { provider: string; mode: string }) => row.provider === provider && row.mode === mode));
      for (const value of ["synthetic-cli-refresh", "synthetic-cli-code", "synthetic-issued-client", "synthetic-cli-account", "eyJhbGciOiJub25lIn0"]) expect(out).not.toContain(value);
      results.push(result);
    } finally { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; rmSync(root, { recursive: true, force: true }); }
  }
  expect(results).toHaveLength(10);
}, 600_000);
