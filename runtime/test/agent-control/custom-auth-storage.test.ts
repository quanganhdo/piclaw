import { expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createTempWorkspace } from "../helpers.js";

for (const scenario of ["new-key-and-logout", "blank-update-preserves-key", "keyless-local", "authenticated-local-preserves-key", "legacy-config-fails-closed", "malformed-config-fails-closed", "required-key-missing", "failed-login-restores-config", "committed-credential-sync-failure", "concurrent-custom-config", "blank-stored-key-rejected", "logout-delete-failure-retains-config", "same-provider-ordered-setup", "commit-window-blank-update"]) {
  test(`custom provider credential/config boundary: ${scenario}`, async () => {
    const ws = createTempWorkspace("custom-auth-");
    const agent = join(ws.base, "agent");
    mkdirSync(agent, { mode: 0o700 });
    const child = Bun.spawn([process.execPath, "--no-env-file", join(import.meta.dir, "fixtures/custom-auth-storage-0991.ts"), scenario, agent], {
      env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: ws.base, PICLAW_PI_AGENT_DIR: agent, PI_CODING_AGENT_DIR: agent,
        PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data, PI_OFFLINE: "1", PI_TELEMETRY: "0", OTEL_SDK_DISABLED: "true" },
      stdout: "pipe", stderr: "pipe",
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 25_000);
    try {
      const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(exit, err.slice(-2000)).toBe(0);
      expect(out.trim()).toBe(scenario);
      expect(err).toBe("");
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null) child.kill("SIGKILL");
      await child.exited;
      ws.cleanup();
    }
  }, 30_000);
}
