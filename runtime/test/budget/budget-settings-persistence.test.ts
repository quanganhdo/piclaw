import { expect, test } from "bun:test";
import { createTempWorkspace } from "../helpers.js";

const entry = new URL("./budget-settings-persistence-subprocess.ts", import.meta.url).pathname;

test("Settings and slash status preserve the same durable state after restart", async () => {
  const workspace = createTempWorkspace("budget-settings-persistence-");
  try {
    const process = Bun.spawn(["bun", entry], {
      cwd: new URL("../../", import.meta.url).pathname,
      env: {
        ...processEnvWithoutInMemory(),
        PICLAW_WORKSPACE: workspace.workspace,
        PICLAW_STORE: workspace.store,
        PICLAW_DATA: workspace.data,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    expect(exitCode, stderr).toBe(0);
    const line = stdout.trim().split("\n").at(-1) || "{}";
    const result = JSON.parse(line);
    expect(result.after).toEqual(result.before);
    expect(result.before).toMatchObject({ id: "cap:restart", amount: 1_000_000, known_usage: 250_000, remaining: 750_000 });
    expect(result.slashAfter).toBe(result.slashBefore);
    expect(result.slashAfter).toContain("cap:restart");
  } finally {
    workspace.cleanup();
  }
});

function processEnvWithoutInMemory(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== "PICLAW_DB_IN_MEMORY") env[key] = value;
  }
  return env;
}
