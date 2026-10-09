import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { createTempWorkspace } from "../../helpers.js";

test("picker HTTP handler preserves authority and reports SQLite contention as retryable", async () => {
  const ws = createTempWorkspace("picker-handler-contention-");
  const child = Bun.spawn([process.execPath, "--no-env-file", fileURLToPath(new URL("../../fixtures/picker-pins-contention.ts", import.meta.url))], {
    env: { ...process.env, PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data, PICLAW_DB_IN_MEMORY: "0" },
    stdout: "pipe", stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try {
    const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit, err || out).toBe(0); expect(err).toBe(""); expect(out).toContain("PICKER_CONTENTION_OK");
  } finally { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; ws.cleanup(); }
}, 15_000);
