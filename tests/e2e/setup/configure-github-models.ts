/**
 * E2E Test LLM Provider — GitHub Models fallback
 *
 * In GitHub Actions, $GITHUB_TOKEN provides automatic access to
 * GitHub Models (models.inference.ai.azure.com) with no extra secrets.
 * This is the preferred provider for CI since it's fast, reliable,
 * and zero-config in runners.
 *
 * Usage (local with PAT):
 *   GITHUB_TOKEN=ghp_... bun run tests/e2e/setup/configure-github-models.ts
 *
 * Usage (in GitHub Actions — automatic):
 *   bun run tests/e2e/setup/configure-github-models.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { requireFixturePaths } from './fixture-paths.js';
const fixture = requireFixturePaths();
if (process.env.PICLAW_PROVIDER_TEST_LIVE !== '1') throw new Error('GitHub provider test requires explicit PICLAW_PROVIDER_TEST_LIVE=1.');

const GITHUB_MODELS_BASE_URL = "https://models.inference.ai.azure.com";
const GITHUB_MODEL = process.env.GITHUB_MODEL || "gpt-4o-mini";
const GITHUB_TOKEN = process.env.PICLAW_PROVIDER_TEST_TOKEN || "";
const PROVIDER_ID = "github-models";

const PI_AGENT_DIR = fixture.profile;

// --- Validation ---

if (!GITHUB_TOKEN) {
  console.error("ERROR: Set PICLAW_PROVIDER_TEST_TOKEN explicitly for the disposable provider test.");
  process.exit(1);
}

// --- auth.json ---

const authPath = join(PI_AGENT_DIR, "auth.json");
mkdirSync(PI_AGENT_DIR, { recursive: true });

let authData: Record<string, unknown> = {};
if (existsSync(authPath)) {
  try { authData = JSON.parse(readFileSync(authPath, "utf-8")); } catch { authData = {}; }
}

authData[PROVIDER_ID] = {
  type: "api_key",
  key: GITHUB_TOKEN,
  env: {
    GITHUB_MODELS_BASE_URL,
  },
};

writeFileSync(authPath, JSON.stringify(authData, null, 2));
console.log(`✓ auth.json updated: ${authPath}`);

// --- models.json ---

const modelsPath = join(PI_AGENT_DIR, "models.json");
let modelsData: { providers?: Record<string, unknown>; activeModel?: string } = {};
if (existsSync(modelsPath)) {
  try { modelsData = JSON.parse(readFileSync(modelsPath, "utf-8")); } catch { modelsData = {}; }
}

if (!modelsData.providers) modelsData.providers = {};
modelsData.providers[PROVIDER_ID] = {
  baseUrl: GITHUB_MODELS_BASE_URL,
  api: "openai-completions",
  authHeader: true,
  compat: {
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
  },
  models: [
    {
      id: GITHUB_MODEL,
      name: `GitHub Models ${GITHUB_MODEL}`,
      input: ["text"],
      reasoning: false,
      contextWindow: 128000,
      maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
  ],
};
modelsData.activeModel = `${PROVIDER_ID}/${GITHUB_MODEL}`;

writeFileSync(modelsPath, JSON.stringify(modelsData, null, 2));
console.log(`✓ models.json updated: ${modelsPath}`);
console.log(`  Active model: ${modelsData.activeModel}`);

// --- settings.json ---

const settingsPath = join(PI_AGENT_DIR, "settings.json");
let settingsData: Record<string, unknown> = {};
if (existsSync(settingsPath)) {
  try { settingsData = JSON.parse(readFileSync(settingsPath, "utf-8")); } catch { settingsData = {}; }
}

settingsData.defaultProvider = PROVIDER_ID;
settingsData.defaultModel = GITHUB_MODEL;
settingsData.defaultThinkingLevel = "off";

writeFileSync(settingsPath, JSON.stringify(settingsData, null, 2));
console.log(`✓ settings.json updated: ${settingsPath}`);
console.log(`  Default model: ${PROVIDER_ID}/${GITHUB_MODEL}`);

// --- Validate ---

console.log("\nValidating GitHub Models connectivity...");

try {
  const resp = await fetch(`${GITHUB_MODELS_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GITHUB_MODEL,
      messages: [{ role: "user", content: "Say hello" }],
      max_tokens: 20,
    }),
  });

  if (resp.ok) {
    const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: { total_tokens?: number } };
    const reply = data.choices?.[0]?.message?.content || "";
    const tokens = data.usage?.total_tokens || 0;
    console.log(`✓ Completion works. Reply: "${reply.trim()}" (${tokens} tokens)`);
  } else {
    const text = await resp.text();
    console.error(`✗ Completion failed (${resp.status}): ${text.slice(0, 200)}`);
    if (resp.status === 401) {
      console.error("  Token may not have model inference permissions.");
      console.error("  In GitHub Actions, ensure the workflow has: permissions: { models: read }");
    }
    process.exit(1);
  }
} catch (err) {
  console.error(`✗ Request failed: ${(err as Error).message}`);
  process.exit(1);
}

console.log("\n✓ GitHub Models configured for E2E tests.");
console.log(`  Provider: ${PROVIDER_ID}`);
console.log(`  Model: ${GITHUB_MODEL}`);
console.log(`  Base URL: ${GITHUB_MODELS_BASE_URL}`);
console.log("  Auth: $GITHUB_TOKEN (automatic in Actions runners)");
