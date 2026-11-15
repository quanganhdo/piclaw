import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withTempWorkspaceEnv } from '../helpers.js';

for (const legacy of [
  { retentionMs: 123456, cleanupIntervalMs: 654321 },
  { retentionMs: 'PRIVATE_IGNORED_LEGACY', cleanupIntervalMs: { inactive: true } },
]) test(`retired agent-log controls preserve real logging and historical JSON: ${typeof legacy.retentionMs}`, async () => {
  await withTempWorkspaceEnv('retired-agent-log-controls-', {}, async ws => {
    mkdirSync(join(ws.workspace, '.piclaw'), { recursive: true });
    writeFileSync(join(ws.workspace, '.piclaw/config.json'), JSON.stringify({ domains: { logging: { level: 'warn', ...legacy } } }));
    writeFileSync(join(ws.workspace, '.env'), 'PICLAW_AGENT_LOG_RETENTION_MS=60000\nPICLAW_AGENT_LOG_RETENTION_DAYS=2\nPICLAW_AGENT_LOG_CLEANUP_INTERVAL_MS=7000\n');
    const child = Bun.spawn([process.execPath, '--no-env-file', new URL('../fixtures/retired-agent-log-controls.ts', import.meta.url).pathname], {
      cwd: ws.workspace,
      env: { ...process.env, PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data,
        PICLAW_LOG_LEVEL: undefined, LOG_LEVEL: undefined, PICLAW_AGENT_LOG_RETENTION_MS: '60000',
        PICLAW_AGENT_LOG_RETENTION_DAYS: '2', PICLAW_AGENT_LOG_CLEANUP_INTERVAL_MS: '7000' },
      stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    try {
      const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(exit, err).toBe(0);
      expect(JSON.parse(out.trim().split('\n').at(-1)!)).toEqual({ exportsRetired: true, aliasesRetired: true, legacyJsonAccepted: true, configBytesPreserved: true, loggingLevelPreserved: true, unknownKeysRefused: true });
      expect(err).not.toContain('PRIVATE_IGNORED_LEGACY');
    } finally { clearTimeout(timer); if (child.exitCode === null) child.kill('SIGKILL'); await child.exited; }
  });
});
