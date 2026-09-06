import { afterEach, beforeEach, expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import sharp from 'sharp';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import '../helpers.js';
import { getDb, initDatabase, closeDatabase } from '../../src/db/connection.js';
import { getUser } from '../../src/db/users.js';
import { createWebSession, revokeUserWebSessions } from '../../src/db/web-sessions.js';
import { provisionFamilyAccount, updateManagedAccount, updateOwnAccount } from '../../src/db/account-administration.js';
import { initializeAccountAvatars, readOwnAccountAvatar, readOwnAccountAvatarImage, updateOwnAccountAvatar, removeOwnAccountAvatar } from '../../src/db/account-avatar.js';
import { ACCOUNT_AVATAR_INPUT_BYTES } from '../../src/core/account-avatar.js';
import { resolveRequestPrincipal } from '../../src/channels/web/auth/principal.js';
import { RequestRouterService } from '../../src/channels/web/request-router-service.js';
import { WebAuthGateway } from '../../src/channels/web/auth/auth-gateway.js';
import { WebauthnChallengeTracker } from '../../src/channels/web/auth/webauthn-challenges.js';
import { TotpFailureTracker } from '../../src/channels/web/auth/totp-failure-tracker.js';
import { resetRateLimiterStateForTests } from '../../src/channels/web/http/rate-limit.js';

function actor(id: string) {
  const login = createWebSession(`token-${id}`, id, 3600, 'passkey');
  return resolveRequestPrincipal(new Request('https://family.local', { headers: { cookie: 'piclaw_session=fixture' } }), { mode: 'family-shared', authEnabled: true }, {
    getSession: () => login, getUser: () => getUser(getDb(), id), getLocalDisplayName: () => 'Unused',
  })!;
}
let admin: ReturnType<typeof actor>, alice: ReturnType<typeof actor>, bob: ReturnType<typeof actor>, png: Buffer;
beforeEach(async () => {
  closeDatabase(); initDatabase(); resetRateLimiterStateForTests(); admin = actor('default');
  const users = ['alice', 'bob'].map(name => {
    const user = provisionFamilyAccount(getDb(), admin, { username: name, displayName: name });
    getDb().query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key) VALUES (?,'family.local',?,'key')").run(user.id, name);
    updateManagedAccount(getDb(), admin, user.id, { enabled: true }, { totp: false, passkey: true, rpId: 'family.local' }); return actor(user.id);
  }); [alice, bob] = users as [typeof alice, typeof bob];
  png = await sharp({ create: { width: 320, height: 200, channels: 4, background: '#334455' } }).withExif({ IFD0: { Artist: 'PRIVATE_METADATA' } }).png().toBuffer();
});
afterEach(() => { closeDatabase(); resetRateLimiterStateForTests(); });

test('avatars persist by immutable owner, strip metadata, crop to static WebP and retain a deletion revision', async () => {
  const db = getDb(), sessions = db.query('SELECT * FROM web_sessions ORDER BY session_id').all();
  expect(readOwnAccountAvatar(db, alice)).toEqual({ user_id: alice.userId, revision: 0, present: false, can_edit: true });
  expect(readOwnAccountAvatarImage(db, alice)).toBeNull();
  const value = await updateOwnAccountAvatar(db, alice, 0, png, 'image/png');
  expect(value.revision).toBe(1); expect(value.present).toBe(true);
  expect(readOwnAccountAvatarImage(db, bob)).toBeNull(); expect(readOwnAccountAvatarImage(db, admin)).toBeNull();
  const bytes = readOwnAccountAvatarImage(db, alice)!; const meta = await sharp(bytes).metadata();
  expect(meta.format).toBe('webp'); expect([meta.width, meta.height]).toEqual([256, 256]); expect(meta.exif).toBeUndefined(); expect(meta.icc).toBeUndefined(); expect(meta.xmp).toBeUndefined();
  updateOwnAccount(db, alice, { username: 'renamed' }); expect(readOwnAccountAvatar(db, alice)).toEqual(value);
  expect(db.query('SELECT * FROM web_sessions ORDER BY session_id').all()).toEqual(sessions);
  initializeAccountAvatars(db); expect(readOwnAccountAvatarImage(db, alice)).toEqual(bytes);
  const dir = mkdtempSync(join(tmpdir(), 'piclaw-avatar-')), file = join(dir, 'avatar.sqlite'); db.query('VACUUM INTO ?').run(file); const reopened = new Database(file);
  try { expect(readOwnAccountAvatarImage(reopened, alice)).toEqual(bytes); } finally { reopened.close(); rmSync(dir, { recursive: true, force: true }); }
  expect(removeOwnAccountAvatar(db, alice, 1)).toEqual({ ...value, revision: 2, present: false });
  expect(removeOwnAccountAvatar(db, alice, 2).revision).toBe(2); expect(readOwnAccountAvatarImage(db, alice)).toBeNull();
  await expect(updateOwnAccountAvatar(db, alice, 1, png, 'image/png')).rejects.toThrow('Refresh');
  expect((await updateOwnAccountAvatar(db, alice, 2, png, 'image/png')).revision).toBe(3);
});

