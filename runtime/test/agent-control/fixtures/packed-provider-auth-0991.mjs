import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Copy this consumer into an isolated install prefix before execution. It must
// resolve Piclaw and its SDK from that install, never from the source checkout.
const prefix = realpathSync(process.argv[2]);
const profile = resolve(process.argv[3]);
function within(path) {
  const rel = relative(prefix, realpathSync(path));
  assert.ok(rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), "Module escaped staged install");
  return rel;
}
within(fileURLToPath(import.meta.url));
const serviceUrl = import.meta.resolve("piclaw/runtime/src/agent-pool/model-services.ts");
const aiUrl = import.meta.resolve("@earendil-works/pi-ai");
const codingUrl = import.meta.resolve("@earendil-works/pi-coding-agent");
const paths = [serviceUrl, aiUrl, codingUrl].map(url => within(fileURLToPath(url)));
const piclawManifest = JSON.parse(readFileSync(fileURLToPath(new URL("../../../package.json", serviceUrl)), "utf8"));
// model-services.ts is under runtime/src/agent-pool (three parent directories).
assert.equal(piclawManifest.name, "piclaw");
const provenance = JSON.parse(readFileSync(resolve(prefix, "artifact-provenance.json"), "utf8"));
assert.equal(provenance.kind, "bun_pm_pack_staged_install");
assert.match(provenance.tarballSha256, /^[a-f0-9]{64}$/);
const source = realpathSync(provenance.checkoutRoot);
assert.ok(prefix !== source && !prefix.startsWith(`${source}${sep}`), "Consumer prefix is inside the checkout");
const moduleDigests = Object.fromEntries(["runtime/src/agent-pool/model-services.ts", "runtime/src/agent-pool/credential-store.ts"].map(path => {
  const installed = resolve(prefix, "node_modules/piclaw", path);
  within(installed);
  const digest = createHash("sha256").update(readFileSync(installed)).digest("hex");
  assert.equal(digest, provenance.packedModuleSha256[path], "Installed module differs from packed artifact");
  return [path, digest];
}));
const sdkFileSha256 = {};
const expectedSdkFileSha256 = {
  "@earendil-works/pi-ai/dist/index.js": "25554deede6f6a5955a008b81c95a1b0ed13ba10bebb1cd5790869eb39d80374",
  "@earendil-works/pi-ai/dist/auth/oauth/openai-chatgpt.js": "b8d3c0513eb9e3879714be046968b1ec443ee9d8f02d3248ce2181911b88d1fa",
  "@earendil-works/pi-ai/dist/auth/oauth/openai-codex.js": "0740315fb80f9c90ccee677b3cfdce4bce289610090b64b74af8f002e230868f",
  "@earendil-works/pi-coding-agent/dist/index.js": "5482298b995db935f7b96f5d6056fa1c36ac6fc80456be594ef65b83c62b0d30",
  "@earendil-works/pi-coding-agent/dist/core/model-runtime.js": "3bd00aec50bd73c6cd6814c45fbc3fa586026d6f9ab052ff5be018faa5873eb7",
};
for (const url of [aiUrl, codingUrl]) {
  const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", url)), "utf8"));
  assert.equal(manifest.version, "0.99.1");
  for (const path of manifest.name === "@earendil-works/pi-ai"
    ? ["index.js", "auth/oauth/openai-chatgpt.js", "auth/oauth/openai-codex.js"] : ["index.js", "core/model-runtime.js"]) {
    const installed = fileURLToPath(new URL(path, url));
    within(installed);
    sdkFileSha256[`${manifest.name}/dist/${path}`] = createHash("sha256").update(readFileSync(installed)).digest("hex");
  }
}
assert.deepEqual(sdkFileSha256, expectedSdkFileSha256, "Installed SDK bytes differ from exact 0.99.1 receipt");

