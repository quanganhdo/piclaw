import { expect, test } from 'bun:test';
import '../helpers.js';

for (const scenario of ['registration', 'started', 'service', 'gateway', 'failure']) {
  test(`pre-shutdown and web observation ownership: ${scenario}`, async () => {
    const child = Bun.spawn([process.execPath, '--no-env-file', new URL('../fixtures/web-observation-ownership.ts', import.meta.url).pathname, scenario], {
      env: process.env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    try {
      const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(exit, err).toBe(0);
      expect(JSON.parse(out.trim().split('\n').at(-1)!)).toEqual({ scenario, ownerRelease: true, noOldTimer: true, noReplay: true });
    } finally { clearTimeout(timer); if (child.exitCode === null) child.kill('SIGKILL'); await child.exited; }
  });
}
