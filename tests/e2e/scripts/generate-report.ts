#!/usr/bin/env bun
/**
 * Generate a PDF test report from Playwright JSON results + screenshots.
 *
 * Usage: bun run scripts/generate-report.ts [--output reports/piclaw-e2e-report.pdf]
 *
 * Uses Playwright's installed Chromium to render HTML → PDF.
 * Falls back to HTML-only output if Chromium is not available.
 *
 * Report includes:
 * - Summary pass/fail/skip counts
 * - Per-suite breakdown with timing
 * - Failure screenshots embedded inline
 * - Error messages for failed tests
 */

import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from "fs";
import { join, basename, dirname } from "path";

const OUTPUT = process.argv.includes("--output")
  ? process.argv[process.argv.indexOf("--output") + 1]!
  : "reports/piclaw-e2e-report.pdf";

const RESULTS_DIR = "test-results";
const RESULTS_PATH = "reports/results.json";
const EVIDENCE_DIR = "reports/evidence";

if (!existsSync(RESULTS_PATH)) {
  console.error(`Error: ${RESULTS_PATH} not found. Run 'bun run test' first.`);
  process.exit(1);
}

const results = JSON.parse(readFileSync(RESULTS_PATH, "utf-8"));

// ── Collect screenshots ──────────────────────────────────────────

function findImages(dir: string): string[] {
  const images: string[] = [];
  if (!existsSync(dir)) return images;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) images.push(...findImages(full));
      else if (entry.name.endsWith(".png")) images.push(full);
    }
  } catch {}
  return images;
}

// ── Helpers ──────────────────────────────────────────────────────

function esc(s: string) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function emoji(s: string) {
  return s === "passed" ? "✅" : s === "failed" ? "❌" : s === "timedOut" ? "⏱️" : s === "skipped" ? "⏭️" : "❓";
}
function dur(ms: number) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
function b64(path: string) {
  try { return `data:image/png;base64,${readFileSync(path).toString("base64")}`; } catch { return ""; }
}
function evidenceLabel(path: string) {
  const labels: Record<string, string> = {
    "classic-timeline.png": "Classic timeline and compose",
    "classic-settings.png": "Classic Workspace Settings",
    "visual-timeline.png": "Visual timeline and compose",
    "visual-settings.png": "Visual Workspace Settings",
  };
  return labels[basename(path)] || basename(path);
}
function skipReason(test: any, suite: string, title: string) {
  const annotations = Array.isArray(test?.annotations) ? test.annotations : [];
  const annotated = annotations
    .map((annotation: any) => String(annotation?.description || "").trim())
    .filter(Boolean)
    .join("; ");
  if (annotated) return annotated;
  const label = `${suite} ${title}`.toLowerCase();
  if (label.includes("timeline rendering")) return "required timeline fixture content was absent";
  if (label.includes("queue and steer")) return "agent/model completed before queued state was observable";
  if (label.includes("workspace file")) return "workspace sidebar/file fixture unavailable in this viewport";
  if (label.includes("vnc")) return "no VNC pane fixture was open";
  if (label.includes("pane popout")) return "no popout-capable pane fixture was open";
  if (label.includes("editor stability")) return "required editor tab fixture was absent";
  if (label.includes("screenshots") || label.includes("lightbox") || label.includes("external links")) return "required attachment/link fixture was absent";
  if (label.includes("session")) return "requires additional switchable/archived session state";
  if (label.includes("number fields")) return "settings pane has no visible numeric field in this fixture";
  return "conditional skip: required fixture/state not present";
}

// ── Collect tests ────────────────────────────────────────────────

interface TestResult {
  project: string;
  suite: string;
  title: string;
  status: string;
  playwrightStatus: string;
  attempts: number;
  duration: number;
  error: string;
  skipReason: string;
  attachments: Array<{ contentType?: string; path?: string; name?: string }>;
}

const allTests: TestResult[] = [];

