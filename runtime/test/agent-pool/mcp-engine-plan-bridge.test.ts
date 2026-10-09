import { expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
for (const mode of ["mapped", "adapter-only", "quarantined"]) {
  test(`actual revisioned MCP bridge feeds the engine planner: ${mode}`, async () => {
    const child = Bun.spawn([process.execPath, "--no-env-file", resolve(import.meta.dir, "fixtures/mcp-engine-plan-bridge.ts"), mode], {
      env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: "/nonexistent", PI_OFFLINE: "1", PI_TELEMETRY: "0", OTEL_SDK_DISABLED: "true" }, stdout: "pipe", stderr: "pipe",
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    try {
      const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(exit, err).toBe(0);
      const lines = out.trim().split("\n");
      expect(JSON.parse(lines.at(-1)!)).toMatchObject({ mode, status: "pass", network: 0, secretsExported: false });
      expect(out + err).not.toContain("PRIVATE-BRIDGE-SENTINEL");
    } finally { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; }
  }, 15_000);
}
