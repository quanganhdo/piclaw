import { expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { createTempWorkspace } from "../helpers.js";

const fixturePath = join(import.meta.dir, "fixtures", "provider-auth-lifecycle-104.ts");
const scenarios = [
  "login-persist-recreate-logout",
  "expired-get-auth-rotates",
  "concurrent-cross-runtime-refresh-once",
  "invalid-grant-preserves-credential",
  "cancel-reject-login-preserves-credential",
  "api-key-stored-ambient-logout",
];

for (const scenario of scenarios) {
  test(`offline provider auth lifecycle: ${scenario}`, async () => {
    const workspace = createTempWorkspace(`provider-auth-${scenario}-`);
    const home = join(workspace.base, "home");
    const agentDir = join(workspace.base, "pi-agent");
    mkdirSync(home, { recursive: true });
    mkdirSync(agentDir, { recursive: true });

    try {
      const child = Bun.spawn(
        [process.execPath, "--no-env-file", fixturePath, scenario, workspace.base],
        {
          cwd: join(import.meta.dir, "../.."),
          env: {
            PATH: "/usr/local/lib/bun/bin:/usr/local/bin:/usr/bin:/bin",
            HOME: home,
            PI_CODING_AGENT_DIR: agentDir,
            PICLAW_PI_AGENT_DIR: agentDir,
            PICLAW_WORKSPACE: workspace.workspace,
            PICLAW_STORE: workspace.store,
            PICLAW_DATA: workspace.data,
            PI_OFFLINE: "1",
            PI_TELEMETRY: "0",
            OTEL_SDK_DISABLED: "true",
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const kill = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 30_000);
      try {
        const [exitCode, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        expect(exitCode, stderr || stdout).toBe(0);
        expect(stderr).toBe("");
        expect(stdout.trim()).toBe(scenario);
      } finally {
        clearTimeout(kill);
        if (child.exitCode === null) child.kill("SIGKILL");
        await child.exited;
      }
    } finally {
      workspace.cleanup();
    }
  }, 35_000);
}