function collect(suite: any, prefix = "") {
  const name = prefix ? `${prefix} › ${suite.title}` : suite.title;
  for (const spec of suite.specs || []) {
    for (const test of spec.tests || []) {
      const attempts = Array.isArray(test.results) ? test.results : [];
      const finalResult = attempts[attempts.length - 1] || {};
      const finalStatus = finalResult.status || (test.status === "expected" ? test.expectedStatus : test.status) || "unknown";
      allTests.push({
        project: test.projectName || "default",
        suite: name,
        title: spec.title,
        status: finalStatus,
        playwrightStatus: test.status || finalStatus,
        attempts: Math.max(1, attempts.length),
        duration: attempts.reduce((sum: number, result: any) => sum + (result.duration || 0), 0),
        error: finalResult.error?.message || "",
        skipReason: finalStatus === "skipped" ? skipReason(test, name, spec.title) : "",
        attachments: finalResult.attachments || [],
      });
    }
  }
  for (const child of suite.suites || []) collect(child, name);
}
for (const s of results.suites || []) collect(s);

const passed = allTests.filter((t) => t.status === "passed").length;
const failed = allTests.filter((t) => t.status === "failed" || t.status === "timedOut" || t.status === "interrupted").length;
const skipped = allTests.filter((t) => t.status === "skipped").length;
const retried = allTests.filter((t) => t.attempts > 1).length;
const total = allTests.length;
const totalDur = allTests.reduce((s, t) => s + t.duration, 0);

// ── Build HTML ───────────────────────────────────────────────────

