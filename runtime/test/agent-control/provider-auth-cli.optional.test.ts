import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const enabled = process.env.PICLAW_RUN_AUTH_CLI_TESTS === "1" && process.env.PICLAW_E2E_DISPOSABLE === "1";
(enabled ? test : test.skip)("packaged 0.99.1 CLI authenticates and rejects synthetic OpenAI/Codex flows with mandatory OS egress isolation", async () => {
  const results = [];
  for (const provider of ["openai", "openai-codex"]) for (const mode of ["success", "denied", "bad-state", "cancel"]) {
    const root = mkdtempSync(join(tmpdir(), "piclaw-cli-auth-"));
    const child = Bun.spawn(["sudo", "-n", "unshare", "--net", "/bin/sh", "-c",
      'ip link set lo up && exec setpriv --reuid="$1" --regid="$2" --clear-groups --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs env -i PATH="$3" HOME=/nonexistent SYNTHETIC_EXPECT_UID="$1" timeout --kill-after=2s 65s "$4" --no-env-file "$5" "$6" "$7" "$8" "$9"',
      "cli-auth-namespace", String(process.getuid?.()), String(process.getgid?.()), `${dirname(process.execPath)}:/usr/bin:/bin`, process.execPath,
      resolve(import.meta.dir, "fixtures/packaged-cli-auth-0991.ts"), provider, mode, root, readlinkSync("/proc/self/ns/net")], {
      env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: "/nonexistent" }, stdout: "pipe", stderr: "pipe",
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 75_000);
    try {
      const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(exit, `${provider}/${mode}: ${err}`).toBe(0); expect(err).toBe("");
      const result = JSON.parse(out);
      expect(result).toMatchObject({ version: "0.99.1", provider, mode, status: "pass", unexpectedFetchRequests: 0, externalEgress: "os_namespace_denied", cliExit: "restored_editor_quit_0", inference: "not_invoked" });
      expect(result.tokenRequests).toBe(["success", "denied"].includes(mode) ? 1 : 0);
      const archived = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-0991-packaged-cli-auth-bun.json"), "utf8"));
      expect(result.bundleSha256).toBe(archived.bundleSha256);
      expect(result.sdkFileSha256).toEqual(archived.sdkFileSha256);
      expect(archived.packageIntegrity).toContain("sha512-");
      expect(createHash("sha256").update(readFileSync(resolve(import.meta.dir, "../../../bun.lock"))).digest("hex")).toBe(archived.lockSha256);
      results.push(result);
    } finally {
      clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited;
      rmSync(root, { recursive: true, force: true });
    }
  }
  expect(results).toHaveLength(8);
}, 600_000);
