import { expect, test } from "bun:test";
import { withTempWorkspaceEnv } from "../helpers.js";

test("cached auth statements rebind, observe revocation and expire across disk database lifecycles", async () => {
  await withTempWorkspaceEnv("web-session-cache-", {}, async () => {
    const child = Bun.spawn([process.execPath, "--no-env-file", new URL("../fixtures/web-session-cache-contracts.ts", import.meta.url).pathname], {
      env: { ...process.env, PICLAW_DB_IN_MEMORY: "0", PI_OFFLINE: "1", OTEL_SDK_DISABLED: "true" }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    try {
      const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(exit, stderr).toBe(0);
      const receipt = JSON.parse(stdout.trim().split("\n").at(-1)!);
      expect(receipt).toEqual({ status: "pass", bindings: true, externalRevocation: true, disabledUser: true, transactionSnapshot: true, rollback: true, expiry: true, legacyMigration: true, schemaReprepare: true, reopen: true, hotPathPrepares: 0, journal: "wal", synchronous: 2 });
    } finally { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; }
  });
}, 25_000);
