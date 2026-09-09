#!/usr/bin/env bun
import { chromium, firefox, webkit, type Browser, type Page } from 'playwright';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { $ } from 'bun';

const runtimeRoot = resolve(import.meta.dir, '../..');
const repoRoot = resolve(runtimeRoot, '..');
const tmpRoot = mkdtempSync(join(tmpdir(), 'piclaw-markdown-editor-speed-'));
const baselineRoot = join(tmpRoot, 'baseline');
const baselineRef = process.env.BASELINE_REF || 'HEAD^';
const skipBaselineTyping = process.env.SPEED_AUDIT_BASELINE_SKIP_TYPING !== '0';
const browserTypes = { chromium, firefox, webkit } as const;
type BrowserName = keyof typeof browserTypes;
const requestedBrowser = process.env.SPEED_AUDIT_BROWSER || 'chromium';
if (!(requestedBrowser in browserTypes)) {
  throw new Error(`Unsupported SPEED_AUDIT_BROWSER: ${requestedBrowser}`);
}
const browserName = requestedBrowser as BrowserName;

const viewports = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'tablet', width: 1024, height: 768 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

const runs = Number(process.env.SPEED_AUDIT_RUNS || 7);
const warmups = Number(process.env.SPEED_AUDIT_WARMUPS || 2);
const stressTables = process.env.SPEED_AUDIT_STRESS_TABLES === '1';
const livePreviewEnabled = process.env.SPEED_AUDIT_LIVE_PREVIEW !== '0';
const showWhitespace = process.env.SPEED_AUDIT_WHITESPACE === '1';

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}
function p95(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildSource(): string {
  const image = (label: string) => `![Inline chart ${label}](https://example.com/speed-audit.png)`;
  const intro = [
    '---',
    'title: Speed Audit',
    'tags: [editor, atomic-port]',
    '---',
    '',
    '# Speed Audit Heading',
    '',
    'Intro paragraph with **bold text** and _italic text_ for typing audit plus #tag and [safe link](https://example.com).',
    '',
    '> [!note]+ Interaction audit',
    '> This callout checks line-stable block rendering during scroll.',
    '',
    '| Name | Value | Notes |',
    '| --- | ---: | --- |',
    '| Alpha | 10 | stable |',
    '| Beta | 20 | source-preserving |',
    '',
    image('intro'),
    '',
    '```ts',
    'const sample = "code block";',
    '```',
    '',
    '[^a]: footnote text for parser extension coverage.',
    '',
  ].join('\n');
  const para = `Paragraph for typing and scroll audit with **strong** text, _emphasis_, #topic tags, and [links](https://example.com/path). `.repeat(2);
  const chunks: string[] = [intro];
  const sectionCount = stressTables ? 50 : 120;
  for (let i = 0; i < sectionCount; i++) {
    chunks.push(`\n## Section ${i}\n\n${para}\n\n- [ ] task ${i}\n- [x] done ${i}\n`);
    if (i % 20 === 0) chunks.push(`\n| Col A | Col B |\n| --- | --- |\n| ${i} | table row |\n`);
    if (i % 30 === 0) chunks.push(`\n${image(String(i))}\n`);
  }
  if (stressTables) {
    for (let table = 0; table < 20; table++) {
      chunks.push(`\n### Stress table ${table}\n\n| A | B | C | D | E | F |\n| --- | ---: | :---: | --- | --- | --- |\n`);
      for (let row = 0; row < 18; row++) {
        chunks.push(`| ${table}-${row}-0 | ${row} | center ${row} | text ${row} | pipe \\| value | tail |\n`);
      }
    }
  }
  return chunks.join('');
}

const source = buildSource();

async function ensureBaselineWorktree() {
  try {
    await $`git -C ${repoRoot} worktree remove --force ${baselineRoot}`.quiet();
  } catch (error) {
    console.warn('[markdown-editor-speed-audit] baseline worktree was not registered before setup', error);
  }
  rmSync(baselineRoot, { recursive: true, force: true });
  await $`git -C ${repoRoot} worktree add --detach --quiet ${baselineRoot} ${baselineRef}`;
  const currentNodeModules = join(repoRoot, 'node_modules');
  const baselineNodeModules = join(baselineRoot, 'node_modules');
  if (existsSync(currentNodeModules) && !existsSync(baselineNodeModules)) symlinkSync(currentNodeModules, baselineNodeModules, 'dir');
}

async function cleanupBaselineWorktree() {
  try {
    await $`git -C ${repoRoot} worktree remove --force ${baselineRoot}`.quiet();
  } catch (error) {
    console.warn('[markdown-editor-speed-audit] failed to remove baseline worktree', error);
  }
  rmSync(baselineRoot, { recursive: true, force: true });
}

function writeHarness(label: string, root: string): { workDir: string; entryPath: string } {
  const workDir = join(tmpRoot, label);
  const outDir = join(workDir, 'dist');
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const importPrefix = `${root}/runtime`;

  const entry = `
import { editorPaneExtension } from ${JSON.stringify(`${importPrefix}/extensions/viewers/editor/editor-extension.ts`)};

const source = ${JSON.stringify(source)};
const root = document.getElementById('editor');
if (!root) throw new Error('Missing #editor');
localStorage.setItem('piclaw_md_live_preview', ${JSON.stringify(String(livePreviewEnabled))});
localStorage.setItem('piclaw_show_whitespace', ${JSON.stringify(String(showWhitespace))});
globalThis.fetch = async () => new Response(JSON.stringify({ branch: 'main', mtime: '1', size: source.length }), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});

const mountStart = performance.now();
const instance = editorPaneExtension.mount(root, {
  path: 'markdown-editor-speed-audit.md',
  content: source,
  mtime: '1',
  mode: 'edit',
});
const view = instance.view;
if (!view) throw new Error('Editor did not create a CodeMirror view');

function quantile(values, q) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1))] || 0;
}
function nextFrame() { return new Promise((resolve) => requestAnimationFrame(() => resolve())); }
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function revealFirstTable() {
  const tablePos = view.state.doc.toString().indexOf('| Name | Value | Notes |');
  if (tablePos < 0) return;
  view.dispatch({ selection: { anchor: tablePos }, scrollIntoView: true });
  await nextFrame();
  await nextFrame();
}

window.__speedHarness = {
  source,
  view,
  mountPaint: async () => {
    if (${JSON.stringify(livePreviewEnabled)}) {
      while (!document.querySelector('.cm-md-editable-table')) await nextFrame();
    } else {
      await nextFrame();
      await nextFrame();
    }
    return performance.now() - mountStart;
  },
  docMatches: () => view.state.doc.toString() === source,
  decorationCounts: () => ({
    headings: document.querySelectorAll('.cm-md-h1-line,.cm-md-h2-line').length,
    callouts: document.querySelectorAll('.cm-md-callout').length,
    frontmatter: document.querySelectorAll('.cm-md-frontmatter-line').length,
    images: document.querySelectorAll('.cm-md-image-block,.cm-md-image-wrap').length,
    tables: document.querySelectorAll('.cm-md-editable-table,.cm-md-table-line').length,
  }),
  measureTyping: async () => {
    const marker = 'Intro paragraph';
    let pos = source.indexOf(marker) + marker.length;
    view.focus();
    view.dispatch({ selection: { anchor: pos } });
    await nextFrame();
    const sample = ' abcdefghijklmnopqrstuvwxyz'.repeat(4);
    const times = [];
    let settleMaxEventLoopLagMs = 0;
    let expectedTick = performance.now() + 16;
    const lagTimer = setInterval(() => {
      const now = performance.now();
      settleMaxEventLoopLagMs = Math.max(settleMaxEventLoopLagMs, now - expectedTick);
      expectedTick = now + 16;
    }, 16);
    for (const ch of sample) {
      const start = performance.now();
      view.dispatch({ changes: { from: pos, to: pos, insert: ch }, selection: { anchor: pos + ch.length } });
      times.push(performance.now() - start);
      pos += ch.length;
    }
    // The tight dispatch loop is an intentional throughput stress. Reset the
    // lag probe afterward so this measures delayed parser/widget work rather
    // than the loop itself.
    settleMaxEventLoopLagMs = 0;
    expectedTick = performance.now() + 16;
    await wait(380);
    clearInterval(lagTimer);
    const totalMs = times.reduce((a, b) => a + b, 0);
    const medianMs = quantile(times, 0.5);
    const p95Ms = quantile(times, 0.95);
    if (view.state.doc.toString() !== source) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source }, selection: { anchor: pos - sample.length } });
      await nextFrame();
    }
    return { totalMs, medianMs, p95Ms, settleMaxEventLoopLagMs, chars: sample.length };
  },
  measureCursor: async () => {
    const positions = [];
    let cursor = 0;
    for (let i = 0; i < 120; i++) {
      cursor = source.indexOf('## Section ' + i, cursor + 1);
      if (cursor < 0) break;
      positions.push(cursor + 3);
    }
    const times = [];
    for (const pos of positions) {
      const start = performance.now();
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: false });
      times.push(performance.now() - start);
    }
    await nextFrame();
    return { totalMs: times.reduce((a, b) => a + b, 0), medianMs: quantile(times, 0.5), p95Ms: quantile(times, 0.95), moves: times.length };
  },
  measurePointerDispatch: async () => {
    const target = view.contentDOM;
    const times = [];
    for (let i = 0; i < 80; i++) {
      const down = new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: i + 1 });
      const up = new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: i + 1 });
      const start = performance.now();
      target.dispatchEvent(down);
      window.dispatchEvent(up);
      times.push(performance.now() - start);
    }
    await wait(140);
    return { totalMs: times.reduce((a, b) => a + b, 0), medianMs: quantile(times, 0.5), p95Ms: quantile(times, 0.95), events: times.length };
  },
  measureScroll: async () => {
    const scroller = view.scrollDOM;
    const start = performance.now();
    let maxImages = 0;
    let maxTables = 0;
    for (let i = 0; i < 80; i++) {
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      scroller.scrollTop = maxScrollTop * (i / 79);
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
      if (i % 8 === 0) {
        await nextFrame();
        maxImages = Math.max(maxImages, document.querySelectorAll('.cm-md-image-block,.cm-md-image-wrap').length);
        maxTables = Math.max(maxTables, document.querySelectorAll('.cm-md-editable-table,.cm-md-table-line').length);
      }
    }
    await nextFrame();
    return { totalMs: performance.now() - start, steps: 80, scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, maxImages, maxTables };
  },
  verifyImageWidgets: async () => {
    const markdown = view.state.doc.toString();
    const matches = Array.from(markdown.matchAll(/!\\[Inline chart ([^\\]]+)\\]/g));
    let found = 0;
    for (const match of matches) {
      const pos = match.index || 0;
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
      await nextFrame();
      await nextFrame();
      const labels = Array.from(document.querySelectorAll('.cm-md-image-caption')).map((node) => node.textContent || '');
      if (labels.includes('Inline chart ' + match[1])) found++;
    }
    return { expected: matches.length, found };
  },
  measureTableEdit: async () => {
    await revealFirstTable();
    const cell = document.querySelector('.cm-md-editable-table tbody td .cm-md-table-cell-source');
    if (!cell) return { totalMs: Number.NaN, p95Ms: Number.NaN, operations: 0, skipped: 'no editable table source' };
    const times = [];
    cell.focus();
    cell.textContent = '';
    const sample = 'abcdefghijklmnopqrstuvwxyz'.repeat(2);
    for (const ch of sample) {
      const start = performance.now();
      cell.textContent = (cell.textContent || '') + ch;
      cell.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
      times.push(performance.now() - start);
    }
    await wait(120);
    if (view.state.doc.toString() !== source) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source }, selection: { anchor: 0 } });
      await nextFrame();
    }
    return { totalMs: times.reduce((a, b) => a + b, 0), p95Ms: quantile(times, 0.95), operations: times.length };
  },
  measureTableMutation: async () => {
    await revealFirstTable();
    const addRow = Array.from(document.querySelectorAll('.cm-md-editable-table-button')).find((button) => button.textContent === '+ row');
    const addCol = Array.from(document.querySelectorAll('.cm-md-editable-table-button')).find((button) => button.textContent === '+ col');
    if (!addRow || !addCol) return { totalMs: Number.NaN, operations: 0, skipped: 'no editable table controls' };
    const times = [];
    for (const button of [addRow, addCol]) {
      const start = performance.now();
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      times.push(performance.now() - start);
      await wait(40);
    }
    if (view.state.doc.toString() !== source) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source }, selection: { anchor: 0 } });
      await nextFrame();
    }
    return { totalMs: times.reduce((a, b) => a + b, 0), operations: times.length };
  },
  measureTableBoundary: async () => {
    const currentDoc = view.state.doc.toString();
    const tableFrom = currentDoc.indexOf('| Name | Value | Notes |');
    if (tableFrom < 0) return { totalMs: 0, selectedChars: 0, skipped: 'no table' };
    const tableTo = currentDoc.indexOf('\\n\\n', tableFrom);
    const boundary = tableTo > tableFrom ? tableTo : tableFrom;
    view.focus();
    view.dispatch({ selection: { anchor: boundary } });
    await nextFrame();
    const start = performance.now();
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    const totalMs = performance.now() - start;
    await nextFrame();
    const selectedChars = view.state.selection.main.to - view.state.selection.main.from;
    if (view.state.doc.toString() !== source) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source }, selection: { anchor: boundary } });
    }
    return { totalMs, selectedChars };
  },
};
`;

  const html = `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#111;color:#ddd}#editor,.editor-pane,.editor-body,.editor-codemirror{width:100%;height:100%}.cm-editor{height:100%}</style></head><body><div id="editor"></div><script type="module" src="./dist/harness.js"></script></body></html>`;
  const entryPath = join(workDir, 'harness.ts');
  writeFileSync(entryPath, entry);
  writeFileSync(join(workDir, 'index.html'), html);
  return { workDir, entryPath };
}

async function buildHarness(entryPath: string, outDir: string) {
  const result = await Bun.build({ entrypoints: [entryPath], outdir: outDir, target: 'browser', format: 'esm', sourcemap: 'none', naming: { entry: 'harness.js' } });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`Build failed: ${entryPath}`);
  }
}

