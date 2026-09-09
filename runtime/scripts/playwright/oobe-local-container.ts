#!/usr/bin/env bun

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import {
  OOBE_PROVIDER_MISSING_DISMISSED_KEY,
  OOBE_PROVIDER_READY_COMPLETED_KEY,
} from '../../web/src/ui/oobe-state.ts';

const DEFAULT_IMAGE = process.env.PICLAW_OOBE_TEST_IMAGE || 'piclaw-oobe-test:local';
const DEFAULT_CONTAINER_NAME = process.env.PICLAW_OOBE_TEST_CONTAINER || `piclaw-oobe-${Date.now()}`;
const DEFAULT_TIMEOUT_MS = Number(process.env.PICLAW_OOBE_TEST_TIMEOUT_MS || 120000);
const DEFAULT_SKIP_BUILD = process.env.PICLAW_OOBE_TEST_SKIP_BUILD === '1';
const DEFAULT_HEADLESS = process.env.PICLAW_OOBE_TEST_HEADLESS !== '0';

function log(message: string, ...rest: unknown[]) {
  console.log(`[oobe-local-container] ${message}`, ...rest);
}

function fail(message: string): never {
  throw new Error(message);
}

function isClosedTargetError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Target page, context or browser has been closed/i.test(message);
}

function parseArgs(argv: string[]) {
  const args = {
    image: DEFAULT_IMAGE,
    containerName: DEFAULT_CONTAINER_NAME,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    skipBuild: DEFAULT_SKIP_BUILD,
    headless: DEFAULT_HEADLESS,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    const next = i + 1 < argv.length ? argv[i + 1] : '';
    if (value === '--image' && next) {
      args.image = next;
      i += 1;
      continue;
    }
    if (value === '--container-name' && next) {
      args.containerName = next;
      i += 1;
      continue;
    }
    if (value === '--timeout-ms' && next) {
      args.timeoutMs = Number(next);
      i += 1;
      continue;
    }
    if (value === '--skip-build') {
      args.skipBuild = true;
      continue;
    }
    if (value === '--headed') {
      args.headless = false;
      continue;
    }
  }

  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs < 1000) {
    fail(`Invalid --timeout-ms value: ${args.timeoutMs}`);
  }

  return args;
}

function createTempHarnessRoot() {
  const base = mkdtempSync(join(tmpdir(), 'piclaw-oobe-local-container-'));
  const configDir = join(base, 'config');
  const workspaceDir = join(base, 'workspace');
  mkdirSync(configDir, { recursive: true });
  mkdirSync(workspaceDir, { recursive: true });
  // Keep the mounted directories explicit so the runtime has writable roots.
  writeFileSync(join(workspaceDir, '.gitkeep'), '');
  return { base, configDir, workspaceDir };
}

async function getFreePort(): Promise<number> {
  const { createServer } = await import('node:net');
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not resolve a free port.'));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolvePort(address.port);
      });
    });
  });
}

function runCommand(args: string[], options: { cwd?: string; allowFailure?: boolean; quiet?: boolean } = {}) {
  const proc = Bun.spawnSync({
    cmd: args,
    cwd: options.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: process.env,
  });
  const stdout = proc.stdout.toString().trim();
  const stderr = proc.stderr.toString().trim();
  if (proc.exitCode !== 0 && !options.allowFailure) {
    throw new Error([
      `Command failed: ${args.join(' ')}`,
      stdout && `stdout:\n${stdout}`,
      stderr && `stderr:\n${stderr}`,
    ].filter(Boolean).join('\n\n'));
  }
  if (!options.quiet && stdout) process.stdout.write(`${stdout}\n`);
  if (!options.quiet && stderr) process.stderr.write(`${stderr}\n`);
  return { exitCode: proc.exitCode, stdout, stderr };
}

