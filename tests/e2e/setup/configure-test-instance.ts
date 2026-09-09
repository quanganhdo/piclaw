/**
 * E2E Test Environment Configuration
 *
 * Configures a PiClaw test instance to use an OpenAI-compatible test model.
 * CI points this at tests/e2e/setup/local-openai-compatible-stub.ts so the UX
 * release gate does not depend on external free-tier model availability.
 *
 * Usage:
 *   OPENCODE_BASE_URL=http://127.0.0.1:34567/v1 bun run tests/e2e/setup/configure-test-instance.ts
 *
 * Or with an external OpenCode-compatible endpoint:
 *   OPENCODE_API_KEY=oc-... OPENCODE_BASE_URL=https://opencode.ai/zen/v1 bun run tests/e2e/setup/configure-test-instance.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { requireFixturePaths } from './fixture-paths.js';
const fixture = requireFixturePaths();

// --- Configuration ---

const OPENCODE_BASE_URL = process.env.OPENCODE_BASE_URL;
if (!OPENCODE_BASE_URL) throw new Error('Set OPENCODE_BASE_URL explicitly; no external provider is selected by default.');
const OPENCODE_API_KEY = process.env.OPENCODE_API_KEY || ""; // optional — free models work without a key
const OPENCODE_MODEL = process.env.OPENCODE_MODEL || "mimo-v2.5-free";
const OPENCODE_PROVIDER_ID = "opencode-zen";

const PI_AGENT_DIR = fixture.profile;
const WORKSPACE_DIR = fixture.workspace;
const PICLAW_CONFIG_PATH = join(WORKSPACE_DIR, ".piclaw", "config.json");

// --- Validation ---

if (!OPENCODE_API_KEY) {
  console.log("NOTE: No OPENCODE_API_KEY set. This is expected for the local E2E stub.");
  console.log("");
}

// --- auth.json ---

const authPath = join(PI_AGENT_DIR, "auth.json");
mkdirSync(PI_AGENT_DIR, { recursive: true });

let authData: Record<string, unknown> = {};
if (existsSync(authPath)) {
  try {
    authData = JSON.parse(readFileSync(authPath, "utf-8"));
  } catch {
    authData = {};
  }
}

authData[OPENCODE_PROVIDER_ID] = {
  type: "api_key",
  key: OPENCODE_API_KEY || "free-tier", // free models don't need a real key
  env: {
    OPENCODE_BASE_URL,
  },
};

writeFileSync(authPath, JSON.stringify(authData, null, 2));
console.log(`✓ auth.json updated: ${authPath}`);

// --- models.json ---

const modelsPath = join(PI_AGENT_DIR, "models.json");
let modelsData: { providers?: Record<string, unknown>; activeModel?: string } = {};
if (existsSync(modelsPath)) {
  try {
    modelsData = JSON.parse(readFileSync(modelsPath, "utf-8"));
  } catch {
    modelsData = {};
  }
}

if (!modelsData.providers) modelsData.providers = {};
modelsData.providers[OPENCODE_PROVIDER_ID] = {
  baseUrl: OPENCODE_BASE_URL,
  api: "openai-completions",
  authHeader: !!OPENCODE_API_KEY,
  compat: {
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    supportsStore: false,
  },
  models: [
    {
      id: OPENCODE_MODEL,
      name: `OpenCode ZEN ${OPENCODE_MODEL}`,
      input: ["text"],
      reasoning: true,
      contextWindow: 128000,
      maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
  ],
};
modelsData.activeModel = `${OPENCODE_PROVIDER_ID}/${OPENCODE_MODEL}`;

writeFileSync(modelsPath, JSON.stringify(modelsData, null, 2));
console.log(`✓ models.json updated: ${modelsPath}`);
console.log(`  Active model: ${modelsData.activeModel}`);

// --- settings.json ---

const settingsPath = join(PI_AGENT_DIR, "settings.json");
let settingsData: Record<string, unknown> = {};
if (existsSync(settingsPath)) {
  try {
    settingsData = JSON.parse(readFileSync(settingsPath, "utf-8"));
  } catch {
    settingsData = {};
  }
}

settingsData.defaultProvider = OPENCODE_PROVIDER_ID;
settingsData.defaultModel = OPENCODE_MODEL;
settingsData.defaultThinkingLevel = "off";

writeFileSync(settingsPath, JSON.stringify(settingsData, null, 2));
console.log(`✓ settings.json updated: ${settingsPath}`);
console.log(`  Default model: ${OPENCODE_PROVIDER_ID}/${OPENCODE_MODEL}`);

// --- Validate connectivity ---

console.log("\nValidating OpenCode API connectivity...");

try {
  const resp = await fetch(`${OPENCODE_BASE_URL}/models`, {
    headers: {
      ...(OPENCODE_API_KEY ? { Authorization: `Bearer ${OPENCODE_API_KEY}` } : {}),
    },
  });

  if (resp.ok) {
    const data = (await resp.json()) as { data?: Array<{ id: string }> };
    const models = data.data || [];
    console.log(`✓ API reachable. ${models.length} models available.`);
    if (models.length > 0) {
      console.log(`  Available models: ${models.slice(0, 10).map((m) => m.id).join(", ")}${models.length > 10 ? "..." : ""}`);
    }

    // Verify our target model exists
    const targetExists = models.some((m) => m.id === OPENCODE_MODEL || m.id.includes(OPENCODE_MODEL.split("/").pop()!));
    if (targetExists) {
      console.log(`✓ Target model "${OPENCODE_MODEL}" available.`);
    } else {
      console.warn(`⚠ Target model "${OPENCODE_MODEL}" not found in model list. It may still work.`);
      console.warn(`  Try one of: ${models.slice(0, 5).map((m) => m.id).join(", ")}`);
    }
  } else {
    const text = await resp.text();
    console.error(`✗ API returned ${resp.status}: ${text.slice(0, 200)}`);
    console.error("  Check your API key and base URL.");
    process.exit(1);
  }
} catch (err) {
  console.error(`✗ Failed to reach OpenCode API at ${OPENCODE_BASE_URL}`);
  console.error(`  Error: ${(err as Error).message}`);
  process.exit(1);
}

// --- Quick completion test ---

console.log("\nTesting minimal completion...");

try {
  const resp = await fetch(`${OPENCODE_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      ...(OPENCODE_API_KEY ? { Authorization: `Bearer ${OPENCODE_API_KEY}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENCODE_MODEL,
      messages: [{ role: "user", content: "Say hello in one sentence." }],
      max_tokens: 500,
    }),
  });

  if (resp.ok) {
    const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string; reasoning?: string } }> };
    const msg = data.choices?.[0]?.message;
    const reply = msg?.content || msg?.reasoning || "";
    console.log(`✓ Completion works. Reply: "${reply.trim().slice(0, 80)}"`);
  } else {
    const text = await resp.text();
    console.error(`✗ Completion failed (${resp.status}): ${text.slice(0, 200)}`);
    process.exit(1);
  }
} catch (err) {
  console.error(`✗ Completion request failed: ${(err as Error).message}`);
  process.exit(1);
}

console.log("\n✓ E2E test instance configured successfully.");
console.log(`  Provider: ${OPENCODE_PROVIDER_ID}`);
console.log(`  Model: ${OPENCODE_MODEL}`);
console.log(`  Base URL: ${OPENCODE_BASE_URL}`);
console.log("\nReady to run E2E tests.");
