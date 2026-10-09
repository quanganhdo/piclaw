import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { createTempWorkspace } from '../helpers.js';

async function child(fixture: string, args: string[], offline: boolean) {
  const workspace = createTempWorkspace('pi103-soak-');
  const env: Record<string, string> = {
    PATH: process.env.PATH!, HOME: process.env.HOME!,
    PICLAW_TEST_FS_ISOLATION_ACTIVE: process.env.PICLAW_TEST_FS_ISOLATION_ACTIVE!,
    PICLAW_TEST_FS_ISOLATION_ROOT: process.env.PICLAW_TEST_FS_ISOLATION_ROOT!,
    PICLAW_WORKSPACE: workspace.workspace, PICLAW_STORE: workspace.store, PICLAW_DATA: workspace.data,
    PICLAW_PI_AGENT_DIR: join(workspace.base, 'agent'), PI_CODING_AGENT_DIR: join(workspace.base, 'agent'),
    XDG_CONFIG_HOME: join(workspace.base, 'config'), XDG_CACHE_HOME: join(workspace.base, 'cache'), XDG_DATA_HOME: join(workspace.base, 'xdg-data'),
    TMPDIR: process.env.TMPDIR!, PICLAW_DB_IN_MEMORY: '0', PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1', PI_TELEMETRY: '0', OTEL_SDK_DISABLED: 'true',
  };
  const command = [process.execPath, '--no-env-file'];
  if (offline) command.push('--preload', join(import.meta.dir, '../agent-pool/fixtures/earendil-103-offline-guard.ts'));
  command.push(join(import.meta.dir, '../fixtures', fixture), ...args);
  const processChild = Bun.spawn(command, { cwd: join(import.meta.dir, '../..'), env, stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => processChild.kill('SIGKILL'), 20000);
  try {
    const [exit, out, err] = await Promise.all([processChild.exited, new Response(processChild.stdout).text(), new Response(processChild.stderr).text()]);
    expect(exit, err || out).toBe(0);
    return JSON.parse(out.trim().split('\n').at(-1)!);
  } finally {
    clearTimeout(timer);
    if (processChild.exitCode === null) { processChild.kill('SIGKILL'); await processChild.exited; }
    workspace.cleanup();
  }
}

test('scheduler uses actual AgentPool and restores the real SDK branch without outbound authority', async () => {
  const result = await child('pi103-scheduler-agent.ts', [], true);
  expect(result).toMatchObject({ providerCalls: 2, deliveries: 1, realAgentPool: true, realSessionConstruction: true, realLeafRestored: true, scheduledBranchPersisted: true, scheduledBranchExcludedFromActiveContext: true, durableSourceSettled: true, recurrenceVerified: true, networkAttempts: 0, childProcessAttempts: 0 });
  expect(result.entriesAfter).toBeGreaterThan(result.entriesBefore);
}, 25000);

for (const shape of ['linear', 'branched', 'tools']) test(`public history soak checks ${shape} context and held controls without forced GC`, async () => {
  const entries = shape === 'tools' ? 102 : 100;
  const result = await child('pi103-history-soak.ts', [shape, String(entries), '1000'], false);
  expect(result).toMatchObject({ shape, entries, contextMessages: shape === 'branched' ? 10 : entries, explicitGcCalls: 0, retainedControls: 3, noHeldFinalizers: true });
  expect(result.openedDroppedManagers).toBeGreaterThanOrEqual(3);
  expect(result.naturalFinalizedManagers).toBeLessThanOrEqual(result.openedDroppedManagers);
  expect(result.samples.length).toBeGreaterThanOrEqual(1);
}, 25000);