function serve(workDir: string) {
  return Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      const rel = (url.pathname === '/' ? '/index.html' : url.pathname).replace(/^\/+/, '');
      const filePath = resolve(workDir, rel);
      if (!filePath.startsWith(workDir) || !existsSync(filePath)) return new Response('Not found', { status: 404 });
      const headers = new Headers();
      if (filePath.endsWith('.html')) headers.set('content-type', 'text/html; charset=utf-8');
      else if (filePath.endsWith('.js')) headers.set('content-type', 'text/javascript; charset=utf-8');
      return new Response(Bun.file(filePath), { headers });
    },
  });
}

type RunMetric = Record<string, any>;

async function runOne(page: Page, baseUrl: string, viewport: typeof viewports[number], options: { skipTyping?: boolean } = {}): Promise<RunMetric> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(baseUrl, { waitUntil: 'load' });
  await page.waitForSelector('.cm-editor');
  if (livePreviewEnabled) await page.waitForSelector('.cm-md-editable-table', { timeout: 20_000 });
  const mountPaintMs = await page.evaluate(() => (window as any).__speedHarness.mountPaint());
  const counts = await page.evaluate(() => (window as any).__speedHarness.decorationCounts());
  const docMatchesBefore = await page.evaluate(() => (window as any).__speedHarness.docMatches());
  console.log(`[audit] ${viewport.name}: typing`);
  const typing = options.skipTyping
    ? { totalMs: Number.NaN, medianMs: Number.NaN, p95Ms: Number.NaN, chars: 0, skipped: 'pre-port baseline throws RangeError on docChanged live-preview rebuild for this audit document' }
    : await page.evaluate(() => (window as any).__speedHarness.measureTyping());
  console.log(`[audit] ${viewport.name}: cursor`);
  const cursor = await page.evaluate(() => (window as any).__speedHarness.measureCursor());
  console.log(`[audit] ${viewport.name}: pointer`);
  const pointer = await page.evaluate(() => (window as any).__speedHarness.measurePointerDispatch());
  console.log(`[audit] ${viewport.name}: scroll`);
  const scroll = await page.evaluate(() => (window as any).__speedHarness.measureScroll());
  console.log(`[audit] ${viewport.name}: image widgets`);
  const imageWidgets = await page.evaluate(() => (window as any).__speedHarness.verifyImageWidgets());
  console.log(`[audit] ${viewport.name}: table edit`);
  const tableEdit = await page.evaluate(() => (window as any).__speedHarness.measureTableEdit());
  console.log(`[audit] ${viewport.name}: table mutation`);
  const tableMutation = await page.evaluate(() => (window as any).__speedHarness.measureTableMutation());
  console.log(`[audit] ${viewport.name}: table`);
  const table = await page.evaluate(() => (window as any).__speedHarness.measureTableBoundary());
  const docMatchesAfter = await page.evaluate(() => (window as any).__speedHarness.docMatches());
  return { mountPaintMs, counts, docMatchesBefore, docMatchesAfter, typing, cursor, pointer, scroll, imageWidgets, tableEdit, tableMutation, table };
}

