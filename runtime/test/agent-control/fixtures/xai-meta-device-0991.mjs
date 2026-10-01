import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";

assert.ok(typeof Bun !== "undefined", "Bun is the only qualification runtime.");
assert.ok(process.env.SYNTHETIC_PARENT_NETNS);
assert.notEqual(readlinkSync("/proc/self/ns/net"), process.env.SYNTHETIC_PARENT_NETNS, "A distinct network namespace is required.");
assert.deepEqual(readFileSync("/proc/net/dev", "utf8").trim().split("\n").slice(2).map(line => line.split(":")[0].trim()), ["lo"]);
assert.equal(readFileSync("/proc/net/route", "utf8").trim().split("\n").length, 1);
assert.equal(process.getuid(), Number(process.env.SYNTHETIC_EXPECT_UID)); assert.notEqual(process.getuid(), 0);
const status = readFileSync("/proc/self/status", "utf8");
for (const field of ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"]) assert.match(status, new RegExp(`${field}:\\s+0{16}(?:\\n|$)`));
assert.match(status, /NoNewPrivs:\s+1(?:\n|$)/); assert.match(status, /Groups:\s*\n/);
const originalFetch = globalThis.fetch;
let bootstrapRequests = 0;
const denyBootstrap = () => { bootstrapRequests++; throw new Error("Unexpected import-time request."); };
globalThis.fetch = Object.assign(denyBootstrap, { preconnect: denyBootstrap });
const root = import.meta.resolve("@earendil-works/pi-ai");
assert.equal(JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", root)), "utf8")).version, "0.99.1");
const sdkFileSha256 = {
  "xai.js": "d34783560dc2ac75d6e717b248136eb75a902fbd53b3e56fb9f2ec50c6c793d7",
  "meta.js": "852ceb0cb0d14e92f78dbc5aacbe345e0416e3b65c574f6acc1f5191566b6870",
  "device-code.js": "8f197cc9af67be64b82939573d719d1b55388f96f2e53cb8c47f9618fc1297eb",
  "providers/xai.js": "e5d69e97c788ce044f6c225fb38c04ec5b04defa639c02abfb022b466a90b9e9",
  "providers/meta.js": "f0ba7b97a407336f30cfb230c4c32bece9e0fd23b0ebdbdae11503374e5ab44c",
  "auth/helpers.js": "afa67f03895ace888d574c0c86c226cab35521cecc51fe4c0320ba710fb32a97",
  "auth/oauth/load.js": "fb73105e414825e6c599ed8c00783fbd597fea1913e5625cc56910e27b761182",
};
for (const [file, hash] of Object.entries(sdkFileSha256)) assert.equal(createHash("sha256").update(readFileSync(fileURLToPath(new URL(file.includes("/") ? file : `auth/oauth/${file}`, root)))).digest("hex"), hash);
const commonModes = ["pending-success", "slow-down", "denied", "malformed-device", "malformed-token", "unsafe-device-uri", "unsafe-complete-safe-basic", "unsafe-basic-safe-complete", "expiry", "initial-wait-cancel", "blocked-start-cancel", "blocked-poll-cancel", "pre-abort"];
const results = [];
try {
  const { xaiProvider } = await import("@earendil-works/pi-ai/providers/xai");
  const { metaProvider } = await import("@earendil-works/pi-ai/providers/meta");
  assert.equal(bootstrapRequests, 0);
  const providers = [xaiProvider(), metaProvider()];
  assert.deepEqual(providers.map(provider => provider.id), ["xai", "meta"]);
  for (const provider of providers) {
    const xai = provider.id === "xai", oauth = provider.auth.oauth;
    assert.ok(oauth);
    const extraModes = xai ? ["refresh-preserves-token", "refresh-denied", "token-default-lifetime"] : ["mint-missing-key", "mint-session-expired", "blocked-mint-cancel", "refresh-session-expired"];
    for (const mode of [...commonModes, ...extraModes]) {
      const controller = new AbortController();
      const counts = { device: 0, poll: 0, mint: 0, refresh: 0, unexpected: 0 };
      const polls = [];
      let deviceAt = 0, deviceEvent = false, progressEvent = false, transportAborted = false, abortAt = 0, cancellationTimer;
      let settled = false, lateEvents = 0, lateRequests = 0, progressCount = 0, preAbortedFetch = false;
      let rejectDeadline;
      const deadline = new Promise((_resolve, reject) => { rejectDeadline = reject; });
      const watchdog = setTimeout(() => { controller.abort(); rejectDeadline(new Error("Fixture deadline exceeded.")); }, 12_000);
      const started = Date.now();
      const deviceUrl = xai ? "https://auth.x.ai/oauth2/device/code" : "https://auth.meta.com/oidc/device/authorization/";
      const tokenUrl = xai ? "https://auth.x.ai/oauth2/token" : "https://auth.meta.com/oidc/device/token/";
      const mintUrl = "https://api.meta.ai/muse-code/key";
      const client = xai ? "b1a00492-073a-47ea-816f-4c329264a828" : "1031625952748946";
      const verification = xai ? "https://auth.x.ai/device" : "https://auth.meta.com/device";
      const refreshOnly = mode.startsWith("refresh-");
      const mixedUri = mode === "unsafe-complete-safe-basic" || mode === "unsafe-basic-safe-complete";
      const uriRejected = mode === "unsafe-device-uri" || xai && mixedUri;
      const blockUntilAbort = signal => new Promise((_resolve, reject) => {
        const abort = () => { transportAborted = true; reject(new DOMException("Synthetic abort", "AbortError")); };
        if (signal.aborted) { abort(); return; }
        signal.addEventListener("abort", abort, { once: true });
        queueMicrotask(() => { abortAt = performance.now(); controller.abort(); });
      });
      try {
        globalThis.fetch = Object.assign(async (input, init) => {
          try {
            if (settled) { lateRequests++; throw new Error("Request after settlement."); }
            const url = String(input), headers = new Headers(init?.headers);
            if (init?.signal?.aborted) { assert.equal(mode, "pre-abort"); preAbortedFetch = true; }
            assert.equal(init?.method, "POST"); assert.ok(init.signal); assert.equal(headers.get("accept"), "application/json");
            if (url === mintUrl) {
              assert.equal(xai, false); counts.mint++;
              assert.equal(headers.get("content-type"), "application/json"); assert.equal(headers.get("x-api-version"), "1.0.0");
              assert.equal(headers.get("authorization"), "Bearer synthetic-meta-identity"); assert.equal(init.body, "{}");
              if (mode === "blocked-mint-cancel") return blockUntilAbort(init.signal);
              if (mode === "mint-session-expired" || mode === "refresh-session-expired") return Response.json({ error: "identity_expired" }, { status: 401 });
              if (mode === "mint-missing-key") return Response.json({ action_url: "https://fixture.invalid/setup" });
              return Response.json({ api_key: counts.mint === 1 ? "synthetic-meta-key" : "synthetic-meta-key-rotated" });
            }
            assert.ok(url === deviceUrl || url === tokenUrl);
            assert.equal(headers.get("content-type"), "application/x-www-form-urlencoded");
            const body = new URLSearchParams(init.body);
            assert.equal(body.get("client_id"), client);
            if (url === deviceUrl) {
              counts.device++; deviceAt = performance.now(); assert.equal(counts.device, 1);
              assert.deepEqual([...body.keys()].sort(), xai ? ["client_id", "referrer", "scope"] : ["client_id"]);
              if (xai) { assert.equal(body.get("referrer"), "pi"); assert.equal(body.get("scope"), "openid profile email offline_access grok-cli:access api:access"); }
              if (mode === "blocked-start-cancel" || mode === "pre-abort") return blockUntilAbort(init.signal);
              if (mode === "malformed-device") return Response.json({ device_code: "synthetic-device" });
              return Response.json({ device_code: "synthetic-device", user_code: "SYNTHETIC-DEVICE-CODE",
                verification_uri: mode === "unsafe-device-uri" || mode === "unsafe-basic-safe-complete" ? "javascript:alert(1)" : verification,
                verification_uri_complete: mode === "unsafe-device-uri" || mode === "unsafe-complete-safe-basic" ? "javascript:alert(1)" : `${verification}?code=SYNTHETIC-DEVICE-CODE`, interval: 1, expires_in: mode === "expiry" ? 1 : 60 });
            }
            if (body.get("grant_type") === "refresh_token") {
              assert.equal(xai, true); counts.refresh++;
              assert.deepEqual([...body.keys()].sort(), ["client_id", "grant_type", "refresh_token"]);
              assert.equal(body.get("refresh_token"), "synthetic-xai-refresh");
              if (mode === "refresh-denied") return Response.json({ error: "invalid_grant" }, { status: 400 });
              return Response.json({ access_token: "synthetic-xai-rotated", ...(mode === "refresh-preserves-token" ? {} : { refresh_token: "synthetic-xai-refresh-rotated" }), expires_in: 3600 });
            }
            counts.poll++; polls.push(performance.now());
            assert.deepEqual([...body.keys()].sort(), ["client_id", "device_code", "grant_type"]);
            assert.equal(body.get("device_code"), "synthetic-device"); assert.equal(body.get("grant_type"), "urn:ietf:params:oauth:grant-type:device_code");
            if (mode === "blocked-poll-cancel") return blockUntilAbort(init.signal);
            if (mode === "denied") return Response.json({ error: "access_denied" }, { status: 400 });
            if (mode === "malformed-token") return Response.json({ unsupported: true });
            if (mode === "pending-success" && counts.poll === 1) return Response.json({ error: "authorization_pending" }, { status: 400 });
            if (mode === "slow-down" && counts.poll === 1) return Response.json({ error: "slow_down", interval: 2 }, { status: 400 });
            return Response.json(xai ? { access_token: "synthetic-xai-access", refresh_token: "synthetic-xai-refresh", ...(mode === "token-default-lifetime" ? {} : { expires_in: 3600 }) } : { access_token: "synthetic-meta-identity" });
          } catch {
            counts.unexpected++; throw new Error("Unexpected device flow request or payload.");
          }
        }, { preconnect: () => { counts.unexpected++; throw new Error("Unexpected preconnect."); } });
        const interaction = {
          signal: controller.signal,
          prompt: async () => { throw new Error("Unexpected provider prompt."); },
          notify: event => {
            if (settled) { lateEvents++; throw new Error("Event after settlement."); }
            if (event.type === "device_code") {
              assert.equal(deviceEvent, false); deviceEvent = true;
              assert.equal(event.userCode, "SYNTHETIC-DEVICE-CODE");
              assert.equal(event.verificationUri, mode === "unsafe-complete-safe-basic" ? verification : `${verification}?code=SYNTHETIC-DEVICE-CODE`);
              assert.equal(event.intervalSeconds, 1); assert.equal(event.expiresInSeconds, mode === "expiry" ? 1 : 60);
              if (mode === "initial-wait-cancel") cancellationTimer = setTimeout(() => { abortAt = performance.now(); controller.abort(); }, 25);
            } else {
              assert.equal(xai, false); assert.equal(event.type, "progress"); assert.equal(counts.poll > 0, true); assert.equal(counts.mint, 0);
              progressCount++; assert.equal(progressCount, 1);
              assert.equal(event.message, "Enabling Meta Model API access...");
              progressEvent = true;
            }
          },
        };
        if (mode === "pre-abort") controller.abort();
        const previous = { type: "oauth", access: xai ? "synthetic-xai-access" : "synthetic-meta-key", refresh: xai ? "synthetic-xai-refresh" : "synthetic-meta-identity", expires: 1 };
        const operation = refreshOnly ? oauth.refresh(previous, controller.signal) : oauth.login(interaction);
        const success = ["pending-success", "slow-down", "token-default-lifetime", "refresh-preserves-token"].includes(mode) || !xai && mixedUri;
        if (success) {
          const credential = await Promise.race([operation, deadline]);
          assert.equal(credential.type, "oauth");
          assert.equal(credential.access, xai ? refreshOnly ? "synthetic-xai-rotated" : "synthetic-xai-access" : "synthetic-meta-key");
          assert.equal(credential.refresh, xai ? "synthetic-xai-refresh" : "synthetic-meta-identity");
          const lifetime = xai ? 3_300_000 : 86_400_000;
          assert.ok(credential.expires >= started + lifetime && credential.expires <= Date.now() + lifetime);
          assert.deepEqual(await oauth.toAuth(credential), { apiKey: credential.access });
          if (!refreshOnly) {
            const renewed = await Promise.race([oauth.refresh(credential, controller.signal), deadline]);
            assert.equal(renewed.access, xai ? "synthetic-xai-rotated" : "synthetic-meta-key-rotated");
            assert.equal(renewed.refresh, xai ? "synthetic-xai-refresh-rotated" : "synthetic-meta-identity");
            assert.deepEqual(await oauth.toAuth(renewed), { apiKey: renewed.access });
          }
        } else {
          const expected = mode.includes("cancel") || mode === "pre-abort" ? /cancel|abort/i : mode === "expiry" ? /timed out/i
            : uriRejected ? /untrusted|invalid/i : mode === "malformed-device" || mode === "malformed-token" ? /invalid|failed/i
            : mode === "mint-missing-key" ? /did not issue an API key.*https:\/\/fixture.invalid\/setup/i
            : mode.includes("session-expired") ? /session expired.*\/login meta/i : /denied|invalid_grant/i;
          await assert.rejects(Promise.race([operation, deadline]), expected);
        }
        settled = true;
        const countsAtSettlement = { ...counts };
        // Keep the guards installed after provider settlement. Do not abort in
        // teardown until this real-time observation has checked late activity.
        await Bun.sleep(100);
        assert.deepEqual(counts, countsAtSettlement); assert.equal(lateRequests, 0); assert.equal(lateEvents, 0);
        assert.equal(counts.unexpected, 0);
        assert.equal(preAbortedFetch, mode === "pre-abort");
        const pollCount = ["pending-success", "slow-down"].includes(mode) ? 2 : refreshOnly || uriRejected || ["malformed-device", "expiry", "initial-wait-cancel", "blocked-start-cancel", "pre-abort"].includes(mode) ? 0 : 1;
        assert.equal(counts.device, refreshOnly ? 0 : 1); assert.equal(counts.poll, pollCount);
        assert.equal(counts.refresh, xai && success ? 1 : mode === "refresh-denied" ? 1 : 0);
        assert.equal(counts.mint, xai ? 0 : success ? 2 : ["mint-missing-key", "mint-session-expired", "blocked-mint-cancel", "refresh-session-expired"].includes(mode) ? 1 : 0);
        assert.equal(deviceEvent, !refreshOnly && !uriRejected && !["malformed-device", "blocked-start-cancel", "pre-abort"].includes(mode));
        assert.equal(progressEvent, !xai && !refreshOnly && counts.mint > 0);
        if (pollCount > 0) assert.ok(polls[0] - deviceAt >= 900 && polls[0] - deviceAt < 3500, "First polling interval outside its declared bound.");
        if (pollCount === 2) {
          const gap = polls[1] - polls[0];
          assert.ok(gap >= (mode === "slow-down" ? 1900 : 900) && gap < (mode === "slow-down" ? 4500 : 3500), "Polling backoff outside its declared bound.");
        }
        if (mode === "expiry") assert.ok(Date.now() - started >= 900);
        if (mode.includes("cancel") || mode === "pre-abort") assert.equal(controller.signal.aborted, true);
        if (mode.startsWith("blocked-") || mode === "pre-abort") assert.equal(transportAborted, true);
        if (abortAt > 0) assert.ok(performance.now() - abortAt < 850, "Cancellation was not prompt.");
        results.push({ provider: provider.id, mode, status: "pass", requests: counts, deviceEventObserved: deviceEvent,
          progressEventObserved: progressEvent, transportCancellationObserved: transportAborted,
          timingVerified: pollCount > 0 || mode === "expiry", backoffVerified: pollCount === 2,
          preAbortedFetchObserved: preAbortedFetch, postSettlementObservationMs: 100, lateEvents, lateRequests });
      } finally { clearTimeout(watchdog); clearTimeout(cancellationTimer); controller.abort(); }
    }
  }
  assert.equal(results.length, 33);
  assert.equal(new Set(results.map(row => `${row.provider}/${row.mode}`)).size, 33);
  console.log(JSON.stringify({ version: "0.99.1", runtime: `Bun ${Bun.version}`, scope: "public_xai_meta_device_and_refresh_methods_only", results, sdkFileSha256,
    bootstrapRequests, credentialPersistence: "none", inference: "not_invoked", networkGuard: "distinct_loopback_only_os_namespace_and_guarded_fetch" }));
} finally { globalThis.fetch = originalFetch; }
