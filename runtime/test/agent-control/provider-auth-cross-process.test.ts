import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FileCredentialStore } from "../../src/agent-pool/credential-store.js";
import { createTempWorkspace } from "../helpers.js";

for (const scenario of ["rotate-once", "logout-after-refresh", "reject-then-success", "pre-write-holder-crash"]) {
  const slow = scenario === "pre-write-holder-crash";
  const runTest = slow && process.env.PICLAW_RUN_AUTH_CRASH_TESTS !== "1" ? test.skip : test;
  runTest(`public cross-process credential ownership: ${scenario}`, async () => {
    const ws = createTempWorkspace("cross-process-auth-");
    const agent = join(ws.base, "shared-agent");
    mkdirSync(agent, { mode: 0o700 });
    const authPath = join(agent, "auth.json");
    const store = new FileCredentialStore(authPath);
    await store.modify("synthetic-cross-process", async () => ({ type: "oauth", access: "synthetic-initial", refresh: "synthetic-initial-refresh", expires: 1 }));
    await store.modify("unrelated", async () => ({ type: "api_key", key: "synthetic-unrelated" }));
    type Worker = { child: ReturnType<typeof Bun.spawn>; wait: (event: string) => Promise<void>; send: (command: string) => void; finish: () => Promise<void>; cleanup: () => Promise<void> };
    const children: Worker[] = [];
    let refreshes = 0;
    function worker(name: string, operation: "auth" | "logout" | "auth-after-rejection"): Worker {
      const profile = join(ws.base, name);
      mkdirSync(profile, { mode: 0o700 });
      const child = Bun.spawn([process.execPath, "--no-env-file", join(import.meta.dir, "fixtures/provider-auth-cross-process-104.ts"), operation, authPath, profile, join(ws.base, "rejection-fence")], {
        env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: profile, PI_CODING_AGENT_DIR: profile, PICLAW_PI_AGENT_DIR: profile,
          PICLAW_WORKSPACE: profile, PICLAW_STORE: join(profile, "store"), PICLAW_DATA: join(profile, "data"), PI_OFFLINE: "1", PI_TELEMETRY: "0", OTEL_SDK_DISABLED: "true" },
        stdin: "pipe", stdout: "pipe", stderr: "pipe",
      });
      const events: string[] = [];
      const listeners: Array<{ event: string; resolve: () => void; reject: (error: Error) => void }> = [];
      const stderr = new Response(child.stderr).text();
      const stdout = (async () => {
        const reader = child.stdout.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          while (buffer.includes("\n")) {
            const end = buffer.indexOf("\n"), line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
            const event = (JSON.parse(line) as { event: string }).event;
            if (event === "refresh-entered") refreshes++;
            const index = listeners.findIndex(waiter => waiter.event === event);
            if (index >= 0) listeners.splice(index, 1)[0].resolve(); else events.push(event);
          }
        }
        for (const waiter of listeners.splice(0)) waiter.reject(new Error("Child exited before event"));
      })();
      const wait = (event: string) => {
        const found = events.indexOf(event);
        if (found >= 0) { events.splice(found, 1); return Promise.resolve(); }
        return new Promise<void>((resolve, reject) => listeners.push({ event, resolve, reject }));
      };
      const timer = setTimeout(() => child.kill("SIGKILL"), 25_000);
      const result = { child, wait, send: (command: string) => child.stdin.write(`${JSON.stringify({ command })}\n`),
        finish: async () => { const [exit, err] = await Promise.all([child.exited, stderr, stdout]).then(values => [values[0], values[1]] as const); clearTimeout(timer); expect(exit, err).toBe(0); expect(err).toBe(""); },
        cleanup: async () => { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; await stdout; },
      };
      children.push(result);
      return result;
    }
    try {
      const a = worker("a", "auth");
      await a.wait("ready");
      const b = slow ? null : worker("b", scenario === "logout-after-refresh" ? "logout" : scenario === "reject-then-success" ? "auth-after-rejection" : "auth");
      if (b) await b.wait("ready");
      a.send("go"); await a.wait("refresh-entered");
      if (slow) {
        const before = readFileSync(authPath, "utf8");
        expect(existsSync(`${authPath}.lock`)).toBe(true);
        expect(a.child.exitCode).toBeNull();
        a.child.kill("SIGKILL");
        await a.child.exited;
        expect(a.child.signalCode).toBe("SIGKILL");
        expect(readFileSync(authPath, "utf8")).toBe(before);
        expect(existsSync(`${authPath}.lock`)).toBe(true);
        await Bun.sleep(35_000); // Real unchanged proper-lockfile stale window.
        const successor = worker("successor", "auth");
        await successor.wait("ready"); successor.send("go");
        await successor.wait("refresh-entered"); successor.send("release");
        await successor.wait("resolved"); await successor.finish();
      } else {
      b!.send("go"); await b!.wait("operation-started");
      await b!.wait(scenario === "logout-after-refresh" ? "store-delete-started" : "store-read-started");
      if (scenario === "reject-then-success") {
        a.send("reject"); await a.wait("rejected");
        await b!.wait("refresh-entered"); b!.send("release"); await b!.wait("resolved");
      } else {
        a.send("release"); await a.wait("resolved");
        await b!.wait(scenario === "logout-after-refresh" ? "logout-done" : "resolved");
      }
      await Promise.all([a.finish(), b!.finish()]);
      }
      expect(refreshes).toBe(scenario === "reject-then-success" || slow ? 2 : 1);
      const final = await store.read("synthetic-cross-process");
      if (scenario === "logout-after-refresh") expect(final).toBeUndefined();
      else expect(final).toMatchObject({ type: "oauth", access: "synthetic-rotated", refresh: "synthetic-rotated-refresh" });
      expect(await store.read("unrelated")).toEqual({ type: "api_key", key: "synthetic-unrelated" });
      expect((await store.list()).map(row => row.providerId).sort()).toEqual(scenario === "logout-after-refresh" ? ["unrelated"] : ["synthetic-cross-process", "unrelated"]);
    } finally {
      try { await Promise.all(children.map(child => child.cleanup())); }
      finally { ws.cleanup(); }
    }
  }, slow ? 70_000 : 30_000);
}