function summarize(samples: RunMetric[]) {
  const field = (path: string) => samples.map((s) => path.split('.').reduce((v: any, k) => v?.[k], s)).filter((v) => Number.isFinite(v));
  return {
    mountPaintMs: { median: round(median(field('mountPaintMs'))), p95: round(p95(field('mountPaintMs'))) },
    typingTotalMs: { median: round(median(field('typing.totalMs'))), p95: round(p95(field('typing.totalMs'))) },
    typingP95PerCharMs: { median: round(median(field('typing.p95Ms'))), p95: round(p95(field('typing.p95Ms'))) },
    typingSettleLagMs: { median: round(median(field('typing.settleMaxEventLoopLagMs'))), p95: round(p95(field('typing.settleMaxEventLoopLagMs'))) },
    cursorTotalMs: { median: round(median(field('cursor.totalMs'))), p95: round(p95(field('cursor.totalMs'))) },
    cursorP95Ms: { median: round(median(field('cursor.p95Ms'))), p95: round(p95(field('cursor.p95Ms'))) },
    pointerTotalMs: { median: round(median(field('pointer.totalMs'))), p95: round(p95(field('pointer.totalMs'))) },
    pointerP95Ms: { median: round(median(field('pointer.p95Ms'))), p95: round(p95(field('pointer.p95Ms'))) },
    scrollTotalMs: { median: round(median(field('scroll.totalMs'))), p95: round(p95(field('scroll.totalMs'))) },
    scrollMaxImages: Math.max(0, ...field('scroll.maxImages')),
    scrollMaxTables: Math.max(0, ...field('scroll.maxTables')),
    imageWidgetsExpected: Math.max(0, ...field('imageWidgets.expected')),
    imageWidgetsFound: Math.min(...field('imageWidgets.found')),
    tableEditMs: { median: round(median(field('tableEdit.totalMs'))), p95: round(p95(field('tableEdit.totalMs'))) },
    tableEditP95Ms: { median: round(median(field('tableEdit.p95Ms'))), p95: round(p95(field('tableEdit.p95Ms'))) },
    tableMutationMs: { median: round(median(field('tableMutation.totalMs'))), p95: round(p95(field('tableMutation.totalMs'))) },
    tableBoundaryMs: { median: round(median(field('table.totalMs'))), p95: round(p95(field('table.totalMs'))) },
    tableSelectedChars: { median: round(median(field('table.selectedChars'))), p95: round(p95(field('table.selectedChars'))) },
    docMatchesBefore: samples.every((s) => s.docMatchesBefore),
    docMatchesAfter: samples.every((s) => s.docMatchesAfter),
    lastCounts: samples.at(-1)?.counts,
  };
}