async function waitForHttp(url: string, timeoutMs: number) {
  const started = Date.now();
  let lastError = '';
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await Bun.sleep(500);
  }
  throw new Error(`Timed out waiting for ${url} (${lastError || 'no response'})`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

async function assertPanelVisible(page: Page, kind: 'provider-missing') {
  const locator = page.locator(`.oobe-panel-${kind}`);
  await locator.waitFor({ state: 'visible', timeout: 15000 });
  return locator;
}

async function assertPanelHidden(page: Page) {
  await page.waitForFunction(() => !document.querySelector('.oobe-panel'), undefined, { timeout: 15000 });
}

async function captureFailureArtifacts(page: Page, options: {
  artifactDir: string;
  stamp: string;
  label: string;
  interceptedModelRequests?: string[];
  modelResponses?: Array<{ url: string; status: number; body?: string }>;
}) {
  const { artifactDir, stamp, label, interceptedModelRequests = [], modelResponses = [] } = options;
  const screenshotPath = join(artifactDir, `${label}-${stamp}-failure.png`);
  const htmlPath = join(artifactDir, `${label}-${stamp}-dom.html`);
  const statePath = join(artifactDir, `${label}-${stamp}-state.json`);
  const bodyTextPath = join(artifactDir, `${label}-${stamp}-body.txt`);

  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
  } catch (error) {
    log(`Failed to capture screenshot artifact: ${screenshotPath}`, error);
  }

  let html = '';
  let state: Record<string, unknown>;
  let bodyText = '';
  try {
    html = await page.content();
    bodyText = await page.locator('body').textContent() || '';
    state = await page.evaluate(({ missingKey, readyKey }: { missingKey: string; readyKey: string }) => ({
      url: window.location.href,
      title: document.title,
      bodyClasses: document.body?.className || '',
      hasOobePanel: Boolean(document.querySelector('.oobe-panel')),
      oobePanelClass: document.querySelector('.oobe-panel')?.className || null,
      oobePanelText: document.querySelector('.oobe-panel')?.textContent || null,
      textareaValue: document.querySelector('textarea')?.value || null,
      providerMissingDismissed: localStorage.getItem(missingKey),
      providerReadyCompleted: localStorage.getItem(readyKey),
    }), {
      missingKey: OOBE_PROVIDER_MISSING_DISMISSED_KEY,
      readyKey: OOBE_PROVIDER_READY_COMPLETED_KEY,
    });
  } catch (error) {
    state = {
      stateCaptureError: error instanceof Error ? error.message : String(error),
    };
  }

  writeFileSync(htmlPath, html);
  writeFileSync(bodyTextPath, bodyText);
  writeFileSync(statePath, JSON.stringify({
    ...state,
    interceptedModelRequests,
    modelResponses,
  }, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(import.meta.dir, '..', '..', '..');
  const harness = createTempHarnessRoot();
  const artifactDir = resolve(repoRoot, 'artifacts', 'oobe-local-container');
  mkdirSync(artifactDir, { recursive: true });
  const currentWebDistDir = resolve(repoRoot, 'runtime', 'web', 'static', 'classic', 'dist');
  const containerWebDistDir = '/usr/local/lib/bun/install/global/node_modules/piclaw/runtime/web/static/classic/dist';
  const stamp = new Date().toISOString().replace(/[.:]/g, '-');
  const hostPort = await getFreePort();
  const baseUrl = `http://127.0.0.1:${hostPort}`;

  let browser: Browser | null = null;
  let createdContainerId: string | null = null;
  let runFailed = false;
  const cleanup = async () => {
    try {
      if (runFailed && createdContainerId) {
        const containerLogs = runCommand(['docker', 'logs', createdContainerId], { allowFailure: true, quiet: true });
        if (containerLogs.stdout || containerLogs.stderr) {
          writeFileSync(join(artifactDir, `container-logs-${stamp}.txt`), [containerLogs.stdout, containerLogs.stderr].filter(Boolean).join('\n'));
        }
      }
      if (createdContainerId) runCommand(['docker', 'rm', '-f', createdContainerId], { allowFailure: true, quiet: true });
    } catch (error) {
      log(`Cleanup failed while removing container ${args.containerName}`, error);
    }
    try {
      await browser?.close();
    } catch (error) {
      log('Cleanup failed while closing browser', error);
    }
    rmSync(harness.base, { recursive: true, force: true });
  };

  process.on('SIGINT', async () => {
    await cleanup();
    process.exit(130);
  });

  try {
    if (!args.skipBuild) {
      log(`Building local image ${args.image}...`);
      runCommand(['docker', 'build', '-q', '-t', args.image, '.'], { cwd: repoRoot });
    } else {
      log(`Skipping image build, using ${args.image}`);
    }

    log(`Starting local container ${args.containerName} on ${baseUrl} ...`);
    const created = runCommand([
      'docker', 'run', '-d', '--rm',
      '--name', args.containerName,
      '-p', `127.0.0.1:${hostPort}:8080`,
      '-e', 'PICLAW_WEB_PORT=8080',
      '-e', 'PICLAW_AUTOSTART=1',
      '-v', `${harness.configDir}:/config`,
      '-v', `${harness.workspaceDir}:/workspace`,
      '-v', `${currentWebDistDir}:${containerWebDistDir}:ro`,
      args.image,
    ], { quiet: true });
    createdContainerId = created.stdout.trim();
    if (!/^[a-f0-9]{12,64}$/.test(createdContainerId)) throw new Error('Docker did not return a created container ID; refusing name-based cleanup');

    await waitForHttp(`${baseUrl}/`, args.timeoutMs);
    browser = await chromium.launch({ headless: args.headless });

    log('Scenario 1: provider-missing OOBE panel and dismiss persistence');
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      const interceptedModelRequests: string[] = [];
      const modelResponses: Array<{ url: string; status: number; body?: string }> = [];
      const providerMissingPayload = JSON.stringify({
        current: null,
        models: [],
        model_options: [],
        thinking_level: null,
        supports_thinking: false,
        provider_usage: null,
      });
      await page.route('**/agent/models*', async (route) => {
        interceptedModelRequests.push(route.request().url());
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: providerMissingPayload,
        });
      });
      page.on('response', async (response) => {
        if (!response.url().includes('/agent/models')) return;
        let body = '';
        try {
          body = await response.text();
        } catch (error) {
          if (!isClosedTargetError(error)) {
            log(`Failed to read intercepted /agent/models response body for ${response.url()}`, error);
          }
        }
        modelResponses.push({ url: response.url(), status: response.status(), body });
      });

      try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('textarea', { timeout: 15000 });
        const panel = await assertPanelVisible(page, 'provider-missing');
        const text = (await panel.textContent()) || '';
        assert(text.includes('Instance needs setup'), 'Provider-missing OOBE title missing.');
        assert(text.includes('Open Settings'), 'Provider-missing copy should point to settings for setup.');

        const providerMissingScreenshot = join(artifactDir, `oobe-provider-missing-${stamp}.png`);
        await page.screenshot({ path: providerMissingScreenshot, fullPage: true });

        await page.getByRole('button', { name: 'Open Settings' }).click();
        await page.waitForFunction(() => Boolean(document.querySelector('.settings-dialog')), { timeout: 15000 });
        await page.locator('.settings-dialog-close').click();
        await page.waitForFunction(() => !document.querySelector('.settings-dialog'), { timeout: 15000 });

        await page.getByRole('button', { name: 'Dismiss' }).click();
        await assertPanelHidden(page);
        const dismissedValue = await page.evaluate((key) => localStorage.getItem(key), OOBE_PROVIDER_MISSING_DISMISSED_KEY);
        assert(dismissedValue === 'true', 'Provider-missing dismiss state did not persist to localStorage.');

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('textarea', { timeout: 15000 });
        await assertPanelHidden(page);
      } catch (error) {
        runFailed = true;
        await captureFailureArtifacts(page, {
          artifactDir,
          stamp,
          label: 'provider-missing',
          interceptedModelRequests,
          modelResponses,
        });
        throw error;
      } finally {
        await context.close();
      }
    }

    log('Scenario 2: configured instance keeps OOBE hidden');
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      const interceptedModelRequests: string[] = [];
      const modelResponses: Array<{ url: string; status: number; body?: string }> = [];
      const configuredPayload = JSON.stringify({
        current: 'openai/gpt-4.1',
        models: ['openai/gpt-4.1'],
        model_options: [{
          label: 'openai/gpt-4.1',
          provider: 'openai',
          id: 'gpt-4.1',
          name: 'GPT 4.1',
          context_window: 128000,
          reasoning: true,
        }],
        thinking_level: null,
        supports_thinking: true,
        provider_usage: null,
      });
      await page.route('**/agent/models*', async (route) => {
        interceptedModelRequests.push(route.request().url());
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: configuredPayload,
        });
      });
      page.on('response', async (response) => {
        if (!response.url().includes('/agent/models')) return;
        let body = '';
        try {
          body = await response.text();
        } catch (error) {
          if (!isClosedTargetError(error)) {
            log(`Failed to read intercepted /agent/models response body for ${response.url()}`, error);
          }
        }
        modelResponses.push({ url: response.url(), status: response.status(), body });
      });

      try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('textarea', { timeout: 15000 });
        await assertPanelHidden(page);

        const configuredScreenshot = join(artifactDir, `oobe-configured-${stamp}.png`);
        await page.screenshot({ path: configuredScreenshot, fullPage: true });

        const panelCount = await page.locator('.oobe-panel').count();
        assert(panelCount === 0, 'Configured instance should keep OOBE panel hidden.');

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('textarea', { timeout: 15000 });
        await assertPanelHidden(page);
      } catch (error) {
        runFailed = true;
        await captureFailureArtifacts(page, {
          artifactDir,
          stamp,
          label: 'oobe-configured',
          interceptedModelRequests,
          modelResponses,
        });
        throw error;
      } finally {
        await context.close();
      }
    }

    log('All local-container OOBE scenarios passed.');
    log(`Base URL: ${baseUrl}`);
    log(`Container image: ${args.image}`);
    log(`Mounted temp root: ${harness.base}`);
    log(`Artifacts written under: ${artifactDir}`);
  } finally {
    await cleanup();
  }
}

await main();
