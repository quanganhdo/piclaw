import { expect, test } from 'bun:test';
import { chromium } from 'playwright';
import { createTempWorkspace, setEnv } from '../helpers';
import { closeDatabase, initDatabase, createWebSession, getDb } from '../../src/db';
import { WEB_RUNTIME_CONFIG } from '../../src/core/config-web';
import { createSingleUserPasskeyHandler } from '../../src/channels/web/auth/single-user-passkeys';
import { WebauthnChallengeTracker } from '../../src/channels/web/auth/webauthn-challenges';
import { handleWebauthnLoginFinish, handleWebauthnLoginStart } from '../../src/channels/web/auth/webauthn-auth';
import { resetRateLimiterStateForTests } from '../../src/channels/web/http/rate-limit';
import { resolve } from 'node:path';
const browserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === '1' ? test : test.skip;

browserTest('two independent WebAuthn authenticators register, log in, persist and revoke via real verification', async () => {
  const ws = createTempWorkspace('passkey-protocol-');
  const restore = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data, PICLAW_DB_IN_MEMORY: '1', PICLAW_ACCESS_MODE: 'single-user' });
  const original = { passkeyMode: WEB_RUNTIME_CONFIG.passkeyMode, totpSecret: WEB_RUNTIME_CONFIG.totpSecret, trustProxy: WEB_RUNTIME_CONFIG.trustProxy };
  WEB_RUNTIME_CONFIG.passkeyMode = 'passkey-only'; WEB_RUNTIME_CONFIG.totpSecret = ''; WEB_RUNTIME_CONFIG.trustProxy = false;
  closeDatabase(); initDatabase(); resetRateLimiterStateForTests();
  createWebSession('fixture-owner', 'default', 3600, 'passkey');
  const handler = createSingleUserPasskeyHandler();
  const authContext = { accessMode: 'single-user' as const, isPasskeyEnabled: () => true, json: Response.json, buildSessionCookie: (token: string) => `piclaw_session=${token}; Path=/; HttpOnly; SameSite=Strict`, logAuthEvent: () => {}, getClientKey: () => 'fixture', challenges: new WebauthnChallengeTracker() };
  const built = await Bun.build({ entrypoints: [resolve(import.meta.dir, '../../web/shared/passkeys.ts')], target: 'browser' });
  if (!built.success) throw Error(String(built.logs));
  const js = await built.outputs[0].text();
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path.startsWith('/agent/passkeys')) return handler(req);
    if (path === '/auth/webauthn/login/start') return handleWebauthnLoginStart(req, authContext);
    if (path === '/auth/webauthn/login/finish') return handleWebauthnLoginFinish(req, authContext);
    if (path === '/helpers.js') return new Response(js, { headers: { 'Content-Type': 'text/javascript' } });
    return new Response('<!doctype html><button id="create">Create</button><button id="login">Login</button><script type="module">import * as api from "/helpers.js"; window.api=api;</script>', { headers: { 'Content-Type': 'text/html' } });
  } });
  const origin = `http://localhost:${server.port}`;
  const browser = await chromium.launch(); const context = await browser.newContext(); const page = await context.newPage();
  await context.addCookies([{ name: 'piclaw_session', value: 'fixture-owner', url: origin }]);
  const cdp = await context.newCDPSession(page); await cdp.send('WebAuthn.enable');
  const add = async () => (await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'usb', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } })).authenticatorId;
  let first: string, second: string;
  try {
    await page.goto(origin); await page.waitForFunction(() => Boolean((window as any).api));
    const create = (name: string) => page.evaluate(async name => {
      const api = (window as any).api;
      const start = await api.startPasskeyRegistration(name);
      const credential = await api.createPasskeyCredential(start.options, new AbortController().signal);
      await api.finishPasskeyRegistration(start.token, api.serializePasskeyCredential(credential));
      return credential.id as string;
    }, name);
    first = await add(); const firstId = await create('Laptop');
    const firstCredentials = (await cdp.send('WebAuthn.getCredentials', { authenticatorId: first })).credentials;
    expect(firstCredentials).toHaveLength(1);
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: first });
    second = await add(); const secondId = await create('Backup key');

    expect(firstId).not.toBe(secondId);
    expect(getDb().query('SELECT label,last_used_at FROM webauthn_credentials ORDER BY label').all()).toEqual([{ label: 'Backup key', last_used_at: null }, { label: 'Laptop', last_used_at: null }]);
    // Preserve the isolated DB file and reopen it to exercise restart persistence.
    const snapshot = resolve(ws.workspace, 'credential-reopen.db'); getDb().exec(`VACUUM INTO '${snapshot.replaceAll("'", "''")}'`);
    // The main persistence test covers reopening through the application; protocol test keeps
    // its in-memory store to avoid changing the test runner's shared DB mode.
    expect(await Bun.file(snapshot).exists()).toBe(true);
    const login = () => page.evaluate(async () => {
      const api = (window as any).api;
      const started = await (await fetch('/auth/webauthn/login/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
      const options = { ...started.options, challenge: api.decodeBase64Url(started.options.challenge), allowCredentials: (started.options.allowCredentials || []).map((c: any) => ({ ...c, id: api.decodeBase64Url(c.id) })) };
      const credential = await navigator.credentials.get({ publicKey: options }) as PublicKeyCredential;
      const response = credential.response as AuthenticatorAssertionResponse;
      const result = await fetch('/auth/webauthn/login/finish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: started.token, credential: { id: credential.id, rawId: api.encodeBase64Url(credential.rawId), type: credential.type, response: { clientDataJSON: api.encodeBase64Url(response.clientDataJSON), authenticatorData: api.encodeBase64Url(response.authenticatorData), signature: api.encodeBase64Url(response.signature), userHandle: response.userHandle ? api.encodeBase64Url(response.userHandle) : undefined }, clientExtensionResults: credential.getClientExtensionResults() } }) });
      return { status: result.status, id: credential.id };
    });
    await context.clearCookies(); expect(await login()).toEqual({ status: 200, id: secondId });
    expect((getDb().query('SELECT last_used_at FROM webauthn_credentials WHERE credential_id=?').get(secondId) as any).last_used_at).not.toBeNull();
    expect((getDb().query('SELECT last_used_at FROM webauthn_credentials WHERE credential_id=?').get(firstId) as any).last_used_at).toBeNull();
    const secondAfterLogin = (await cdp.send('WebAuthn.getCredentials', { authenticatorId: second })).credentials;
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: second });
    first = await add(); await cdp.send('WebAuthn.addCredential', { authenticatorId: first, credential: firstCredentials[0] });
    await context.clearCookies(); expect(await login()).toEqual({ status: 200, id: firstId });
    await page.evaluate(async id => (window as any).api.removePasskey(id), firstId);
    await context.clearCookies(); expect((await login()).status).toBe(400);
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: first });
    second = await add(); await cdp.send('WebAuthn.addCredential', { authenticatorId: second, credential: secondAfterLogin[0] });
    await context.clearCookies(); expect((await login()).status).toBe(200);
  } finally { await browser.close(); server.stop(true); closeDatabase(); Object.assign(WEB_RUNTIME_CONFIG, original); restore(); ws.cleanup(); resetRateLimiterStateForTests(); }
}, 60000);
