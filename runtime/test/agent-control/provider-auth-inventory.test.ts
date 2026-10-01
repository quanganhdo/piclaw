import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { ModelRuntime, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { getProviderDefs } from "../../src/agent-control/provider-defs.js";
import { createTestCredentialStore } from "../model-services-fixture.js";

const receipt = JSON.parse(readFileSync(resolve(import.meta.dir, "../fixtures/provider-auth-inventory-0991.json"), "utf8"));
const inventory = () => builtinProviders().map(provider => ({
  id: provider.id, name: provider.name,
  apiKeyLogin: typeof provider.auth.apiKey?.login === "function",
  apiKeyResolve: typeof provider.auth.apiKey?.resolve === "function",
  oauthLogin: typeof provider.auth.oauth?.login === "function",
  oauthRefresh: typeof provider.auth.oauth?.refresh === "function",
  oauthToAuth: typeof provider.auth.oauth?.toAuth === "function",
})).sort((a, b) => a.id.localeCompare(b.id));

test("exact0.99.1 provider-owned method inventory matches public runtime and UI definitions", async () => {
  expect(receipt.version).toBe("0.99.1");
  expect(receipt.gitHead).toBe("d86654abb8862e201933517d6f1fce9f88dd117f");
  expect(inventory()).toEqual(receipt.providers);
  expect(receipt.providers).toHaveLength(42);
  const runtime = await ModelRuntime.create({ credentials: createTestCredentialStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  const defs = getProviderDefs(new ModelRegistry(runtime), runtime);
  for (const provider of receipt.providers) {
    expect(defs.find(entry => entry.id === provider.id)).toMatchObject({ hasOAuth: provider.oauthLogin, hasApiKey: provider.apiKeyLogin });
  }
  expect(receipt.providers.find((entry: any) => entry.id === "openai")).toMatchObject({ apiKeyLogin: true, oauthLogin: true });
  expect(receipt.providers.find((entry: any) => entry.id === "openai-codex")).toMatchObject({ apiKeyLogin: false, oauthLogin: true });
  for (const provider of ["anthropic", "github-copilot", "kimi-coding", "openrouter", "radius"]) expect(receipt.providers.find((entry: any) => entry.id === provider).oauthLogin).toBe(true);
});

test("authoritative empty/failed runtime cannot advertise removed static login methods", () => {
  for (const getProviders of [() => [], () => { throw new Error("inventory unavailable"); }]) {
    const defs = getProviderDefs({ getAll: () => [{ provider: "anthropic" }] }, { getProviders });
    expect(defs.find(entry => entry.id === "anthropic")).toMatchObject({ hasOAuth: false, hasApiKey: false });
    expect(defs.filter(entry => entry.hasOAuth || entry.hasApiKey)).toEqual([]);
  }
  expect(getProviderDefs().find(entry => entry.id === "anthropic")?.hasOAuth).toBe(true); // Legacy host without a runtime inventory.
});

test("custom local/no-key configuration and external cloud identity are distinct inventory rows", () => {
  expect(receipt.externalIdentityRoutes.map((entry: any) => entry.provider)).toEqual(["amazon-bedrock", "google-vertex", "azure-openai", "azure-foundry"]);
  for (const local of ["ollama", "llama-cpp"]) {
    const row = receipt.customProviders.find((entry: any) => entry.id === local);
    expect(row.requiresApiKey).toBe(false);
    expect(row.authMode).toBe("custom_no_key");
  }
  const defs = getProviderDefs();
  for (const custom of receipt.customProviders) expect(defs.find(entry => entry.id === custom.id)?.customFields?.some(field => field.key === "apiKey" && field.required)).toBe(custom.requiresApiKey);
});

test("packaged public OpenAI/Codex modules execute synthetic PKCE login, refresh, bad state and cancellation", async () => {
  const probe = resolve(import.meta.dir, "fixtures/packaged-openai-login-0991.mjs");
  const child = Bun.spawn([process.execPath, probe], {
    cwd: resolve(import.meta.dir, "../../.."),
    env: { PATH: "/usr/local/lib/bun/bin:/usr/bin:/bin", HOME: "/nonexistent", PI_OFFLINE: "1", PI_TELEMETRY: "0", OTEL_SDK_DISABLED: "true" },
    stdout: "pipe", stderr: "pipe",
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try {
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(stderr).toBe("");
    expect(exit).toBe(0);
    const executed = JSON.parse(stdout);
    expect(executed.results).toEqual(["openai", "openai-codex"].flatMap(provider => ["success", "bad_state", "cancel"].map(mode => ({ provider, mode, status: "pass", mockedTokenRequests: mode === "success" ? 2 : mode === "cancel" ? 1 : 0, cancellationObserved: mode === "cancel" }))));
    for (const runtime of ["node", "bun"]) {
      const archived = JSON.parse(readFileSync(resolve(import.meta.dir, `../../../docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-0991-openai-auth-${runtime}.json`), "utf8"));
      expect(archived.results).toEqual(executed.results);
      expect(archived.version).toBe("0.99.1");
      expect(archived.runtime).toMatch(runtime === "node" ? /^Node / : /^Bun /);
      expect(archived.credentialPersistence).toBe("none");
    }
  } finally { clearTimeout(timeout); }
}, 15_000);
