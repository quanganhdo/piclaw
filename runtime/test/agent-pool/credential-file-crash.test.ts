import { expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createTempWorkspace } from "../helpers.js";
for (const stage of ["partial", "before-rename", "after-rename"]) {
  test(`owned process loss at atomic credential checkpoint: ${stage}`, async () => {
    const ws = createTempWorkspace("atomic-auth-crash-");
    const path = join(ws.base, "auth.json");
    const old = '{"provider":{"type":"oauth","refresh":"synthetic-old"}}\n';
    const current = '{"provider":{"type":"oauth","refresh":"synthetic-new"}}\n';
    writeFileSync(path, old, { mode: 0o600 });
    const child = Bun.spawn([process.execPath, "--no-env-file", join(import.meta.dir, "fixtures/credential-file-kill.ts"), stage, path], {
      env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: ws.base, PI_OFFLINE: "1", OTEL_SDK_DISABLED: "true" }, stdout: "pipe", stderr: "pipe",
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    try {
      const reader = child.stdout.getReader();
      const { value } = await reader.read();
      expect(new TextDecoder().decode(value)).toBe("blocked\n");
      expect(child.exitCode).toBeNull();
      child.kill("SIGKILL"); await child.exited;
      expect(child.signalCode).toBe("SIGKILL");
      expect(await new Response(child.stderr).text()).toBe("");
      expect(readFileSync(path, "utf8")).toBe(stage === "after-rename" ? current : old);
      expect(JSON.parse(readFileSync(path, "utf8")).provider.refresh).toBe(stage === "after-rename" ? "synthetic-new" : "synthetic-old");
      const staging = readdirSync(ws.base).filter(name => name.endsWith(".tmp"));
      expect(staging).toHaveLength(stage === "after-rename" ? 0 : 1);
      for (const file of staging) expect(statSync(join(ws.base, file)).mode & 0o777).toBe(0o600);
    } finally {
      clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; ws.cleanup();
    }
  }, 7000);
}
