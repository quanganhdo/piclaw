import { afterAll, beforeAll, expect, test } from "bun:test";
import { createTempWorkspace } from "../helpers.js";

const entry = new URL("./budget-settings-persistence-subprocess.ts", import.meta.url).pathname;
const workspace = createTempWorkspace("budget-settings-persistence-");
// Fresh schema creation is setup. The assertion phase still seeds, closes and
// reopens this same private disk database; each phase keeps a 15s deadline.
beforeAll(async () => { await runFixture("setup"); }, 15_000);
afterAll(() => workspace.cleanup());

test("Settings and slash status preserve the same durable state after restart", async () => {
  const result = await runFixture();
  expect(result.after).toEqual(result.before);
  expect(result.before).toMatchObject({ id: "cap:restart", amount: 1_000_000, known_usage: 250_000, remaining: 750_000 });
  expect(result.slashAfter).toBe(result.slashBefore);
  expect(result.slashAfter).toContain("cap:restart");
}, 15_000);

async function runFixture(mode?: "setup") {
  const child = Bun.spawn([process.execPath, "--no-env-file", entry, ...(mode ? [mode] : [])], {
    cwd: new URL("../../", import.meta.url).pathname,
    env: {
      ...processEnvWithoutInMemory(),
      PICLAW_WORKSPACE: workspace.workspace,
      PICLAW_STORE: workspace.store,
      PICLAW_DATA: workspace.data,
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  const timer = setTimeout(() => child.kill("SIGKILL"), 14_000);
  try {
    const [stdout, stderr, exitCode] = await output;
    if (mode) {
      if (exitCode !== 0) throw new Error(`Budget disk setup failed: ${stderr}`);
    } else {
      expect(exitCode, stderr).toBe(0);
    }
    return JSON.parse(stdout.trim().split("\n").at(-1) || "{}");
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill("SIGKILL");
    await child.exited;
  }
}

function processEnvWithoutInMemory(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== "PICLAW_DB_IN_MEMORY") env[key] = value;
  }
  return env;
}
