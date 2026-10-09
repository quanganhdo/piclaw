import { expect, test } from 'bun:test';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runStatus, sourceIdentity, testCounts } from '../../../scripts/local-ci-receipt';

const script = resolve(import.meta.dir, '../../../scripts/local-ci-receipt.ts');
function fixture() {
  const parent = mkdtempSync(join(tmpdir(), 'ci-receipt-'));
  const root = join(parent, 'source');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  copyFileSync(script, join(root, 'scripts/local-ci-receipt.ts'));
  writeFileSync(join(root, 'BUN_VERSION'), `${Bun.version}\n`);
  writeFileSync(join(root, 'bun.lock'), 'test lock\n');
  writeFileSync(join(root, 'package.json'), '{}\n');
  writeFileSync(join(root, 'Makefile'), "ci-fast:\n\t@printf ' 3 pass\\n 1 skip\\n 0 fail\\n'\n");
  const git = (...args: string[]) => {
    const p = Bun.spawnSync(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
    if (p.exitCode) throw Error(p.stderr.toString());
    return p.stdout.toString().trim();
  };
  git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com');
  git('remote', 'add', 'origin', 'https://user:PRIVATE_TOKEN@example.com/repo.git');
  git('add', '.'); git('commit', '-qm', 'fixture');
  return { parent, root, git, output: join(parent, 'receipts'), cleanup: () => rmSync(parent, { recursive: true, force: true }) };
}

function receipt(output: string): any {
  return JSON.parse(readFileSync(join(output, readdirSync(output).find(name => name.endsWith('.json'))!), 'utf8'));
}

test('source identity binds commit/tree/lock/config/runtime/command and dirty state', () => {
  const f = fixture();
  try {
    const before = sourceIdentity(f.root, 'make ci-fast');
    expect(before.clean).toBe(true);
    expect(before.commit).toBe(f.git('rev-parse', 'HEAD'));
    expect(before.tree).toBe(f.git('rev-parse', 'HEAD^{tree}'));
    expect(runStatus(before, before, 0, false)).toBe('passed');
    expect(runStatus(before, before, 1, false)).toBe('failed');
    expect(runStatus(before, before, 0, true)).toBe('interrupted');
    expect(runStatus(before, before, null, false)).toBe('interrupted');
    for (const key of ['commit', 'tree', 'lockHash', 'configHash', 'actualBun', 'commandHash']) {
      expect(runStatus(before, { ...before, [key]: 'changed' }, 0, false)).toBe('invalid-source');
    }
    expect(runStatus({ ...before, clean: false }, before, 0, false)).toBe('invalid-source');
    const wrongBun = { ...before, actualBun: '0.0.0' };
    expect(runStatus(wrongBun, wrongBun, 0, false)).toBe('invalid-toolchain');
    writeFileSync(join(f.root, 'bun.lock'), 'changed');
    const after = sourceIdentity(f.root, 'make ci-fast');
    expect(after.clean).toBe(false);
    expect(after.lockHash).not.toBe(before.lockHash);
    expect(after.configHash).not.toBe(before.configHash);
    expect(sourceIdentity(f.root, 'custom').commandHash).not.toBe(before.commandHash);
  } finally { f.cleanup(); }
});

test('counts stay unknown without summaries and sum each test subprocess', () => {
  expect(testCounts('private unrelated output')).toBeNull();
  expect(testCounts(' 3 pass\n 1 skip\n 0 fail\n 2 pass\n 0 fail\n'))
    .toEqual({ passed: 5, skipped: 1, failed: 0, summaries: 2 });
});

for (const scenario of ['pass', 'failed', 'dirty', 'mutation', 'custom']) {
  test(`private receipt ${scenario} never invents capabilities or leaks raw metadata`, () => {
    const f = fixture();
    try {
      let command = 'make ci-fast';
      if (scenario === 'failed') { writeFileSync(join(f.root, 'Makefile'), 'ci-fast:\n\t@exit 2\n'); f.git('add', '.'); f.git('commit', '-qm', 'failure'); }
      if (scenario === 'mutation') { writeFileSync(join(f.root, 'Makefile'), 'ci-fast:\n\t@echo changed >> bun.lock\n'); f.git('add', '.'); f.git('commit', '-qm', 'mutation'); }
      if (scenario === 'dirty') writeFileSync(join(f.root, 'untracked'), 'dirty');
      if (scenario === 'custom') command = 'printf PRIVATE_LOG';
      const p = Bun.spawnSync([process.execPath, script, f.root, f.output, command], { stdout: 'pipe', stderr: 'pipe' });
      const r = receipt(f.output);
      expect(r.status).toBe(['pass', 'custom'].includes(scenario) ? 'passed' : scenario === 'failed' ? 'failed' : 'invalid-source');
      expect(p.exitCode === 0).toBe(['pass', 'custom'].includes(scenario));
      expect(r.capabilities.browser.status).toBe('not-run');
      expect(r.capabilities.integration.status).toBe('not-run');
      expect(r.capabilities.e2e.status).toBe('not-run');
      expect(r.capabilities['install-smoke'].status).toBe('not-run');
      if (scenario === 'custom') expect(r.capabilities['ci-fast'].status).toBe('not-run');
      else expect(r.capabilities['ci-fast'].status).toBe(r.status);
      const text = JSON.stringify(r);
      expect(text).not.toContain('PRIVATE_TOKEN');
      expect(text).not.toContain('PRIVATE_LOG');
      expect(statSync(f.output).mode & 0o777).toBe(0o700);
      for (const path of readdirSync(f.output)) expect(statSync(join(f.output, path)).mode & 0o777).toBe(0o600);
      expect(r.log.sha256).toMatch(/^[a-f0-9]{64}$/);
    } finally { f.cleanup(); }
  });
}

test('SIGTERM records interruption, never a passing capability', async () => {
  const f = fixture();
  try {
    const p = Bun.spawn([process.execPath, script, f.root, f.output, 'exec sleep 30'], { stdout: 'ignore', stderr: 'ignore' });
    for (let i = 0; i < 100 && !readdirSync(f.parent).includes('receipts'); i++) await Bun.sleep(10);
    // Wait until the initial non-passing receipt is durable before interrupting.
    for (let i = 0; i < 100 && (!readdirSync(f.output).some(n => n.endsWith('.log'))); i++) await Bun.sleep(10);
    await Bun.sleep(50);
    p.kill('SIGTERM');
    expect(await p.exited).not.toBe(0);
    expect(receipt(f.output).status).toBe('interrupted');
    expect(receipt(f.output).capabilities['ci-fast'].status).toBe('not-run');
  } finally { f.cleanup(); }
}, 5000);
