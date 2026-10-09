import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";

const manifest = JSON.parse(await readFile(fileURLToPath(new URL("../package.json", import.meta.resolve("@earendil-works/pi-ai"))), "utf8"));
assert.equal(manifest.version, "1.0.3", "Exact published pi-ai required");

// 1.0.3 rejects occupied callback ports. Leave it free while using the
// public manual-paste interaction; no browser/account is opened.
const originalFetch = globalThis.fetch;
const results = [];
const jwt = `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "synthetic-account" } })).toString("base64url")}.fixture`;
try {
  const providers = builtinProviders();
  for (const providerId of ["openai", "openai-codex"]) {
    const oauth = providers.find(provider => provider.id === providerId)?.auth.oauth;
    assert.ok(oauth, `${providerId} OAuth missing`);
    for (const mode of ["success", "bad_state", "cancel"]) {
      let authorization;
      const controller = new AbortController();
      const requests = [];
      let cancellationObserved = false;
      globalThis.fetch = async (input, init) => {
        const url = String(input);
        assert.equal(url, providerId === "openai" ? "https://auth.openai.com/api/accounts/oauth/token" : "https://auth.openai.com/oauth/token");
        assert.notEqual(mode, "bad_state", "Rejected state must not request tokens");
        const body = new URLSearchParams(init?.body);
        requests.push(body.get("grant_type"));
        assert.equal(init?.method, "POST");
        assert.equal(body.get("client_id"), providerId === "openai" ? "synthetic-issued-client" : authorization.searchParams.get("client_id"));
        if (providerId === "openai") assert.equal(body.get("resource"), "https://api.openai.com/v1");
        if (body.get("grant_type") === "authorization_code") {
          assert.equal(body.get("code"), "synthetic-code");
          assert.equal(body.get("redirect_uri"), authorization.searchParams.get("redirect_uri"));
          assert.equal(createHash("sha256").update(body.get("code_verifier")).digest("base64url"), authorization.searchParams.get("code_challenge"));
        } else {
          assert.equal(body.get("grant_type"), "refresh_token");
          assert.equal(body.get("refresh_token"), "synthetic-refresh");
          assert.equal(body.has("code"), false);
        }
        if (mode === "cancel") return await new Promise((_, reject) => {
          assert.ok(init?.signal);
          init.signal.addEventListener("abort", () => { cancellationObserved = true; reject(new DOMException("Synthetic abort", "AbortError")); }, { once: true });
          queueMicrotask(() => controller.abort(new Error("Synthetic cancellation")));
        });
        return Response.json({ access_token: jwt, refresh_token: "synthetic-refresh", expires_in: 3600, id_token: "synthetic-id", scope: "openid chatgpt.tokens.use.direct" });
      };
      const interaction = {
        signal: controller.signal,
        notify(event) { if (event.type === "auth_url") authorization = new URL(event.url); },
        async prompt(prompt) {
          if (prompt.type === "select") return "browser";
          assert.equal(prompt.type, "manual_code");
          assert.ok(authorization);
          const redirect = new URL(authorization.searchParams.get("redirect_uri"));
          redirect.searchParams.set("code", "synthetic-code");
          redirect.searchParams.set("state", mode === "bad_state" ? "wrong-state" : authorization.searchParams.get("state"));
          if (providerId === "openai") redirect.searchParams.set("client_id", "synthetic-issued-client");
          return redirect.toString();
        },
      };
      if (mode === "success") {
        const credential = await oauth.login(interaction, { getDeviceId: () => "00000000-0000-4000-8000-000000000001" });
        assert.equal(credential.type, "oauth");
        assert.equal(credential.access, jwt);
        if (providerId === "openai") assert.equal(credential.clientId, "synthetic-issued-client");
        else assert.equal(credential.accountId, "synthetic-account");
        const refreshed = await oauth.refresh(credential, controller.signal);
        assert.equal(refreshed.type, "oauth");
        assert.deepEqual(requests, ["authorization_code", "refresh_token"]);
      } else {
        await assert.rejects(oauth.login(interaction, { getDeviceId: () => "00000000-0000-4000-8000-000000000001" }), mode === "bad_state" ? /state mismatch/i : /cancel/i);
        assert.deepEqual(requests, mode === "cancel" ? ["authorization_code"] : []);
        if (mode === "cancel") assert.equal(cancellationObserved, true);
      }
      results.push({ provider: providerId, mode, status: "pass", mockedTokenRequests: requests.length, cancellationObserved });
    }
  }
  console.log(JSON.stringify({ version: manifest.version, runtime: typeof Bun === "undefined" ? `Node ${process.versions.node}` : `Bun ${Bun.version}`, owner: "public_builtin_provider_auth", results, externalNetwork: "replaced_with_exact_endpoint_asserting_fetch", credentialPersistence: "none", inferenceExecution: "no_inference_method_invoked_by_probe" }));
} finally {
  globalThis.fetch = originalFetch;
  // The public provider owns its callback-listener cleanup.
}
