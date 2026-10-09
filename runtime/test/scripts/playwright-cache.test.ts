import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { load } from 'js-yaml';
import { saveBrowserManifest, verifyBrowserCache } from '../../../scripts/playwright-cache-integrity';

const root = resolve(import.meta.dir, '../../..');
test('cold, warm, corrupted and malformed browser caches recover without fixture state', () => {
  const parent = mkdtempSync(join(tmpdir(), 'browser-cache-'));
  const cache = join(parent, 'ms-playwright');
  const privateFile = join(parent, 'profile.json');
  writeFileSync(privateFile, 'private');
  try {
    expect(verifyBrowserCache(cache)).toBe('cold');
    mkdirSync(join(cache, 'chromium-123'), { recursive: true });
    writeFileSync(join(cache, 'chromium-123/browser'), 'binary');
    saveBrowserManifest(cache);
    expect(verifyBrowserCache(cache)).toBe('warm');
    writeFileSync(join(cache, 'chromium-123/browser'), 'corrupt');
    expect(verifyBrowserCache(cache)).toBe('discarded');
    expect(verifyBrowserCache(cache)).toBe('cold');
    mkdirSync(cache);
    writeFileSync(join(cache, '.piclaw-browser-cache-integrity.json'), '{invalid');
    expect(verifyBrowserCache(cache)).toBe('discarded');
    mkdirSync(cache);
    writeFileSync(join(cache, 'unexpected'), 'no manifest');
    expect(verifyBrowserCache(cache)).toBe('discarded');
    expect(readFileSync(privateFile, 'utf8')).toBe('private');
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('browser cache has exact platform/toolchain/lock/browser keys and mandatory install', () => {
  const action: any = load(readFileSync(join(root, '.github/actions/playwright-cache/action.yml'), 'utf8'));
  const steps = action.runs.steps;
  const restore = steps.find((s: any) => s.id === 'cache');
  expect(restore.with.path).toBe('~/.cache/ms-playwright');
  expect(restore.with.key).toBe("browsers-v1-${{ runner.os }}-${{ runner.arch }}-bun${{ inputs.bun-version }}-${{ hashFiles('bun.lock', 'tests/e2e/bun.lock') }}-pw${{ steps.playwright.outputs.version }}-${{ inputs.variant }}");
  expect(restore.with['restore-keys']).toBeUndefined();
  const install = steps.find((s: any) => s.name === 'Install required browsers');
  expect(install.if).toBeUndefined();
  expect(install.run).toBe('bunx playwright install ${{ inputs.browsers }}');
  expect(steps.findIndex((s: any) => s.name === 'Check restored browser integrity')).toBeLessThan(steps.indexOf(install));
  const save = steps.find((s: any) => s.name === 'Save browser binaries');
  expect(save.with.path).toBe(restore.with.path);
  expect(save.if).toBe("steps.cache.outputs.cache-hit != 'true'");
  for (const [name, browsers, variant] of [
    ['ci', '--with-deps chromium webkit', 'chromium-webkit'],
    ['e2e', 'chromium', 'chromium'],
    ['integration-gate', 'chromium --only-shell', 'chromium-shell'],
  ]) {
    const workflow: any = load(readFileSync(join(root, `.github/workflows/${name}.yml`), 'utf8'));
    const job: any = Object.values(workflow.jobs)[0];
    const setup = job.steps.find((s: any) => s.uses === './.github/actions/playwright-cache');
    expect(setup.with.browsers).toBe(browsers);
    expect(setup.with.variant).toBe(variant);
    expect(setup.with['bun-version']).toBe('${{ steps.bun-version.outputs.version }}');
  }
});
