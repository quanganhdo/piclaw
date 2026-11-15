import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("shutdown ownership fixtures cannot falsely pass by exiting the test process", async () => {
  const runtime = resolve(import.meta.dir, "../..");
  const child = Bun.spawn([
    process.execPath, "run", resolve(runtime, "scripts/local-test-priority.ts"),
    "--", "--cwd", runtime, "--", "bun", "test",
    resolve(import.meta.dir, "../fixtures/bootstrap-backstop-isolation.ts"),
  ], { cwd: runtime, env: process.env, stdout: "pipe", stderr: "pipe" });
  const deadline = setTimeout(() => child.kill(), 10_000);
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    const output = stdout + stderr;
    expect(code, output).toBe(0);
    expect(output).toContain("PICLAW_BOOTSTRAP_SUITE_COMPLETED");
    // An early process.exit(0) is not a completed Bun test suite.
    expect(output).toMatch(/Ran \d+ tests? across \d+ files?/);
  } finally {
    clearTimeout(deadline);
    if (child.exitCode === null) { child.kill(); await child.exited; }
  }
}, 15_000);
