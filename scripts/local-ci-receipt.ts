#!/usr/bin/env bun
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const capabilities = ['ci-fast', 'browser', 'install-smoke', 'integration', 'e2e'] as const;
export function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
function git(root: string, ...args: string[]): string {
  const result = Bun.spawnSync(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) throw new Error(`git ${args[0]} failed`);
  return result.stdout.toString().trim();
}

export function sourceIdentity(root: string, command: string) {
  const paths = git(root, 'ls-files', '-z').split('\0').filter(path =>
    /^(Makefile|package\.json|bun\.lock|BUN_VERSION|RESTIC_VERSION)$/.test(path) ||
    /^(scripts\/|runtime\/scripts\/|\.github\/workflows\/)/.test(path) ||
    /(?:^|\/)(?:tsconfig[^/]*\.json|bunfig\.toml)$/.test(path)).sort();
  const configs = Object.fromEntries(paths.map(path => [path,
    existsSync(join(root, path)) ? digest(readFileSync(join(root, path))) : null]));
  const origin = git(root, 'config', '--get', 'remote.origin.url');
  return {
    repositoryHash: digest(origin),
    commit: git(root, 'rev-parse', 'HEAD'),
    tree: git(root, 'rev-parse', 'HEAD^{tree}'),
    clean: git(root, 'status', '--porcelain', '--untracked-files=all') === '',
    lockHash: digest(readFileSync(join(root, 'bun.lock'))),
    pinnedBun: readFileSync(join(root, 'BUN_VERSION'), 'utf8').trim(),
    actualBun: Bun.version,
    commandHash: digest(command),
    configHash: digest(JSON.stringify(configs)),
  };
}

export function testCounts(log: string) {
  const totals = { passed: 0, skipped: 0, failed: 0, summaries: 0 };
  for (const match of log.replace(/\x1b\[[0-9;]*m/g, '').matchAll(/^\s*(\d+) (pass|skip|fail)\s*$/gm)) {
    if (match[2] === 'pass') { totals.passed += Number(match[1]); totals.summaries++; }
    if (match[2] === 'skip') totals.skipped += Number(match[1]);
    if (match[2] === 'fail') totals.failed += Number(match[1]);
  }
  return totals.summaries ? totals : null;
}

export function runStatus(before: ReturnType<typeof sourceIdentity>, after: ReturnType<typeof sourceIdentity>,
  exitCode: number | null, interrupted: boolean) {
  if (interrupted || exitCode === null) return 'interrupted';
  if (exitCode !== 0) return 'failed';
  if (!before.clean || !after.clean || JSON.stringify(before) !== JSON.stringify(after)) return 'invalid-source';
  if (before.actualBun !== before.pinnedBun) return 'invalid-toolchain';
  return 'passed';
}

async function main() {
  const [rootArg, outputArg, command] = process.argv.slice(2);
  if (!rootArg || !outputArg || !command) throw new Error('Expected root, receipt directory and command');
  const root = resolve(rootArg);
  const output = resolve(outputArg);
  // Do not retain logs or receipts inside the tested source tree.
  if (output === root || output.startsWith(`${root}/`)) throw new Error('Receipt directory must be outside the worktree');
  mkdirSync(output, { recursive: true, mode: 0o700 });
  chmodSync(output, 0o700);
  const id = randomUUID();
  const receiptPath = join(output, `${id}.json`);
  const logPath = join(output, `${id}.log`);
  const before = sourceIdentity(root, command);
  const startedAt = new Date().toISOString();
  // Only the canonical command qualifies ci-fast. Arbitrary overrides never do.
  const capability = command === 'make ci-fast' ? 'ci-fast' : null;
  const receipt: Record<string, any> = {
    schemaVersion: 1, id, source: before, startedAt, endedAt: null,
    status: 'running', exitCode: null,
    capabilities: Object.fromEntries(capabilities.map(name => [name, { status: 'not-run', counts: null, logHash: null }])),
    customCommand: capability === null,
  };
  const save = () => writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  save();
  const fd = openSync(logPath, 'wx', 0o600);
  let interrupted = false;
  const proc = Bun.spawn(['bash', '-lc', command], { cwd: root, stdout: fd, stderr: fd, detached: true });
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    interrupted = true;
    try { process.kill(-proc.pid, 'SIGTERM'); } catch { /* Child group already exited. */ }
    killTimer ??= setTimeout(() => {
      try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* Child group already exited. */ }
    }, 1000);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  let exitCode: number | null = null;
  try {
    exitCode = await proc.exited;
  } finally {
    if (killTimer) clearTimeout(killTimer);
    closeSync(fd);
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
  const log = readFileSync(logPath);
  let after: ReturnType<typeof sourceIdentity> | null = null;
  try { after = sourceIdentity(root, command); } catch { /* Missing source cannot qualify. */ }
  receipt.endedAt = new Date().toISOString();
  receipt.exitCode = exitCode;
  receipt.status = after ? runStatus(before, after, exitCode, interrupted) : 'invalid-source';
  receipt.finalSource = after;
  receipt.log = { sha256: digest(log), bytes: log.length };
  if (capability) receipt.capabilities[capability] = {
    status: receipt.status, counts: testCounts(log.toString()), logHash: receipt.log.sha256,
  };
  save();
  process.stdout.write(log);
  console.error(`[pre-push-ci] Private local receipt: ${receiptPath} (${receipt.status})`);
  // A successful custom command may run, but never grants any canonical capability.
  process.exit(exitCode === 0 && receipt.status === 'passed' ? 0 : exitCode || 1);
}

if (import.meta.main) main().catch(() => {
  console.error('[pre-push-ci] Receipt generation failed; no qualification granted.');
  process.exit(1);
});
