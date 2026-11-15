import { expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createTempWorkspace } from "../helpers.js";

for (const scenario of ["success", "persistent", "throw", "errors", "aborted", "reject", "cancel-before", "owner-before", "cancel-during", "owner-during", "dispose-during", "logout-during", "native-success", "native-owner-before", "native-dispose-during", "native-logout-during", "native-confirm", "native-logout-sync"]) {
  test(`saved OAuth login local synchronization recovery: ${scenario}`, async () => {
    const ws = createTempWorkspace("login-sync-");
    const agent = join(ws.base, "agent");
    mkdirSync(agent, { mode: 0o700 });
    const child = Bun.spawn([process.execPath, "--no-env-file", join(import.meta.dir, "fixtures/login-sync-recovery.ts"), scenario, agent], {
      env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: ws.base, PICLAW_PI_AGENT_DIR: agent, PI_CODING_AGENT_DIR: agent,
        PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data, PI_OFFLINE: "1", PI_TELEMETRY: "0", OTEL_SDK_DISABLED: "true" },
      stdout: "pipe", stderr: "pipe",
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 25_000);
    try {
      const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      // Check leaks before displaying diagnostics: SDK exceptions contain the
      // credential itself, and their cause can also contain secrets.
      expect(out + err).not.toContain("SYNTHETIC-SAVED-OAUTH-SECRET");
      expect(out + err).not.toContain("SYNTHETIC-CAUSE-SECRET");
      expect(exit, err.slice(-2000)).toBe(0);
      expect(out).toContain(scenario);
      const warnings = err.trim() ? err.trim().split("\n").map(line => JSON.parse(line)) : [];
      const savedFailure = ["persistent", "throw", "errors", "aborted", "native-logout-sync"].includes(scenario);
      expect(warnings).toHaveLength(savedFailure || scenario === "reject" ? 1 : 0);
      for (const warning of warnings) {
        expect(warning.operation).toBe(scenario === "native-logout-sync" ? "agent_control_login.native_control_failed" : "agent_control_login.runtime_login_failed");
        expect(warning.outcome).toBe(savedFailure ? "saved_credentials_sync_failed" : "failed");
        expect(Object.keys(warning).sort()).toEqual(["ts", "level", "module", "operation", "message", "outcome"].sort());
      }
      expect(out + err).not.toContain("synthetic-login-sync");
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null) child.kill("SIGKILL");
      await child.exited;
      ws.cleanup();
    }
  }, 30_000);
}