test('strict upload validation denies SVG, mismatched types, truncation, animation, excess bytes and pixels without writing', async () => {
  const animated = await sharp({ create: { width: 2, height: 4, channels: 4, background: 'red' } }).raw().toBuffer();
  animated.fill(0, 16, 32); // Distinct frames; the WebP encoder coalesces identical ones.
  const webp = await sharp(animated, { raw: { width: 2, height: 4, channels: 4, pageHeight: 2 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
  expect((await sharp(webp, { animated: true }).metadata()).pages).toBe(2);
  const large = await sharp({ create: { width: 2001, height: 2000, channels: 3, background: 'white' } }).png().toBuffer();
  const apng = Buffer.concat([png.subarray(0, 33), Buffer.from([0,0,0,8]), Buffer.from('acTL'), Buffer.alloc(12), png.subarray(33)]);
  for (const [input, type] of [[Buffer.from('<svg/>'), 'image/svg+xml'], [Buffer.from('<svg/>'), 'image/png'], [png, 'image/jpeg'], [png.subarray(0, 60), 'image/png'], [Buffer.alloc(0), 'image/png'], [Buffer.alloc(ACCOUNT_AVATAR_INPUT_BYTES+1), 'image/png'], [webp, 'image/webp'], [apng, 'image/png'], [large, 'image/png']] as const) {
    await expect(updateOwnAccountAvatar(getDb(), alice, 0, input, type)).rejects.toThrow();
    expect(readOwnAccountAvatar(getDb(), alice).revision).toBe(0);
  }
  for (const [format, type] of [['jpeg', 'image/jpeg'], ['webp', 'image/webp']] as const) {
    const bytes = await sharp(png).toFormat(format).toBuffer();
    const revision = readOwnAccountAvatar(getDb(), alice).revision;
    expect((await updateOwnAccountAvatar(getDb(), alice, revision, bytes, type)).present).toBe(true);
  }
});

test('live authentication, decode races, concurrent revisions and failed writes enforce owner authority atomically', async () => {
  const db = getDb();
  for (const forged of [{ ...alice, userId: bob.userId }, { ...admin, userId: alice.userId }, { ...alice, mode: 'single-user' }] as any[]) {
    expect(() => readOwnAccountAvatarImage(db, forged)).toThrow(); await expect(updateOwnAccountAvatar(db, forged, 0, png, 'image/png')).rejects.toThrow();
  }
  db.query('UPDATE web_sessions SET created_at=? WHERE session_id=?').run(new Date(Date.now()-600000).toISOString(), alice.authentication.sessionId!);
  const results = await Promise.allSettled([updateOwnAccountAvatar(db, alice, 0, png, 'image/png'), updateOwnAccountAvatar(db, alice, 0, png, 'image/png')]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(readOwnAccountAvatar(db, alice).revision).toBe(1);
  db.exec("CREATE TRIGGER fail_avatar BEFORE UPDATE ON user_avatars BEGIN SELECT RAISE(ABORT,'write failed'); END");
  await expect(updateOwnAccountAvatar(db, alice, 1, png, 'image/png')).rejects.toThrow('write failed');
  expect(() => removeOwnAccountAvatar(db, alice, 1)).toThrow('write failed'); expect(readOwnAccountAvatar(db, alice).revision).toBe(1);
  db.exec('DROP TRIGGER fail_avatar');
  const pending = updateOwnAccountAvatar(db, alice, 1, png, 'image/png'); revokeUserWebSessions(alice.userId);
  await expect(pending).rejects.toThrow(); expect(() => readOwnAccountAvatarImage(db, alice)).toThrow(); expect(() => removeOwnAccountAvatar(db, alice, 1)).toThrow();
  expect(db.query('SELECT revision FROM user_avatars WHERE user_id=?').get(alice.userId)).toEqual({ revision: 1 });
  db.query('UPDATE users SET enabled=0 WHERE id=?').run(bob.userId); expect(() => readOwnAccountAvatar(db, bob)).toThrow();
});

function router() {
  const json = (value: unknown, status=200) => Response.json(value, { status });
  const authGateway = new WebAuthGateway({ accessMode: 'family-shared', passkeyMode: '', totpSecret: '', internalSecret: '', hasTls: true, sessionTtlSeconds: 3600 }, { json, challenges: new WebauthnChallengeTracker(), failureTracker: new TotpFailureTracker() });
  return new RequestRouterService({ json, authGateway } as any, 'family-shared');
}
const headers = () => ({ cookie: `piclaw_session=token-${alice.userId}`, origin: 'https://family.local', 'x-piclaw-account-id': alice.userId, 'x-piclaw-login-id': alice.authentication.sessionId!, 'x-piclaw-avatar-revision': '0', 'content-type': 'image/png' });

test('production HTTP avatar routes demand pins/Origin, exclude selectors/admin/legacy paths and return private raster bytes', async () => {
  const server = router();
  const req = (path = '/account/avatar', method = 'GET', body?: BodyInit, overrides: Record<string, string> = {}) => server.handle(new Request('https://family.local'+path, { method, headers: { ...headers(), ...overrides }, body }));
  expect((await req('/account/avatar/image')).status).toBe(404);
  expect((await req('/account/avatar', 'POST', png, { origin: '' })).status).toBe(403);
  expect((await req('/account/avatar', 'POST', png, { origin: 'https://evil.local' })).status).toBe(403);
  expect((await req('/account/avatar', 'POST', png, { 'x-piclaw-avatar-revision': '-1' })).status).toBe(403);
  const missingPins = headers(); delete (missingPins as any)['x-piclaw-account-id']; delete (missingPins as any)['x-piclaw-login-id'];
  expect((await server.handle(new Request('https://family.local/account/avatar/image', { headers: missingPins }))).status).toBe(403);
  expect((await req('/account/avatar', 'POST', png, { 'x-piclaw-account-id': bob.userId })).status).toBe(409);
  expect((await req('/account/avatar?user_id='+bob.userId)).status).toBe(403);
  expect((await req('/account/avatar', 'POST', png)).status).toBe(200);
  const image = await req('/account/avatar/image'); expect(image.status).toBe(200); expect(image.headers.get('content-type')).toBe('image/webp');
  expect(image.headers.get('cache-control')).toBe('private, no-store'); expect(image.headers.get('vary')).toContain('Cookie'); expect(image.headers.get('x-content-type-options')).toBe('nosniff');
  expect(new Uint8Array(await image.arrayBuffer())).toEqual(readOwnAccountAvatarImage(getDb(), alice)!);
  expect((await req('/account/avatar', 'POST', png)).status).toBe(400);
  for (const path of ['/avatar/user', `/admin/users/${alice.userId}/avatar`, '/account/avatar/image?user_id='+bob.userId]) expect((await req(path)).status).toBe(403);
  expect((await req('/account/avatar', 'DELETE', JSON.stringify({ expected_revision: 1, user_id: bob.userId }))).status).toBe(403);
  expect((await req('/account/avatar', 'DELETE', JSON.stringify({ expected_revision: 1 }))).status).toBe(200);
  expect((await req('/account/avatar/image')).status).toBe(404);
});

test('chunked/lying-length requests are bounded, cancellation and revocation during upload never commit', async () => {
  const server = router(); let cancelled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(ACCOUNT_AVATAR_INPUT_BYTES+1)); }, cancel() { cancelled = true; } });
  expect((await server.handle(new Request('https://family.local/account/avatar', { method: 'POST', headers: { ...headers(), 'content-length': '1' }, body: stream }))).status).toBe(400);
  expect(cancelled).toBe(true);
  const controller = new AbortController(); let started!: () => void, aborted = false;
  const ready = new Promise<void>(resolve => started = resolve);
  const never = new ReadableStream({ pull() { started(); }, cancel() { aborted = true; } });
  const cancelledResponse = server.handle(new Request('https://family.local/account/avatar', { method: 'POST', headers: headers(), body: never, signal: controller.signal }));
  await ready; controller.abort(); expect((await cancelledResponse).status).toBe(400); expect(aborted).toBe(true);
  let enqueue!: (value: Buffer) => void, finish!: () => void, entered!: () => void;
  const reading = new Promise<void>(resolve => entered = resolve);
  const delayed = new ReadableStream({ start(controller) { enqueue = bytes => controller.enqueue(bytes); finish = () => controller.close(); }, pull() { entered(); } });
  const response = server.handle(new Request('https://family.local/account/avatar', { method: 'POST', headers: headers(), body: delayed }));
  await reading; revokeUserWebSessions(alice.userId); enqueue(png); finish(); expect((await response).status).toBe(403);
  expect(getDb().query('SELECT * FROM user_avatars').all()).toEqual([]);
});