const originalFetch = globalThis.fetch;
let unexpectedNetwork = 0;
let authorization;
let providerId;
const requests = [];
const token = label => `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({
  "https://api.openai.com/auth": { chatgpt_account_id: `synthetic-${providerId}-${label}` },
})).toString("base64url")}.synthetic`;
globalThis.fetch = Object.assign(async (input, init) => {
  const expectedUrl = providerId === "openai" ? "https://auth.openai.com/api/accounts/oauth/token" : "https://auth.openai.com/oauth/token";
  if (!providerId || String(input) !== expectedUrl) {
    unexpectedNetwork++;
    throw new Error("Unexpected staged auth network target");
  }
  assert.equal(init.method, "POST");
  const body = new URLSearchParams(init.body);
  assert.equal(body.get("client_id"), providerId === "openai" ? "synthetic-issued-client" : authorization.searchParams.get("client_id"));
  if (providerId === "openai") assert.equal(body.get("resource"), "https://api.openai.com/v1");
  const grant = body.get("grant_type");
  requests.push({ provider: providerId, grant });
  if (grant === "authorization_code") {
    assert.equal(body.get("code"), "synthetic-code");
    assert.equal(body.get("redirect_uri"), authorization.searchParams.get("redirect_uri"));
    assert.equal(createHash("sha256").update(body.get("code_verifier")).digest("base64url"), authorization.searchParams.get("code_challenge"));
  } else {
    assert.equal(grant, "refresh_token");
    assert.equal(body.get("refresh_token"), `synthetic-initial-refresh-${providerId}`);
  }
  return Response.json({
    access_token: token(grant), refresh_token: `${grant === "refresh_token" ? "synthetic-rotated-refresh" : "synthetic-initial-refresh"}-${providerId}`,
    expires_in: 3600, id_token: "synthetic-id", scope: "openid chatgpt.tokens.use.direct",
  });
}, { preconnect: () => { unexpectedNetwork++; throw new Error("Unexpected network preconnect"); } });
const blocker = createServer((_request, response) => { response.writeHead(404); response.end(); });
await new Promise((accept, reject) => { blocker.once("error", reject); blocker.listen(1455, "127.0.0.1", accept); });
const results = [];
const storedByProvider = new Map();
try {
  const { createRuntimeModelServices } = await import(serviceUrl);
  const services = await createRuntimeModelServices({ agentDir: profile });
  await services.credentialStore.modify("synthetic-unrelated", async () => ({ type: "api_key", key: "synthetic-unrelated-key" }));
  for (providerId of ["openai", "openai-codex"]) {
    authorization = undefined;
    await services.modelRuntime.login(providerId, "oauth", {
      notify(event) { if (event.type === "auth_url") authorization = new URL(event.url); },
      async prompt(prompt) {
        if (prompt.type === "select") return "browser";
        assert.equal(prompt.type, "manual_code");
        assert.ok(authorization);
        const callback = new URL(authorization.searchParams.get("redirect_uri"));
        assert.equal(callback.port, "1455");
        assert.equal(callback.hostname, providerId === "openai" ? "127.0.0.1" : "localhost");
        callback.searchParams.set("state", authorization.searchParams.get("state"));
        callback.searchParams.set("code", "synthetic-code");
        if (providerId === "openai") callback.searchParams.set("client_id", "synthetic-issued-client");
        return callback.toString();
      },
    }, { getDeviceId: () => "00000000-0000-4000-8000-000000000001" });
    const saved = await services.credentialStore.read(providerId);
    assert.equal(saved.type, "oauth");
    assert.equal(saved.access, token("authorization_code"));
    assert.equal(saved.refresh, `synthetic-initial-refresh-${providerId}`);
    await services.credentialStore.modify(providerId, async current => ({ ...current, expires: 1 }));
    const auth = await services.modelRuntime.getAuth(providerId);
    assert.equal(auth?.source, "OAuth");
    assert.equal(auth?.auth.apiKey, token("refresh_token"));
    const rotated = await services.credentialStore.read(providerId);
    assert.equal(rotated.access, token("refresh_token"));
    assert.equal(rotated.refresh, `synthetic-rotated-refresh-${providerId}`);
    if (providerId === "openai-codex") assert.equal(rotated.accountId, "synthetic-openai-codex-refresh_token");
    storedByProvider.set(providerId, rotated);
    for (const [id, snapshot] of storedByProvider) assert.deepEqual(await services.credentialStore.read(id), snapshot);
    const reopened = await createRuntimeModelServices({ agentDir: profile });
    assert.deepEqual(await reopened.modelRuntime.getAuth(providerId), auth);
    const metadata = await reopened.modelRuntime.listCredentials();
    for (const entry of metadata) assert.deepEqual(Object.keys(entry).sort(), ["providerId", "type"]);
    results.push({ provider: providerId, login: "pass", rotation: "pass", reopen: "pass", logout: "pass" });
  }
  const reopened = await createRuntimeModelServices({ agentDir: profile });
  await reopened.modelRuntime.logout("openai-codex");
  assert.equal(await services.credentialStore.read("openai-codex"), undefined);
  assert.equal(await services.modelRuntime.getAuth("openai-codex"), undefined);
  assert.deepEqual(await services.credentialStore.read("openai"), storedByProvider.get("openai"));
  await reopened.modelRuntime.logout("openai");
  assert.equal(await services.credentialStore.read("openai"), undefined);
  assert.equal(await services.modelRuntime.getAuth("openai"), undefined);
  assert.equal((await services.credentialStore.read("synthetic-unrelated")).key, "synthetic-unrelated-key");
  assert.deepEqual(requests, ["openai", "openai-codex"].flatMap(provider => ["authorization_code", "refresh_token"].map(grant => ({ provider, grant }))));
  assert.equal(statSync(services.credentialStore.authPath).mode & 0o777, 0o600);
  assert.equal(unexpectedNetwork, 0);
  console.log(JSON.stringify({
    piclaw: piclawManifest.version, earendil: "0.99.1", runtime: `Bun ${Bun.version}`,
    scope: "packed_piclaw_model_services_public_sdk_auth_only", modulePaths: paths,
    tarballSha256: provenance.tarballSha256, sourceCommit: provenance.sourceCommit,
    packedModuleSha256: moduleDigests, sdkFileSha256,
    results, mockedTokenRequests: requests.length, unexpectedNetwork,
    inference: "not_invoked", cliLogin: "not_exercised", webUi: "not_exercised",
    networkGuard: "fetch_and_preconnect_only_no_os_network_sandbox",
  }));
} finally {
  globalThis.fetch = originalFetch;
  blocker.closeAllConnections();
  await new Promise(accept => blocker.close(accept));
}
