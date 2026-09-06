import { expect, test } from "bun:test";
import { createTempWorkspace } from "./helpers.js";

const fixture = new URL("./fixtures/dream-family-boundary.ts", import.meta.url).pathname;
for (const scenario of ["entry", "backup", "agent-stages", "index", "startup-queue", "runtime-queue", "cleanup-lock"]) {
  test(`direct Dream boundary: ${scenario}`, async () => {
    const workspace = createTempWorkspace("dream-family-boundary-");
    try {
      // A child isolates Dream's bootstrap path constants and module mock from other suites.
      const child = Bun.spawn([process.execPath, "--no-env-file", "-e", `import { runScenario } from ${JSON.stringify(fixture)}; await runScenario(${JSON.stringify(scenario)});`], {
        cwd: new URL("..", import.meta.url).pathname,
        env: { ...process.env, PICLAW_WORKSPACE: workspace.workspace, PICLAW_STORE: workspace.store, PICLAW_DATA: workspace.data, PICLAW_DB_IN_MEMORY: "1", PICLAW_DREAM_MODEL: "" },
        stdout: "pipe", stderr: "pipe",
      });
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(code, stderr || stdout).toBe(0);
      expect(stdout).toContain(`DREAM_BOUNDARY_OK:${scenario}`);
    } finally { workspace.cleanup(); }
  }, 15_000);
}
