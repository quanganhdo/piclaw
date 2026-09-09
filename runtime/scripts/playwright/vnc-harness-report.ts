#!/usr/bin/env bun

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser } from 'playwright';

import { cleanupVncHarnessReport, probeHarnessHealth } from './vnc-harness-report-helpers.ts';

const DEFAULT_TARGET = "";
const DEFAULT_PASSWORD = "";
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8791;
const DEFAULT_LIVE_WAIT_MS = 15000;
const DEFAULT_ENCODINGS = '16,5,2,1,0,-223';

type VncHarnessSyntheticResult = {
    cases?: Array<{ name: string; pass?: boolean; detail?: string }>;
    summary?: { passed?: number; total?: number };
};

type VncHarnessStats = {
    bytesIn?: number;
    bytesOut?: number;
    frames?: number;
    rects?: number;
    protocolEvents?: Record<string, number>;
};

type VncHarnessSnapshot = {
    connectedAt?: string | null;
    firstDisplayInitAt?: string | null;
    firstFramebufferAt?: string | null;
    protocolState?: string | null;
    lastError?: string | null;
    stats?: VncHarnessStats;
};

type VncHarnessLiveRun = {
    requested: string;
    effective: string;
    passed: boolean;
    connectedAt: string;
    firstDisplayInitAt: string;
    firstFramebufferAt: string;
    lastError: string;
    protocolState: string;
    frames: number;
    rects: number;
};

type VncHarnessProbeResult = {
    requestedEncoding: string;
    currentEncoding: string;
    connectedAt?: string | null;
    firstDisplayInitAt?: string | null;
    firstFramebufferAt?: string | null;
    lastError?: string | null;
    protocolState?: string | null;
    stats?: VncHarnessStats;
};

type VncHarnessApi = {
    runSyntheticSuite: () => Promise<VncHarnessSyntheticResult>;
    runEncodingProbeWithWait: (encoding: string, timeoutMs: number) => Promise<VncHarnessProbeResult>;
    snapshot: () => VncHarnessSnapshot;
};

declare global {
    interface Window {
        __VNC_HARNESS__?: VncHarnessApi;
    }
}

function parseEncodingList(raw: unknown): string[] {
    const text = String(raw || '').trim();
    return text
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0 && Number.isFinite(Number(item)));
}

function parseArgs(argv: string[]) {
    const args = {
        target: process.env.VNC_HARNESS_TARGET || DEFAULT_TARGET,
        password: process.env.VNC_HARNESS_PASSWORD || DEFAULT_PASSWORD,
        host: process.env.VNC_HARNESS_HOST || DEFAULT_HOST,
        port: Number(process.env.VNC_HARNESS_PORT || DEFAULT_PORT),
        liveWaitMs: Number(process.env.VNC_HARNESS_LIVE_WAIT_MS || DEFAULT_LIVE_WAIT_MS),
        encodings: process.env.VNC_HARNESS_ENCODINGS || DEFAULT_ENCODINGS,
    };

    for (let i = 0; i < argv.length; i += 1) {
        const value = argv[i];
        const next = i + 1 < argv.length ? argv[i + 1] : '';
        if (value === '--target' && next) {
            args.target = next;
            i += 1;
            continue;
        }
        if (value === '--password' && next) {
            args.password = next;
            i += 1;
            continue;
        }
        if (value === '--host' && next) {
            args.host = next;
            i += 1;
            continue;
        }
        if (value === '--port' && next) {
            args.port = Number(next);
            i += 1;
            continue;
        }
        if (value === '--live-wait-ms' && next) {
            args.liveWaitMs = Number(next);
            i += 1;
            continue;
        }
        if (value === '--encodings' && next) {
            args.encodings = String(next);
            i += 1;
            continue;
        }
    }

    if (!Number.isFinite(args.port) || args.port <= 0 || args.port > 65535) {
        throw new Error(`Invalid --port value: ${args.port}`);
    }
    if (!Number.isFinite(args.liveWaitMs) || args.liveWaitMs < 1000) {
        throw new Error(`Invalid --live-wait-ms value: ${args.liveWaitMs}`);
    }
    const encodings = parseEncodingList(args.encodings);
    args.encodings = encodings.length > 0 ? encodings.join(',') : DEFAULT_ENCODINGS;
    return args;
}

async function sleep(ms: number) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function waitForHealth(baseUrl: string, timeoutMs = 10000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        if (await probeHarnessHealth(baseUrl)) return true;
        await sleep(200);
    }
    return false;
}

