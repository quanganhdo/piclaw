#!/usr/bin/env bun
/**
 * Run the full E2E UX test suite against the microVM test instance.
 *
 * Usage: bun run scripts/run-microvm-suite.ts [--project desktop-chrome]
 *
 * Handles:
 * 1. Verifies microVM is reachable
 * 2. Obtains E2E auth session cookie
 * 3. Runs all Playwright specs against the remote URL
 * 4. Generates PDF report
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { requireDisposableTestTarget } from '../../../runtime/scripts/test-target.js';

const MICROVM_URL = requireDisposableTestTarget(process.env.PICLAW_E2E_URL);
const suiteDir = resolve(import.meta.dir, '..');
const PROJECT = process.argv.includes("--project")
  ? process.argv[process.argv.indexOf("--project") + 1]
  : "desktop-chrome";
const WORKERS = process.argv.includes("--workers")
  ? process.argv[process.argv.indexOf("--workers") + 1]
  : (process.env.PICLAW_E2E_WORKERS || "1");
const RUN_TIMEOUT_MS = Number.parseInt(process.env.PICLAW_E2E_RUN_TIMEOUT_MS || "900000", 10);

console.log(`\n=== PiClaw E2E Suite — microVM ===`);
console.log(`Target: ${MICROVM_URL}`);
console.log(`Project: ${PROJECT}`);
console.log(`Workers: ${WORKERS}`);
console.log(`Time: ${new Date().toISOString()}\n`);

// 1. Verify reachable
console.log("1. Checking microVM reachability...");
try {
  const resp = await fetch(MICROVM_URL, { redirect: "manual" });
  console.log(`   ✓ HTTP ${resp.status}`);
} catch (err) {
  console.error(`   ✗ Cannot reach ${MICROVM_URL}: ${(err as Error).message}`);
  process.exit(1);
}

// 2. Use only an explicitly supplied test-instance secret; never SSH into an implicit host.
console.log("2. Resolving auth...");
const internalSecret = process.env.PICLAW_E2E_INTERNAL_SECRET || "";

if (internalSecret) {
  console.log("   ✓ Internal secret resolved");
} else {
  console.log("   ⚠ No internal secret found — auth-dependent tests will skip");
}

// 3. Run Playwright
console.log(`\n3. Running Playwright tests (project: ${PROJECT})...\n`);

const env = {
  ...process.env,
  PICLAW_E2E_URL: MICROVM_URL,
  PICLAW_E2E_INTERNAL_SECRET: internalSecret,
  PICLAW_E2E_WORKERS: WORKERS,
  PLAYWRIGHT_BROWSERS_PATH: "/workspace/.cache/ms-playwright",
};

const testResult = spawnSync(process.execPath, [
  resolve(suiteDir, '../../runtime/scripts/local-test-priority.ts'), '--', 'bunx', 'playwright', 'test',
  "--project", PROJECT,
  "--workers", WORKERS,
  "--reporter", "json,list",
  "--output", "reports/results.json",
], {
  cwd: suiteDir,
  env,
  stdio: "inherit",
  timeout: Number.isFinite(RUN_TIMEOUT_MS) ? RUN_TIMEOUT_MS : 900000, // default 15 minutes
});

console.log(`\nPlaywright exit code: ${testResult.status}`);

// 4. Generate report
console.log("\n4. Generating report...");
try {
  spawnSync("bun", ["run", "scripts/generate-report.ts"], {
    cwd: suiteDir,
    env,
    stdio: "inherit",
    timeout: 30000,
  });
} catch (err) {
  console.log(`   Report generation failed: ${(err as Error).message}`);
}

const pdfPath = resolve(suiteDir, 'reports/piclaw-e2e-report.pdf');
const htmlPath = resolve(suiteDir, 'reports/piclaw-e2e-report.html');
const reportPath = existsSync(pdfPath) ? pdfPath : existsSync(htmlPath) ? htmlPath : null;

console.log(`\n=== Done ===`);
console.log(`Exit code: ${testResult.status}`);
if (reportPath) console.log(`Report: ${reportPath}`);

process.exit(testResult.status ?? 1);
