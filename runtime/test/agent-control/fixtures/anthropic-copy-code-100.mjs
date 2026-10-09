import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const REDIRECT = "https://platform.claude.com/oauth/code/callback";
const TOKEN = "https://platform.claude.com/v1/oauth/token";
const CLIENT = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const code = "synthetic-copy-code", access = "synthetic-copy-access", refresh = "synthetic-copy-refresh";

// Observations at request/prompt/notification/settlement boundaries, not a syscall audit.
function assertNoListener() {
  for (const path of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    const rows = readFileSync(path, "utf8").trim().split("\n").slice(1).map(line => line.trim().split(/\s+/));
    assert.equal(rows.some(row => row[3] === "0A"), false, "Copy-code flow must not create a TCP listener.");
  }
}

export async function runCopyCodeCases(oauth) {
  const modes = ["code-state", "bare-code", "query", "callback-url", "unrelated-url", "empty", "bad-state", "denied", "malformed-json", "cancel-prompt", "cancel-exchange", "refresh-denied", "cancel-refresh", "unknown-selection", "cancel-selection", "pre-abort-selection", "pre-abort-manual"];
  const results = [];
  for (const mode of modes) {
    const controller = new AbortController();
    const counts = { selection: 0, manual: 0, url: 0, exchange: 0, refresh: 0, unexpected: 0 };
    let authUrl, settled = false, lateEvents = 0, lateRequests = 0, transportAborted = false, manualAborted = false, abortAt;
    let deadlineReject;
    const deadline = new Promise((_resolve, reject) => { deadlineReject = reject; });
    const watchdog = setTimeout(() => { controller.abort(); deadlineReject(new Error("Copy-code fixture deadline exceeded")); }, 5000);
    const abort = () => { abortAt = performance.now(); controller.abort(); };
    try {
      assertNoListener();
      const token = { access_token: access, refresh_token: refresh, expires_in: 3600 };
      globalThis.fetch = Object.assign(async (input, init) => {
        if (settled) lateRequests++;
        assertNoListener();
        try {
          assert.equal(String(input), TOKEN); assert.equal(init.method, "POST");
          assert.equal(new Headers(init.headers).get("content-type"), "application/json");
          assert.equal(new Headers(init.headers).get("accept"), "application/json");
          assert.ok(init.signal); assert.equal(init.signal.aborted, false);
          const body = JSON.parse(init.body);
          assert.equal(body.client_id, CLIENT);
          const renewing = body.grant_type === "refresh_token";
          if (renewing) {
            counts.refresh++;
            assert.deepEqual(Object.keys(body).sort(), ["client_id", "grant_type", "refresh_token"]);
            assert.equal(body.refresh_token, refresh);
          } else {
            counts.exchange++;
            assert.deepEqual(Object.keys(body).sort(), ["client_id", "code", "code_verifier", "grant_type", "redirect_uri", "state"]);
            assert.equal(body.grant_type, "authorization_code"); assert.equal(body.code, code);
            assert.equal(body.state, authUrl.searchParams.get("state")); assert.equal(body.code_verifier, body.state);
            assert.equal(createHash("sha256").update(body.code_verifier).digest("base64url"), authUrl.searchParams.get("code_challenge"));
            // Even accepted URL-form input cannot change the exchange redirect.
            assert.equal(body.redirect_uri, REDIRECT);
          }
          if ((!renewing && mode === "cancel-exchange") || (renewing && mode === "cancel-refresh")) {
            return new Promise((_resolve, reject) => {
              init.signal.addEventListener("abort", () => { transportAborted = true; reject(new DOMException("Synthetic cancellation", "AbortError")); }, { once: true });
              queueMicrotask(abort);
            });
          }
          if ((!renewing && mode === "denied") || (renewing && mode === "refresh-denied")) return Response.json({ error: "access_denied" }, { status: 400 });
          if (!renewing && mode === "malformed-json") return new Response("{invalid");
          return Response.json(renewing ? { ...token, access_token: "synthetic-copy-rotated", refresh_token: "synthetic-copy-refresh-rotated" } : token);
        } catch (error) { counts.unexpected++; throw error; }
      }, { preconnect() { counts.unexpected++; throw new Error("Unexpected preconnect"); } });
      const interaction = {
        signal: controller.signal,
        notify(event) {
          if (settled) lateEvents++;
          assertNoListener();
          assert.ok(["auth_url", "progress"].includes(event.type));
          if (event.type !== "auth_url") return;
          counts.url++;
          authUrl = new URL(event.url);
          assert.equal(authUrl.origin, "https://claude.ai"); assert.equal(authUrl.pathname, "/oauth/authorize");
          assert.equal(authUrl.searchParams.get("redirect_uri"), REDIRECT);
          assert.equal(authUrl.searchParams.get("client_id"), CLIENT);
          assert.equal(authUrl.searchParams.get("response_type"), "code");
          assert.equal(authUrl.searchParams.get("code_challenge_method"), "S256");
          assert.ok(authUrl.searchParams.get("state")); assert.ok(authUrl.searchParams.get("code_challenge"));
        },
        async prompt(prompt) {
          if (settled) lateEvents++;
          assertNoListener();
          if (prompt.type === "select") {
            counts.selection++;
            assert.equal(prompt.signal, undefined); // Host owns cancellation of this public prompt.
            assert.deepEqual(prompt.options.map(option => option.id), ["browser", "copy_code"]);
            if (mode === "cancel-selection") abort();
            if (mode !== "pre-abort-manual") controller.signal.throwIfAborted();
            return mode === "unknown-selection" ? "unsupported-choice" : "copy_code";
          }
          counts.manual++;
          assert.equal(prompt.type, "manual_code"); assert.equal(prompt.placeholder, "code#state");
          assert.equal(prompt.signal, controller.signal);
          controller.signal.throwIfAborted();
          if (mode === "cancel-prompt") return new Promise((_resolve, reject) => {
            prompt.signal.addEventListener("abort", () => { manualAborted = true; reject(new DOMException("Synthetic cancellation", "AbortError")); }, { once: true });
            queueMicrotask(abort);
          });
          const state = authUrl.searchParams.get("state");
          if (mode === "empty") return "  ";
          if (mode === "bad-state") return `${code}#wrong-state`;
          if (mode === "bare-code") return `  ${code}  `;
          if (mode === "query") return `code=${code}&state=${state}`;
          if (mode === "callback-url" || mode === "unrelated-url") return `${mode === "callback-url" ? REDIRECT : "https://unrelated.invalid/landing"}?code=${code}&state=${state}`;
          return `${code}#${state}`;
        },
      };
      if (mode.startsWith("pre-abort")) abort();
      const loginSuccess = ["code-state", "bare-code", "query", "callback-url", "unrelated-url", "refresh-denied", "cancel-refresh"].includes(mode);
      if (loginSuccess) {
        const credential = await Promise.race([oauth.login(interaction), deadline]);
        assert.equal(credential.type, "oauth"); assert.equal(credential.access, access); assert.equal(credential.refresh, refresh);
        assert.ok(credential.expires > Date.now() + 3_200_000 && credential.expires < Date.now() + 3_310_000);
        assert.deepEqual(await oauth.toAuth(credential), { apiKey: access });
        const operation = Promise.race([oauth.refresh(credential, controller.signal), deadline]);
        if (mode === "refresh-denied" || mode === "cancel-refresh") await assert.rejects(operation, mode === "refresh-denied" ? /failed.*status=400/is : /abort|cancel/i);
        else {
          const renewed = await operation;
          assert.equal(renewed.access, "synthetic-copy-rotated"); assert.equal(renewed.refresh, "synthetic-copy-refresh-rotated");
          assert.deepEqual(await oauth.toAuth(renewed), { apiKey: renewed.access });
        }
      } else {
        await assert.rejects(Promise.race([oauth.login(interaction), deadline]), mode === "empty" ? /Missing authorization code/ : mode === "bad-state" ? /state mismatch/ : mode === "unknown-selection" ? /Unknown Anthropic login method/ : mode === "denied" ? /failed.*status=400/is : mode === "malformed-json" ? /invalid JSON/ : /abort|cancel/i);
      }
      settled = true; const before = { ...counts }; await Bun.sleep(100); assert.deepEqual(counts, before);
      assert.equal(lateEvents, 0); assert.equal(lateRequests, 0); assert.equal(counts.unexpected, 0);
      assert.equal(counts.selection, 1);
      const noPrompt = ["unknown-selection", "cancel-selection", "pre-abort-selection"].includes(mode);
      assert.equal(counts.manual, noPrompt ? 0 : 1); assert.equal(counts.url, noPrompt ? 0 : 1);
      const noExchange = noPrompt || ["empty", "bad-state", "cancel-prompt", "pre-abort-manual"].includes(mode);
      assert.equal(counts.exchange, noExchange ? 0 : 1); assert.equal(counts.refresh, loginSuccess ? 1 : 0);
      assert.equal(transportAborted, ["cancel-exchange", "cancel-refresh"].includes(mode));
      assert.equal(manualAborted, mode === "cancel-prompt");
      if (abortAt !== undefined) assert.ok(performance.now() - abortAt < 900);
      assertNoListener();
      results.push({ mode, status: "pass", requests: counts, noListenerAtBoundaries: true, fixedExchangeRedirect: counts.exchange === 1,
        providedStateValidated: mode === "bad-state", transportCancellationObserved: transportAborted, manualCancellationObserved: manualAborted,
        preAbortRejectionOwner: mode === "pre-abort-selection" ? "host_selection_prompt" : mode === "pre-abort-manual" ? "host_manual_prompt_after_sdk_notification" : "not_applicable",
        lateEvents, lateRequests, postSettlementObservationMs: 100 });
    } finally { clearTimeout(watchdog); controller.abort(); }
  }
  return results;
}
