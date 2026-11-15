import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { withTempWorkspaceEnv } from '../helpers.js';

for (const scenario of ['before', 'snapshot', 'bound', 'memory', 'memory-guard', 'cli']) {
  test(`database bootstrap snapshot and actual opened path: ${scenario}`, async () => {
    await withTempWorkspaceEnv('database-bootstrap-paths-', {}, async ws => {
      const args = [process.execPath, '--no-env-file', new URL('../fixtures/db-bootstrap-paths.ts', import.meta.url).pathname, scenario];
      if (scenario === 'cli') args.push('--workspace', join(ws.workspace, 'cli-workspace'));
      const child = Bun.spawn(args, { env: { ...process.env, PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store,
        PICLAW_DATA: ws.data, PICLAW_DB_IN_MEMORY: '0' }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
      const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
      try {
        const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        expect(exit, err).toBe(0);
        expect(JSON.parse(out.trim().split('\n').at(-1)!)).toEqual({ scenario, actualOpenedPathsVerified: true, explicitSnapshot: true, boundTargetPreserved: true });
      } finally { clearTimeout(timer); if (child.exitCode === null) child.kill('SIGKILL'); await child.exited; }
    });
  });
}
