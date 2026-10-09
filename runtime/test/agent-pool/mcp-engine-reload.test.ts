import { expect, test } from "bun:test";
import { dirname, resolve } from "node:path";

test("public SDK reload preserves chat/history and replaces synthetic owner tools behind the switch barrier", async () => {
  const child = Bun.spawn([process.execPath, "--no-env-file", resolve(import.meta.dir, "fixtures/mcp-engine-reload.ts")], {
    env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: "/nonexistent", PI_OFFLINE: "1", PI_TELEMETRY: "0", OTEL_SDK_DISABLED: "true" }, stdout: "pipe", stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
  try {
    const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit, err).toBe(0); expect(err).toBe("");
    expect(JSON.parse(out)).toEqual({ runtime: `Bun ${Bun.version}`, scope: "public_sdk_reload_lifecycle_with_synthetic_owner_factories", sessions: 2,
      preservedSessionIds: true, preservedHistory: true, allExtensionsReloaded: true, oldToolsRemoved: true, shutdownBeforeStartup: true,
      networkAttempts: 0, realMcpConnections: "not_exercised", activeAgentTurn: "not_exercised" });
  } finally { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; }
}, 20_000);
