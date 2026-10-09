import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
const historicalTest = JSON.parse(readFileSync(new URL("../../../node_modules/@earendil-works/pi-coding-agent/package.json", import.meta.url), "utf8")).version === "1.0.3" ? test : test.skip;
for (const mode of ["refresh-permanent", "refresh-transient", "malformed-storage", "refresh-retry-success"]) {
  historicalTest(`public runtime credential error isolation: ${mode}`, async () => {
    const child = Bun.spawn([process.execPath, "--no-env-file", resolve(import.meta.dir, "fixtures/provider-auth-stream-errors-103.ts"), mode], {
      env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: "/nonexistent", PI_OFFLINE: "1", PI_TELEMETRY: "0", OTEL_SDK_DISABLED: "true" }, stdout: "pipe", stderr: "pipe",
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
    try {
      const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(exit, err).toBe(0);
      const result = JSON.parse(out);
      expect(result).toMatchObject({ version: "1.0.3", mode, networkRequests: 0, inference: 0, logsRedacted: true });
      expect(result.results.every((row: { status: string }) => row.status === "pass")).toBe(true);
      expect(result.results.map((row: { method: string }) => row.method)).toEqual(mode === "refresh-retry-success" ? ["getAuth"] : ["stream", "streamSimple"]);
      expect(out).not.toContain("PRIVATE-STREAM-CREDENTIAL-SENTINEL");
      expect(err).not.toContain("PRIVATE-STREAM-CREDENTIAL-SENTINEL");
    } finally { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; }
  }, 20_000);
}
