import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { randomBytes } from 'node:crypto';
import { getDb } from '../../../db/connection.js';
import { getWebSession, DEFAULT_WEB_USER_ID } from '../../../db/web-sessions.js';
import { getUser } from '../../../db/users.js';
import { getWebRuntimeConfig } from '../../../core/config.js';
import { readAccessConfig } from '../../../core/config-access.js';
import { getSessionTokenFromRequest } from './session-auth.js';
import { getRequestOriginParts } from '../../../utils/request-client.js';
import { isPasskeyEnabled } from './auth-runtime.js';
import { isRateLimited } from '../http/rate-limit.js';
import { createLogger, debugSuppressedError } from '../../../utils/logger.js';
const log = createLogger('web.single-user-passkeys');

const RECENT_MS = 5 * 60_000;
type WebauthnServer = Pick<typeof import('@simplewebauthn/server'), 'generateRegistrationOptions' | 'verifyRegistrationResponse'>;
class PasskeyError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'invalid_request') { super(message); }
}
interface Ceremony { sessionId: string; name: string; challenge: string; rpId: string; origin: string; expiresAt: number }

export function validateSingleUserPasskeyName(value: unknown): string {
  if (typeof value !== 'string') throw new PasskeyError('Enter a passkey name.');
  const name = value.trim();
  if (!name || [...name].length > 80 || /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(name)) throw new PasskeyError('Use 1–80 characters without control characters.');
  return name;
}
function policy() {
  const config = getWebRuntimeConfig();
  return { passkey: isPasskeyEnabled({ ...config, accessMode: 'single-user', internalSecret: '', hasTls: false, sessionTtlSeconds: config.sessionTtl }),
    totp: config.passkeyMode !== 'passkey-only' && Boolean(config.totpSecret.trim()) };
}
function originInfo(req: Request) {
  // Trust forwarded authority only if the deployment explicitly trusts its proxy.
  const { host, proto } = getRequestOriginParts(req);
  const origin = new URL(`${proto}://${host}`).origin;
  const rpId = new URL(origin).hostname;
  if (!rpId || !['https:', 'http:'].includes(new URL(origin).protocol)) throw new PasskeyError('Invalid origin.', 403);
  return { origin, rpId };
}
function requireActor(req: Request, now: number, recent: boolean) {
  if (readAccessConfig().mode !== 'single-user') throw new PasskeyError('Not found.', 404);
  if (req.headers.get('sec-fetch-site') === 'cross-site') throw new PasskeyError('Origin not allowed.', 403);
  const supplied = req.headers.get('origin');
  const { origin, rpId } = originInfo(req);
  if ((req.method !== 'GET' && supplied !== origin) || (supplied !== null && supplied !== origin)) throw new PasskeyError('Origin not allowed.', 403);
  const token = getSessionTokenFromRequest(req);
  const session = token ? getWebSession(token) : null;
  const user = session ? getUser(getDb(), session.user_id) : null;
  const methods = policy();
  if (!session?.session_id || session.user_id !== DEFAULT_WEB_USER_ID || !user?.enabled
    || !((session.auth_method === 'passkey' && methods.passkey) || (session.auth_method === 'totp' && methods.totp))) {
    throw new PasskeyError('Sign in to manage passkeys.', 401, 'sign_in_required');
  }
  const age = now - Date.parse(session.created_at);
  const fresh = Number.isFinite(age) && age >= 0 && age <= RECENT_MS;
  if (recent && !fresh) throw new PasskeyError('Sign in again, then refresh this list to make changes.', 403, 'recent_auth_required');
  return { sessionId: session.session_id as string, fresh, origin, rpId, methods };
}
function usableCount(rpId: string, methods: ReturnType<typeof policy>) {
  const row = getDb().query('SELECT COUNT(*) AS count FROM webauthn_credentials WHERE user_id=? AND rp_id=?').get(DEFAULT_WEB_USER_ID, rpId) as { count: number };
  return Number(methods.totp) + (methods.passkey ? row.count : 0);
}
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } }); }
function requireKeys(body: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new PasskeyError('Unexpected request field.');
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  if (!req.body) throw new PasskeyError('Invalid JSON.');
  const reader = req.body.getReader(); let size = 0;
  const chunks: Uint8Array[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new PasskeyError('Request body timed out.', 408)), 10_000); });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.length; if (size > 65_536) throw new PasskeyError('Request body too large.', 413);
      chunks.push(value);
    }
    try {
      const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
      return parsed;
    } catch { throw new PasskeyError('Invalid JSON.'); }
  } finally { clearTimeout(timer); void reader.cancel().catch(error => debugSuppressedError(log, 'Request body cleanup failed after completion.', error)); }
}