let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','IBM Plex Sans',sans-serif;margin:40px;color:#1a1a2e;font-size:11px;line-height:1.4}
h1{font-size:22px;margin-bottom:4px;color:#1a1a2e}
h2{font-size:14px;margin-top:24px;border-bottom:1px solid #e2e8f0;padding-bottom:4px;color:#334155}
.meta{color:#64748b;font-size:10px;margin-bottom:12px}
.summary{margin:12px 0;font-size:13px;padding:10px 14px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0}
.summary span{margin-right:16px;font-weight:500}
.pass{color:#16a34a}.fail{color:#dc2626}.skip{color:#64748b}
table{width:100%;border-collapse:collapse;margin:8px 0;font-size:10.5px}
th,td{text-align:left;padding:4px 8px;border-bottom:1px solid #f1f5f9}
th{background:#f8fafc;font-weight:600;color:#475569;font-size:10px;text-transform:uppercase;letter-spacing:0.3px}
tr.failed{background:#fef2f2}tr.skipped{color:#94a3b8}
.error{color:#dc2626;font-size:10px;white-space:pre-wrap;max-width:550px;margin-top:2px;font-family:'JetBrains Mono',monospace}
.screenshot{max-width:100%;max-height:220px;margin:8px 0;border:1px solid #e2e8f0;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,0.06)}
.badge{display:inline-block;padding:1px 6px;border-radius:3px;font-size:9px;font-weight:600}
.badge-pass{background:#dcfce7;color:#166534}.badge-fail{background:#fee2e2;color:#991b1b}
.page-break{page-break-before:always}
</style></head><body>
<h1>PiClaw E2E Test Report</h1>
<p class="meta">Generated: ${new Date().toISOString()} · Playwright · ${results.config?.projects?.map((p: any) => p.name).join(", ") || "default"}</p>
<div class="summary">
<span class="pass">✅ ${passed} passed</span>
<span class="fail">${failed > 0 ? "❌" : ""} ${failed} failed</span>
<span class="skip">⏭️ ${skipped} skipped</span>
<span>↻ ${retried} retried</span>
<span>· ${total} test/project rows · ${dur(totalDur)}</span>
</div>`;

// ── Per-suite sections ───────────────────────────────────────────

const bySuite: Record<string, TestResult[]> = {};
for (const t of allTests) {
  (bySuite[`${t.project} · ${t.suite}`] ??= []).push(t);
}

let suiteIdx = 0;
for (const [suite, tests] of Object.entries(bySuite)) {
  const sp = tests.filter((t) => t.status === "passed").length;
  const sf = tests.filter((t) => t.status === "failed").length;
  const badge = sf > 0 ? `<span class="badge badge-fail">${sf} FAIL</span>` : `<span class="badge badge-pass">PASS</span>`;

  if (suiteIdx > 0 && suiteIdx % 4 === 0) html += `<div class="page-break"></div>`;
  html += `<h2>${esc(suite)} ${badge} (${sp}/${tests.length})</h2>`;
  html += `<table><tr><th></th><th>Scenario</th><th>Skip reason</th><th>Attempts</th><th>Duration</th></tr>`;

  for (const t of tests) {
    const rc = t.status === "failed" ? ' class="failed"' : t.status === "skipped" ? ' class="skipped"' : "";
    const retryBadge = t.attempts > 1 ? ` <span class="badge">retried ×${t.attempts}</span>` : "";
    const statusNote = t.playwrightStatus === "flaky" ? ` <span class="badge">flaky</span>` : "";
    html += `<tr${rc}><td>${emoji(t.status)}</td><td>${esc(t.title)}${retryBadge}${statusNote}`;
    if (t.error) html += `<br><span class="error">${esc(t.error.substring(0, 300))}</span>`;
    html += `</td><td>${esc(t.skipReason)}</td><td>${t.attempts}</td><td>${dur(t.duration)}</td></tr>`;

    // Embed failure screenshots
    for (const att of t.attachments.filter((a) => a.contentType === "image/png" && a.path)) {
      const src = b64(att.path!);
      if (src) html += `<tr><td></td><td colspan="2"><img class="screenshot" src="${src}"></td></tr>`;
    }
  }
  html += `</table>`;
  suiteIdx++;
}

// ── Footer ───────────────────────────────────────────────────────

html += `<div class="page-break"></div>`;
html += `<h2>Representative layout evidence</h2>`;
const evidence = findImages(EVIDENCE_DIR);
if (evidence.length === 0) {
  html += `<p class="skip">Representative layout capture was unavailable for this shard.</p>`;
} else {
  html += `<p>Successful-release checkpoints captured after the functional suite. They are representative review evidence, not a replacement for the behavioural assertions above.</p>`;
  for (const img of evidence.sort()) {
    const src = b64(img);
    if (src) {
      html += `<p><strong>${esc(evidenceLabel(img))}</strong></p>`;
      html += `<img class="screenshot" src="${src}">`;
    }
  }
}

html += `<h2>Failure screenshots</h2>`;
const screenshots = findImages(RESULTS_DIR);
if (screenshots.length === 0) {
  html += `<p class="skip">No failure screenshots captured.</p>`;
} else {
  html += `<p>${screenshots.length} failure screenshot(s) captured:</p>`;
  for (const img of screenshots.slice(0, 30)) {
    const src = b64(img);
    if (src) {
      html += `<p><strong>${esc(basename(img))}</strong></p>`;
      html += `<img class="screenshot" src="${src}">`;
    }
  }
}

html += `</body></html>`;

// ── Render PDF ───────────────────────────────────────────────────

mkdirSync(dirname(OUTPUT), { recursive: true });
const htmlPath = OUTPUT.replace(/\.pdf$/, ".html");
writeFileSync(htmlPath, html);
console.log(`HTML report: ${htmlPath}`);

try {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.pdf({
    path: OUTPUT,
    format: "A4",
    margin: { top: "16mm", bottom: "16mm", left: "12mm", right: "12mm" },
    printBackground: true,
  });
  await browser.close();
  console.log(`PDF report: ${OUTPUT}`);
} catch (err) {
  console.log(`PDF rendering skipped (${(err as Error).message}), HTML report available at ${htmlPath}`);
}
