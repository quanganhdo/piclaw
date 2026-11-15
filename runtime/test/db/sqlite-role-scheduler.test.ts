import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

for (const scenario of ["file", "memory", "failure", "memory-failure", "memory-enable-failure"]) {
  test(`actual scheduler role lifecycle and checkpoint participation: ${scenario}`, async () => {
    const entry = fileURLToPath(new URL("../fixtures/sqlite-scheduler-roles.ts", import.meta.url));
    const launcher = fileURLToPath(new URL("../../scripts/local-test-priority.ts", import.meta.url));
    const cwd = fileURLToPath(new URL("../../", import.meta.url));
    const child = Bun.spawn([process.execPath, "--no-env-file", launcher, "--", "--cwd", cwd,
      "--env", `PICLAW_DB_IN_MEMORY=${scenario.startsWith("memory") ? "1" : "0"}`, "--", process.execPath, "--no-env-file", entry, scenario],
    { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
    try {
      const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(exit, err || out).toBe(0);
      const receipt = JSON.parse(out.trim().split("\n").at(-1)!);
      expect(receipt).toMatchObject({ scenario, schedulerRoles: true, noModelEffects: true });
    } finally { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; }
  }, 20000);
}
