import { expect, test } from "bun:test";

// Keep the never-settling hook in a child process so the registry's run-once
// state and pending promise cannot affect sibling tests.
test("registered shutdown handler arms its deadline before extensible hooks", async () => {
  const script = `
    import { createShutdownHandler } from './src/runtime/shutdown.js';
    import { registerPreShutdownHook, registerShutdownHandler, requestGracefulShutdown } from './src/runtime/shutdown-registry.js';
    const calls = [];
    process.exit = (code) => { console.log(JSON.stringify({ code, calls, elapsed: Date.now() - started })); };
    registerPreShutdownHook(() => new Promise(() => {}));
    registerPreShutdownHook(() => { calls.push('later-hook-started'); });
    const shutdown = createShutdownHandler({
      stopIpcWatcher: async () => calls.push('ipc'),
      stopSchedulerLoop: () => calls.push('scheduler'),
      stopOptionalProviders: () => calls.push('providers'),
      queue: { shutdown: async () => calls.push('queue') },
      agentPool: { shutdown: async () => calls.push('agents') },
      web: { stop: async () => calls.push('web') },
    });
    registerShutdownHandler(shutdown);
    const started = Date.now();
    requestGracefulShutdown('test', 0);
    await Bun.sleep(6200);
  `;
  const child = Bun.spawn([process.execPath, "-e", script], {
    cwd: new URL("../..", import.meta.url).pathname,
    env: { PATH: process.env.PATH || "", HOME: process.env.HOME || "/tmp", PICLAW_TEST_FS_ISOLATION_ACTIVE: process.env.PICLAW_TEST_FS_ISOLATION_ACTIVE || "", PICLAW_TEST_FS_ISOLATION_ROOT: process.env.PICLAW_TEST_FS_ISOLATION_ROOT || "", PICLAW_WORKSPACE: process.env.PICLAW_WORKSPACE || "", PICLAW_STORE: process.env.PICLAW_STORE || "", PICLAW_DATA: process.env.PICLAW_DATA || "", PICLAW_PI_AGENT_DIR: process.env.PICLAW_PI_AGENT_DIR || "", PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR || "", XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || "", XDG_CACHE_HOME: process.env.XDG_CACHE_HOME || "", XDG_DATA_HOME: process.env.XDG_DATA_HOME || "", TMPDIR: process.env.TMPDIR || "/tmp", TMP: process.env.TMP || "/tmp", TEMP: process.env.TEMP || "/tmp" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(code, stderr || stdout).toBe(0);
  const line = stdout.trim().split("\n").find((value) => value.startsWith('{"code"'));
  expect(line).toBeDefined();
  const result = JSON.parse(line!);
  expect(result.code).toBe(0);
  expect(result.elapsed).toBeGreaterThanOrEqual(4900);
  expect(result.elapsed).toBeLessThan(6100);
  expect(result.calls).toEqual(["later-hook-started", "ipc", "scheduler", "providers", "queue", "agents", "web"]);
}, 10_000);
