import { expect, test } from "bun:test";
import { withTempWorkspaceEnv } from "../helpers.js";

for (const mode of ["success", "settings-reload", "close-failure"] as const) {
  test(`public adapter shutdown consumer preserves sole ownership: ${mode}`, async () => {
    await withTempWorkspaceEnv("mcp-public-shutdown-consumer-", {}, async ws => {
      const child = Bun.spawn([process.execPath, "--no-env-file", new URL("fixtures/mcp-public-shutdown-consumer.ts", import.meta.url).pathname, mode, ws.workspace], {
        env: { ...process.env, PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0", OTEL_SDK_DISABLED: "true" }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      });
      const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
      try {
        const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        expect(code, err).toBe(0);
        const receipt = JSON.parse(out.split("\n").find(line => line.startsWith('{"mode"'))!);
        expect(receipt).toMatchObject({ mode, status: "pass", sdk: "1.0.3", externalNetwork: 0, providerExecution: false, singleOwner: true });
        if (mode === "close-failure") expect(receipt).toMatchObject({ replacementDenied: true, promptDenied: true, scopedLeaseHeld: true });
        else expect(receipt).toMatchObject({ historyPreserved: true, oldClosedBeforeNew: true });
        if (mode === 'settings-reload') expect(receipt).toMatchObject({ oldLeaseReleasedBeforeHydration: true, replacementCredentialGeneration: true });
      } finally { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; }
    });
  }, 25_000);
}
