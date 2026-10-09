import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { createTempWorkspace } from "../helpers.js";

const fixture = new URL("../fixtures/context-projection-performance.ts", import.meta.url).href;
const cwd = fileURLToPath(new URL("../../", import.meta.url));
for (const scenario of [
  "bounded-reads", "event-loop-yield", "deterministic-output", "nested-output",
  "preserve-ineligible", "fresh-policy", "entry-gates", "revoke-at-yield",
  "abort-at-yield", "revoke-before-publish", "policy-request-snapshot",
  ...["revoke", "abort"].flatMap(action =>
    ["immediate", "microtask", "macrotask"].flatMap(timing =>
      ["legacy", "nested"].flatMap(shape =>
        [1, 64, 65].map(count => `publication-${action}-${timing}-${shape}-${count}`)))),
]) {
  test(`context projection performance/safety: ${scenario}`, async () => {
    const workspace = createTempWorkspace("context-projection-");
    let child: ReturnType<typeof Bun.spawn> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      // Inherit the launcher's filesystem isolation, isolate mocks per process,
      // and keep all fixtures synthetic. No model or production DB is accessed.
      child = Bun.spawn([
        process.execPath, "--no-env-file", "-e",
        `import { runScenario } from ${JSON.stringify(fixture)}; await runScenario(${JSON.stringify(scenario)});`,
      ], {
        cwd,
        env: { ...process.env, PICLAW_WORKSPACE: workspace.workspace, PICLAW_STORE: workspace.store, PICLAW_DATA: workspace.data, PICLAW_DB_IN_MEMORY: "1" },
        stdout: "pipe", stderr: "pipe",
      });
      timer = setTimeout(() => { timedOut = true; child?.kill(); }, 15000);
      const [code, stdout, stderr] = await Promise.all([
        child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
      ]);
      expect({ code, timedOut, stdout, stderr }).toEqual({ code: 0, timedOut: false, stdout: "", stderr: "" });
    } finally {
      clearTimeout(timer);
      if (child && child.exitCode === null) { child.kill(); await child.exited; }
      workspace.cleanup();
    }
  }, 20000);
}