function buildMarkdownReport({ args, baseUrl, liveRuns, synthetic, snapshot, consoleLines, screenshotPath, startedAt, finishedAt, liveWaitMs }: {
    args: ReturnType<typeof parseArgs>;
    baseUrl: string;
    liveRuns: VncHarnessLiveRun[];
    synthetic: VncHarnessSyntheticResult | null;
    snapshot: VncHarnessSnapshot | null;
    consoleLines: string[];
    screenshotPath: string;
    startedAt: string;
    finishedAt: string;
    liveWaitMs: number;
}) {
    const syntheticRows = (synthetic?.cases || []).map((item) => `| ${item.name} | ${item.pass ? 'PASS' : 'FAIL'} | ${String(item.detail || '').replace(/\|/g, '\\|')} |`).join('\n');
    const protocolRows = Object.entries(snapshot?.stats?.protocolEvents || {}).map(([name, count]) => `| ${name} | ${count} |`).join('\n');
    const liveRows = (liveRuns || []).map((entry) => `| ${entry.requested} | ${entry.effective} | ${entry.passed ? 'PASS' : 'FAIL'} | ${entry.firstFramebufferAt || 'n/a'} | ${entry.lastError || 'none'} | ${entry.frames || 0} |`).join('\n');

    return `# VNC Harness Playwright Report

- Started: ${startedAt}
- Finished: ${finishedAt}
- Harness URL: ${baseUrl}
- Target: \`${args.target}\`
- Password length: ${String(args.password || '').length}
- Encodings tested: ${Array.isArray(args.encodings) ? args.encodings.join(', ') : args.encodings}
- Live wait budget: ${liveWaitMs} ms

## Live per-encoding probes

| Requested | Effective | Pass | First Frame | Last Error | Frames |
|---|---|---|---|---|---|
${liveRows || '| (none) | - | - | - | - | - |'}

## Live connection summary

| Metric | Value |
|---|---|
| connectedAt | ${snapshot?.connectedAt || 'n/a'} |
| firstDisplayInitAt | ${snapshot?.firstDisplayInitAt || 'n/a'} |
| firstFramebufferAt | ${snapshot?.firstFramebufferAt || 'n/a'} |
| protocolState | ${snapshot?.protocolState || 'n/a'} |
| bytesIn | ${snapshot?.stats?.bytesIn ?? 'n/a'} |
| bytesOut | ${snapshot?.stats?.bytesOut ?? 'n/a'} |
| frames | ${snapshot?.stats?.frames ?? 'n/a'} |
| rects | ${snapshot?.stats?.rects ?? 'n/a'} |
| lastError | ${snapshot?.lastError || 'none'} |

## Synthetic encoder suite

| Encoder | Result | Detail |
|---|---|---|
${syntheticRows || '| (none) | - | - |'}

**Summary:** ${synthetic?.summary?.passed || 0}/${synthetic?.summary?.total || 0} passed.

## Protocol event counts

| Event | Count |
|---|---|
${protocolRows || '| (none) | 0 |'}

## Playwright browser console (last 40 lines)

\`\`\`
${consoleLines.slice(-40).join('\n')}
\`\`\`

## Artifacts

- Screenshot: \`${screenshotPath}\`
- JSON snapshot includes full logs and counters.
`;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (process.env.PICLAW_E2E_DISPOSABLE !== '1' || !args.target) throw new Error('VNC tests require an explicit disposable target and PICLAW_E2E_DISPOSABLE=1.');
    if (!['127.0.0.1', 'localhost', '::1'].includes(args.host)) throw new Error('VNC test harness must bind loopback.');
    const baseUrl = `http://${args.host}:${args.port}`;
    const startedAt = new Date().toISOString();

    const repoRoot = resolve(import.meta.dir, '..', '..', '..');
    const standaloneScript = resolve(repoRoot, 'runtime', 'scripts', 'vnc-harness-standalone.ts');
    const reportDir = resolve(repoRoot, 'artifacts', 'vnc-harness');

    const harnessProc = Bun.spawn({
        cmd: [
            'bun',
            standaloneScript,
            '--host', args.host,
            '--port', String(args.port),
            '--target', args.target,
        ],
        env: { ...process.env, VNC_HARNESS_PASSWORD: args.password },
        stdout: 'pipe',
        stderr: 'pipe',
        cwd: repoRoot,
    });

    const procStdoutPromise = new Response(harnessProc.stdout).text();
    const procStderrPromise = new Response(harnessProc.stderr).text();

    let browser: Browser | null = null;
    const consoleLines: string[] = [];
    const liveRuns: VncHarnessLiveRun[] = [];

    try {
        const ready = await waitForHealth(baseUrl, 15000);
        if (!ready) {
            throw new Error(`Harness did not become healthy at ${baseUrl}/healthz`);
        }

        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        page.on('console', (message) => {
            consoleLines.push(`[${message.type()}] ${message.text()}`);
        });

        const params = new URLSearchParams();
        params.set('target', args.target);
        params.set('autoconnect', '0');
        if (args.encodings) params.set('encodings', args.encodings);
        const pageUrl = `${baseUrl}/?${params.toString()}`;
        await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => Boolean(window.__VNC_HARNESS__), undefined, { timeout: 15000 });

        const encodingSequence = parseEncodingList(args.encodings);

        const synthetic = await page.evaluate(async () => {
            return await window.__VNC_HARNESS__!.runSyntheticSuite();
        });

        for (const candidate of encodingSequence) {
            const requestedSequence = Array.from(new Set([candidate, ...encodingSequence])).filter((value) => value && Number.isFinite(Number(value)));
            const runResult = await page.evaluate(async ({ encoding: requestedEncoding, timeoutMs }: { encoding: string; timeoutMs: number }) => {
                const result = await window.__VNC_HARNESS__!.runEncodingProbeWithWait(requestedEncoding, timeoutMs);
                return {
                    requestedEncoding: result.requestedEncoding,
                    effectiveEncoding: result.currentEncoding,
                    connectedAt: result.connectedAt,
                    firstDisplayInitAt: result.firstDisplayInitAt,
                    firstFramebufferAt: result.firstFramebufferAt,
                    lastError: result.lastError,
                    protocolState: result.protocolState,
                    stats: result.stats,
                };
            }, { encoding: requestedSequence.join(','), timeoutMs: args.liveWaitMs });
            liveRuns.push({
                requested: runResult.requestedEncoding,
                effective: runResult.effectiveEncoding,
                passed: Boolean(runResult.firstFramebufferAt && !runResult.lastError),
                connectedAt: runResult.connectedAt || 'n/a',
                firstDisplayInitAt: runResult.firstDisplayInitAt || 'n/a',
                firstFramebufferAt: runResult.firstFramebufferAt || 'n/a',
                lastError: runResult.lastError || 'none',
                protocolState: runResult.protocolState || 'idle',
                frames: runResult.stats?.frames || 0,
                rects: runResult.stats?.rects || 0,
            });
        }

        const snapshot = await page.evaluate(() => window.__VNC_HARNESS__!.snapshot());

        mkdirSync(reportDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[.:]/g, '-');
        const screenshotPath = join(reportDir, `vnc-harness-${stamp}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });

        const jsonPath = join(reportDir, `vnc-harness-${stamp}.json`);
        const mdPath = join(reportDir, `vnc-harness-${stamp}.md`);

        const finishedAt = new Date().toISOString();
        writeFileSync(jsonPath, JSON.stringify({
            startedAt,
            finishedAt,
            baseUrl,
            args: {
                ...args,
                password: `***len:${String(args.password || '').length}***`,
            },
            liveRuns,
            synthetic,
            snapshot,
            consoleLines,
            screenshotPath,
        }, null, 2));

        const markdown = buildMarkdownReport({
            args,
            baseUrl,
            liveRuns,
            synthetic,
            snapshot,
            consoleLines,
            screenshotPath,
            startedAt,
            finishedAt,
            liveWaitMs: args.liveWaitMs,
        });
        writeFileSync(mdPath, markdown);

        console.log(`[report] markdown: ${mdPath}`);
        console.log(`[report] json: ${jsonPath}`);
        console.log(`[report] screenshot: ${screenshotPath}`);
    } finally {
        await cleanupVncHarnessReport({ browser, harnessProc });

        const procStdout = await procStdoutPromise.catch(() => '');
        const procStderr = await procStderrPromise.catch(() => '');
        if (procStdout.trim()) console.log(`[harness-stdout]\n${procStdout.trim()}`);
        if (procStderr.trim()) console.log(`[harness-stderr]\n${procStderr.trim()}`);
    }
}

await main();