async function runSuite(browser: Browser, label: string, root: string, options: { skipTyping?: boolean } = {}) {
  const { workDir, entryPath } = writeHarness(label, root);
  await buildHarness(entryPath, join(workDir, 'dist'));
  const server = serve(workDir);
  try {
    const page = await browser.newPage();
    page.on('console', (m) => console.log(`[browser:${label}:${m.type()}] ${m.text()}`));
    const results: Record<string, any> = {};
    for (const viewport of viewports) {
      const samples: RunMetric[] = [];
      for (let i = 0; i < warmups + runs; i++) {
        const sample = await runOne(page, server.url.href, viewport, options);
        if (i >= warmups) samples.push(sample);
      }
      results[viewport.name] = summarize(samples);
      console.log(`[${label}] ${viewport.name}`, JSON.stringify(results[viewport.name]));
    }
    await page.close();
    return results;
  } finally {
    server.stop(true);
  }
}

function compare(base: any, head: any) {
  const metrics = ['mountPaintMs', 'typingTotalMs', 'typingP95PerCharMs', 'typingSettleLagMs', 'cursorTotalMs', 'cursorP95Ms', 'pointerTotalMs', 'pointerP95Ms', 'scrollTotalMs', 'tableEditMs', 'tableEditP95Ms', 'tableMutationMs', 'tableBoundaryMs'];
  const rows: any[] = [];
  for (const viewport of viewports) {
    for (const metric of metrics) {
      const b = base[viewport.name][metric].median;
      const h = head[viewport.name][metric].median;
      const delta = round(h - b);
      const ratio = b > 0 ? round(h / b) : null;
      rows.push({ viewport: viewport.name, metric, baselineMedian: b, headMedian: h, delta, ratio });
    }
  }
  return rows;
}

async function main() {
  rmSync(tmpRoot, { recursive: true, force: true });
  mkdirSync(tmpRoot, { recursive: true });
  let browser: Browser | null = null;
  try {
    await ensureBaselineWorktree();
    browser = await browserTypes[browserName].launch({ headless: true });
    const baseline = await runSuite(browser, `baseline-head-parent-${browserName}`, baselineRoot, { skipTyping: skipBaselineTyping });
    const head = await runSuite(browser, `working-tree-${browserName}`, repoRoot);
    const rows = compare(baseline, head);
    const output = { browserName, baselineRef, headRef: 'working-tree', skipBaselineTyping, runs, warmups, stressTables, livePreviewEnabled, showWhitespace, sourceLength: source.length, baseline, head, comparison: rows };
    const reportPath = process.env.SPEED_AUDIT_REPORT || join(runtimeRoot, 'generated/cache/markdown-editor-speed-audit.json');
    writeFileSync(reportPath, JSON.stringify(output, null, 2));
    console.log(`REPORT ${reportPath}`);
    console.table(rows);
  } finally {
    if (browser) await browser.close();
    await cleanupBaselineWorktree();
  }
}

await main();
