/**
 * Validate that the E2E test environment is correctly configured.
 *
 * The UX suite is a browser/UI regression gate, not a model-provider
 * integration test. The CI instance is expected to be reachable and to run
 * without a user-facing auth gate. If an internal secret is provided, we also
 * verify that the E2E bootstrap endpoint accepts it, but model availability and
 * agent turns are deliberately not release blockers here.
 */

import { requireDisposableTestTarget } from '../../../runtime/scripts/test-target.js';
const BASE_URL = requireDisposableTestTarget(process.env.PICLAW_E2E_URL);
const INTERNAL_SECRET = process.env.PICLAW_E2E_INTERNAL_SECRET || "";

interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
  required: boolean;
}

const results: CheckResult[] = [];

function check(name: string, pass: boolean, detail: string, required = true) {
  results.push({ name, pass, detail, required });
  const icon = pass ? "✓" : required ? "✗" : "⚠";
  console.log(`${icon} ${name}: ${detail}`);
}

// --- 1. Instance reachable ---

try {
  const resp = await fetch(BASE_URL, { redirect: "manual" });
  check("Instance reachable", resp.status < 500, `HTTP ${resp.status}`);
} catch (err) {
  check("Instance reachable", false, (err as Error).message);
}

// --- 2. Optional E2E auth bootstrap ---

if (!INTERNAL_SECRET) {
  check("Internal secret", true, "not set; assuming no-auth E2E instance", false);
} else {
  try {
    const resp = await fetch(`${BASE_URL}/auth/e2e/bootstrap`, {
      method: "POST",
      redirect: 'error',
      headers: {
        "Content-Type": "application/json",
        "x-piclaw-internal-secret": INTERNAL_SECRET,
      },
    });
    const setCookie = resp.headers.get("set-cookie");
    check(
      "E2E auth bootstrap",
      resp.ok && !!setCookie,
      resp.ok ? "Session cookie received" : `HTTP ${resp.status}`,
      false,
    );
  } catch (err) {
    check("E2E auth bootstrap", false, (err as Error).message, false);
  }
}

// --- Summary ---

console.log("\n--- Summary ---");
const required = results.filter((r) => r.required);
const passed = required.filter((r) => r.pass).length;
const total = required.length;
console.log(`${passed}/${total} required checks passed`);

if (passed < total) {
  console.log("\nFailing required checks:");
  for (const r of required.filter((r) => !r.pass)) {
    console.log(`  ✗ ${r.name}: ${r.detail}`);
  }
  process.exit(1);
}

console.log("\n✓ E2E test environment is ready.");
