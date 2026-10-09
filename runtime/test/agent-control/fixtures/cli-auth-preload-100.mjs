import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const provider = process.env.SYNTHETIC_AUTH_PROVIDER;
const mode = process.env.SYNTHETIC_AUTH_MODE;
assert.ok(["openai", "openai-codex"].includes(provider));
assert.ok(["success", "denied", "bad-state", "cancel", "provider-only"].includes(mode));
const blocker = createServer((_request, response) => { response.writeHead(404); response.end(); });
if (mode !== "provider-only") await new Promise((accept, reject) => { blocker.once("error", reject); blocker.listen(1455, "127.0.0.1", accept); });
const jwt = `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "synthetic-cli-account" } })).toString("base64url")}.fixture`;
const receipt = { preloadActive: true, provider, mode, tokenRequests: 0, unexpected: 0, polyfillAssignments: 0, pkceChallenge: "" };
const persist = () => writeFileSync(process.env.SYNTHETIC_AUTH_GUARD, JSON.stringify(receipt), { mode: 0o600 });
persist();
const mockFetch = Object.assign(async (input, init) => {
  try {
    assert.equal(String(input), provider === "openai" ? "https://auth.openai.com/api/accounts/oauth/token" : "https://auth.openai.com/oauth/token");
    assert.equal(init?.method, "POST");
    const body = new URLSearchParams(init.body);
    assert.equal(body.get("grant_type"), "authorization_code");
    assert.equal(body.get("code"), "synthetic-cli-code");
    assert.equal(body.get("redirect_uri"), provider === "openai" ? "http://127.0.0.1:1455/auth/callback" : "http://localhost:1455/auth/callback");
    assert.ok(body.get("code_verifier"));
    if (provider === "openai") {
      assert.equal(body.get("client_id"), "synthetic-issued-client");
      assert.equal(body.get("resource"), "https://api.openai.com/v1");
    } else assert.equal(body.get("client_id"), "app_EMoamEEZ73f0CkXaXp7hrann");
    assert.ok(["success", "denied"].includes(mode));
    receipt.tokenRequests++;
    assert.equal(receipt.tokenRequests, 1);
    receipt.pkceChallenge = createHash("sha256").update(body.get("code_verifier")).digest("base64url");
    persist();
    if (mode === "denied") return Response.json({ error: "access_denied" }, { status: 400 });
    return Response.json({ access_token: jwt, refresh_token: "synthetic-cli-refresh", expires_in: 3600, id_token: "synthetic-id", scope: "openid chatgpt.tokens.use.direct" });
  } catch {
    receipt.unexpected++; persist();
    throw new Error("Unexpected CLI request or token exchange.");
  }
}, { preconnect: () => { receipt.unexpected++; persist(); throw new Error("Unexpected CLI preconnect."); } });
// Codex startup installs a fetch polyfill. Keep this test-owned interception
// stable; a mandatory OS network namespace independently denies egress.
Object.defineProperty(globalThis, "fetch", {
  configurable: false, get: () => mockFetch,
  set: () => { receipt.polyfillAssignments++; persist(); },
});