/** Private owner-session management. No internal-token/no-auth bypass, account selectors,
 * automatic enrolment links or shared challenge tracker with the public login routes. */
export function createSingleUserPasskeyHandler(options: { server?: WebauthnServer; now?: () => number } = {}) {
  const ceremonies = new Map<string, Ceremony>();
  const clock = options.now ?? Date.now;
  return async function handle(req: Request): Promise<Response> {
    try {
      const path = new URL(req.url).pathname;
      if (new URL(req.url).search) throw new PasskeyError('Query selectors are not accepted.');
      if (!['GET', 'POST'].includes(req.method) || !['/agent/passkeys', '/agent/passkeys/register/start', '/agent/passkeys/register/finish'].includes(path)) return json({ error: 'Not found.' }, 404);
      if (req.method === 'GET' && path !== '/agent/passkeys') return json({ error: 'Not found.' }, 404);
      let actor = requireActor(req, clock(), req.method !== 'GET');
      if (req.method === 'GET') {
        const keys = getDb().query('SELECT credential_id,label,rp_id,created_at,last_used_at FROM webauthn_credentials WHERE user_id=? ORDER BY created_at,credential_id')
          .all(DEFAULT_WEB_USER_ID) as Array<{ credential_id: string; label: string; rp_id: string; created_at: string; last_used_at: string | null }>;
        const count = usableCount(actor.rpId, actor.methods);
        return json({ passkeys: keys.map(key => {
          const usable = actor.methods.passkey && key.rp_id === actor.rpId;
          return { id: key.credential_id, name: key.label || `Passkey ${key.credential_id.slice(0, 8)}…`, createdAt: key.created_at, lastUsedAt: key.last_used_at, rpId: key.rp_id, usable, removable: actor.fresh && count - Number(usable) > 0 };
        }), recent_auth: actor.fresh, enabled: actor.methods.passkey, rp_id: actor.rpId, reauthenticate_url: '/login', unavailable_reason: actor.methods.passkey ? null : 'Passkeys are disabled by the login policy.' });
      }
      if (isRateLimited(req, 'single-user/passkeys', RECENT_MS, 20)) throw new PasskeyError('Too many passkey changes. Try again later.', 429);
      const body = await readBody(req);
      actor = requireActor(req, clock(), true);
      if (path === '/agent/passkeys') {
        const action = body.action;
        if (action !== 'rename' && action !== 'remove') throw new PasskeyError('Unknown passkey action.');
        requireKeys(body, action === 'rename' ? ['action', 'id', 'name'] : ['action', 'id']);
        if (typeof body.id !== 'string' || !/^[A-Za-z0-9_-]{1,2048}$/.test(body.id)) throw new PasskeyError('Invalid credential identifier.');
        const name = action === 'rename' ? validateSingleUserPasskeyName(body.name) : '';
        getDb().transaction(() => {
          const current = requireActor(req, clock(), true);
          const credential = getDb().query('SELECT rp_id FROM webauthn_credentials WHERE user_id=? AND credential_id=?').get(DEFAULT_WEB_USER_ID, body.id as string) as { rp_id: string } | null;
          if (!credential) throw new PasskeyError('Passkey not found. Refresh the list.', 404);
          if (action === 'rename') getDb().query('UPDATE webauthn_credentials SET label=? WHERE user_id=? AND credential_id=?').run(name, DEFAULT_WEB_USER_ID, body.id as string);
          else {
            const selectedUsable = current.methods.passkey && credential.rp_id === current.rpId;
            if (usableCount(current.rpId, current.methods) - Number(selectedUsable) < 1) throw new PasskeyError('Add another usable sign-in method before removing this passkey.', 409, 'last_factor');
            getDb().query('DELETE FROM webauthn_credentials WHERE user_id=? AND credential_id=?').run(DEFAULT_WEB_USER_ID, body.id as string);
          }
        }).immediate();
        return json({ ok: true });
      }
      if (!actor.methods.passkey) throw new PasskeyError('Passkeys are disabled.', 403);
      if (!actor.origin.startsWith('https://') && !['localhost', '127.0.0.1', '[::1]'].includes(actor.rpId)) throw new PasskeyError('Passkey creation requires HTTPS or localhost.', 403);
      for (const [key, value] of ceremonies) if (value.expiresAt <= clock()) ceremonies.delete(key);
      const server = options.server ?? await import('@simplewebauthn/server');
      if (path.endsWith('/start')) {
        requireKeys(body, ['name']);
        const name = validateSingleUserPasskeyName(body.name);
        const existing = getDb().query('SELECT credential_id FROM webauthn_credentials WHERE user_id=? AND rp_id=?').all(DEFAULT_WEB_USER_ID, actor.rpId) as { credential_id: string }[];
        const creation = await server.generateRegistrationOptions({ rpName: 'Piclaw', rpID: actor.rpId, userID: new TextEncoder().encode(DEFAULT_WEB_USER_ID), userName: DEFAULT_WEB_USER_ID, userDisplayName: 'Owner', attestationType: 'none', authenticatorSelection: { residentKey: 'required', userVerification: 'required' }, excludeCredentials: existing.map(c => ({ id: c.credential_id })) });
        const current = requireActor(req, clock(), true);
        if (current.sessionId !== actor.sessionId || !current.methods.passkey) throw new PasskeyError('Registration expired.', 403);
        if (ceremonies.size >= 100) throw new PasskeyError('Too many pending ceremonies. Try again later.', 429);
        const token = randomBytes(32).toString('base64url');
        ceremonies.set(token, { sessionId: actor.sessionId, name, challenge: creation.challenge, rpId: actor.rpId, origin: actor.origin, expiresAt: clock() + RECENT_MS });
        return json({ token, options: creation });
      }
      requireKeys(body, ['token', 'credential']);
      const token = typeof body.token === 'string' ? body.token : '';
      const pending = ceremonies.get(token);
      if (!pending || pending.sessionId !== actor.sessionId || pending.rpId !== actor.rpId || pending.origin !== actor.origin) throw new PasskeyError('Registration expired or does not belong to this session.', 403);
      ceremonies.delete(token); // Single-use even across overlapping asynchronous verification.
      let verified;
      try {
        verified = await server.verifyRegistrationResponse({ response: body.credential as RegistrationResponseJSON, expectedChallenge: pending.challenge, expectedOrigin: pending.origin, expectedRPID: pending.rpId, requireUserVerification: true });
      } catch { throw new PasskeyError('Passkey verification failed.', 400); }
      const info = verified.registrationInfo;
      if (!verified.verified || !info) throw new PasskeyError('Passkey verification failed.');
      getDb().transaction(() => {
        const current = requireActor(req, clock(), true);
        if (current.sessionId !== pending.sessionId || !current.methods.passkey || pending.expiresAt <= clock()) throw new PasskeyError('Registration expired.', 403);
        if (getDb().query('SELECT 1 FROM webauthn_credentials WHERE credential_id=?').get(info.credential.id)) throw new PasskeyError('This passkey is already registered.', 409);
        getDb().query(`INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key,sign_count,transports,created_at,last_used_at,label)
          VALUES (?,?,?,?,?,?,?,NULL,?)`).run(DEFAULT_WEB_USER_ID, pending.rpId, info.credential.id, Buffer.from(info.credential.publicKey).toString('base64url'), info.credential.counter, info.credential.transports ? JSON.stringify(info.credential.transports) : null, new Date(clock()).toISOString(), pending.name);
      }).immediate();
      return json({ ok: true });
    } catch (error) {
      if (error instanceof PasskeyError) return json({ error: error.message, code: error.code }, error.status);
      // Keep crypto/storage details out of both client responses and logs.
      log.warn('Passkey request failed.', { operation: 'passkey_settings.request_failed' });
      return json({ error: 'Passkey request failed. Refresh the list before retrying.' }, 500);
    }
  };
}
export const handleSingleUserPasskeys = createSingleUserPasskeyHandler();
