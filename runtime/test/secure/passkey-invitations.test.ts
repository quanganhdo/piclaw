import { afterEach, beforeEach, expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import '../helpers.js';
import { closeDatabase, getDb, initDatabase } from '../../src/db/connection.js';
import { initializeAuthFactorSchema } from '../../src/db/auth-factors-schema.js';
import { getUser } from '../../src/db/users.js';
import { createWebSession, getWebSession } from '../../src/db/web-sessions.js';
import { provisionFamilyAccount, readAdministrationSettings, updateManagedAccount } from '../../src/db/account-administration.js';
import { AccountInvitations } from '../../src/secure/account-invitations.js';
import { resetFamilyAccount } from '../../src/secure/account-recovery.js';
import { resolveRequestPrincipal } from '../../src/channels/web/auth/principal.js';
import { RequestRouterService } from '../../src/channels/web/request-router-service.js';
import { WebAuthGateway } from '../../src/channels/web/auth/auth-gateway.js';
import { TotpFailureTracker } from '../../src/channels/web/auth/totp-failure-tracker.js';
import { WebauthnChallengeTracker } from '../../src/channels/web/auth/webauthn-challenges.js';
import { resetRateLimiterStateForTests } from '../../src/channels/web/http/rate-limit.js';
import { pruneExpiredAuthState } from '../../src/db/auth-maintenance.js';
import { invitationKey, invitationProof, invitationLoginProof } from './passkey-fixture.js';
import { handleWebauthnLoginStart, handleWebauthnLoginFinish } from '../../src/channels/web/auth/webauthn-auth.js';

const origin = 'https://family.local', rp = 'family.local';
let admin: NonNullable<ReturnType<typeof resolveRequestPrincipal>>, alice: string, bob: string, clock: number, service: AccountInvitations;
const policy = { totp: false, passkey: true, rpId: rp };
beforeEach(() => {
  closeDatabase(); initDatabase(); resetRateLimiterStateForTests(); clock = Date.now();
  const login = createWebSession('admin-token','default',3600,'passkey');
  admin = resolveRequestPrincipal(new Request(origin,{headers:{cookie:'piclaw_session=fixture'}}),{mode:'family-shared',authEnabled:true},{getSession:()=>login,getUser:()=>getUser(getDb(),'default'),getLocalDisplayName:()=>''})!;
  alice = provisionFamilyAccount(getDb(),admin,{username:'alice',displayName:'Alice'}).id;
  bob = provisionFamilyAccount(getDb(),admin,{username:'bob',displayName:'Bob'}).id;
  service = new AccountInvitations(getDb(),undefined,()=>clock);
});
afterEach(() => { closeDatabase(); resetRateLimiterStateForTests(); });
async function claim(user = alice) { const grant = service.issue(admin,user,'passkey'); return { grant, start: await service.claimPasskey(grant.token,rp,origin) }; }
const finish = (value: Awaited<ReturnType<typeof claim>>, proof = invitationProof(invitationKey('new-passkey'), value.start.options.challenge)) => service.confirmPasskey(value.grant.token,value.start.browserToken,origin,value.start.enrolmentToken,rp,proof);

test('additive invitation migration retains old TOTP grants and is repeatable', () => {
  const db = new Database(':memory:');
  try {
    db.exec("CREATE TABLE user_auth_invitations(token_hash TEXT PRIMARY KEY,user_id TEXT UNIQUE,issuer_user_id TEXT,expires_at INTEGER,state TEXT,browser_hash TEXT,enrolment_hash TEXT,origin TEXT,created_at TEXT); INSERT INTO user_auth_invitations VALUES ('hash','old','default',999,'issued',NULL,NULL,NULL,'now')");
    initializeAuthFactorSchema(db); initializeAuthFactorSchema(db);
    expect(db.query('SELECT token_hash,method,rp_id,challenge FROM user_auth_invitations').get()).toEqual({token_hash:'hash',method:'totp',rp_id:null,challenge:null});
  } finally { db.close(); }
});

test('passkey invitation has immutable user handle, hashed browser/grant tokens, no seed and enables only recipient without login', async () => {
  const value = await claim(); const before = getUser(getDb(),alice)!;
  expect(value.grant.method).toBe('passkey'); expect(value.start.options.user.id).toBe(Buffer.from(alice).toString('base64url'));
  expect(value.start.options.authenticatorSelection).toMatchObject({residentKey:'required',userVerification:'required'});
  const stored = JSON.stringify(getDb().query('SELECT * FROM user_auth_invitations').get());
  for (const secret of [value.grant.token,value.start.browserToken,value.start.enrolmentToken]) expect(stored).not.toContain(secret);
  expect(getDb().query('SELECT * FROM user_totp_enrolments').all()).toEqual([]); expect(getUser(getDb(),alice)?.enabled).toBe(false);
  await expect(service.claim(value.grant.token,origin)).rejects.toThrow();
  service.checkPasskey(value.grant.token,value.start.browserToken,origin,value.start.enrolmentToken,rp);
  await finish(value); expect(getUser(getDb(),alice)).toMatchObject({id:before.id,username:before.username,home_chat_jid:before.home_chat_jid,role:before.role,enabled:true}); expect(getUser(getDb(),bob)?.enabled).toBe(false);
  expect(getDb().query('SELECT * FROM web_sessions WHERE user_id=?').all(alice)).toEqual([]);
  expect(getDb().query('SELECT user_id,rp_id FROM webauthn_credentials').get()).toEqual({user_id:alice,rp_id:rp});
  await expect(finish(value)).rejects.toThrow();
});

test('method/browser/origin/RP/token mismatches cannot consume another ceremony; concurrent claims/proofs have one winner', async () => {
  const totp = service.issue(admin,alice); await expect(service.claimPasskey(totp.token,rp,origin)).rejects.toThrow();
  const grant = service.issue(admin,alice,'passkey');
  const starts = await Promise.allSettled([service.claimPasskey(grant.token,rp,origin),service.claimPasskey(grant.token,rp,origin)]);
  expect(starts.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const start = (starts.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof service.claimPasskey>>>).value;
  const other = await claim(bob), proof = invitationProof(invitationKey('one-winner'),start.options.challenge);
  for (const [browser,from,enrolment,site] of [[other.start.browserToken,origin,start.enrolmentToken,rp],[start.browserToken,'https://other',start.enrolmentToken,rp],[start.browserToken,origin,other.start.enrolmentToken,rp],[start.browserToken,origin,start.enrolmentToken,'other']]) {
    await expect(service.confirmPasskey(grant.token,browser!,from!,enrolment!,site!,proof)).rejects.toThrow();
  }
  const value = { grant,start }; const results = await Promise.allSettled([finish(value,proof),finish(value,proof)]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1); expect(getDb().query('SELECT * FROM webauthn_credentials WHERE user_id=?').all(alice)).toHaveLength(1);
});

test('invalid UV/challenge/origin proofs consume one attempt; duplicate credentials never overwrite another owner', async () => {
  for (const kind of ['uv','challenge','origin']) {
    const value = await claim(); const key = invitationKey('bad-'+kind);
    const proof = invitationProof(key,kind==='challenge'?'wrong':value.start.options.challenge,kind==='origin'?'https://other':origin,rp,kind==='uv'?0x41:0x45);
    await expect(finish(value,proof)).rejects.toThrow(); await expect(finish(value,invitationProof(key,value.start.options.challenge))).rejects.toThrow();
    expect(getUser(getDb(),alice)?.enabled).toBe(false);
  }
  const value = await claim(); const key = invitationKey('duplicate'); getDb().query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key) VALUES (?,?,?,'original')").run(bob,rp,key.id.toString('base64url'));
  await expect(finish(value,invitationProof(key,value.start.options.challenge))).rejects.toThrow();
  expect(getDb().query('SELECT public_key FROM webauthn_credentials').get()).toEqual({public_key:'original'}); expect(getUser(getDb(),alice)?.enabled).toBe(false);
});

test('reissue/revoke/disable/issuer changes/expiry during async proof prevent insertion; failed enable rolls back', async () => {
  for (const change of ['reissue','revoke','disable','expiry']) {
    clock = Date.now(); const value = await claim(); const pending = finish(value);
    if (change==='reissue') service.issue(admin,alice,'passkey');
    else if (change==='revoke') service.revoke(admin,alice);
    else if (change==='disable') updateManagedAccount(getDb(),admin,alice,{enabled:false},policy);
    else clock += 6*60_000;
    await expect(pending).rejects.toThrow(); expect(getUser(getDb(),alice)?.enabled).toBe(false); expect(getDb().query('SELECT * FROM webauthn_credentials').all()).toEqual([]);
  }
  clock = Date.now(); const value = await claim();
  getDb().exec("CREATE TRIGGER fail_enable BEFORE UPDATE ON users WHEN NEW.enabled=1 AND OLD.enabled=0 BEGIN SELECT RAISE(ABORT,'fail enable'); END");
  await expect(finish(value)).rejects.toThrow('fail enable'); expect(getDb().query('SELECT * FROM webauthn_credentials').all()).toEqual([]); getDb().exec('DROP TRIGGER fail_enable');
  const next = await claim(); const pending = finish(next); getDb().query("UPDATE users SET enabled=0 WHERE id='default'").run(); await expect(pending).rejects.toThrow();
});

test('passkey-only admin reset issues selected opportunity atomically and cleanup handles passkey grants', async () => {
  let hints = readAdministrationSettings(getDb(),admin,policy).users.find(u=>u.id===alice)!;
  expect(hints.capabilities.invite).toBe(false); expect(hints.capabilities.invite_passkey).toBe(true);
  const value = await claim(); await finish(value); createWebSession('alice-login',alice,3600,'passkey');
  hints = readAdministrationSettings(getDb(),admin,policy).users.find(u=>u.id===alice)!; expect(hints.capabilities.reset).toBe(false); expect(hints.capabilities.reset_passkey).toBe(true);
  const grant = resetFamilyAccount(getDb(),admin,alice,'alice','passkey'); expect(grant.method).toBe('passkey'); expect(getDb().query('SELECT * FROM webauthn_credentials WHERE user_id=?').all(alice)).toEqual([]); expect(getDb().query('SELECT * FROM web_sessions WHERE user_id=?').all(alice)).toEqual([]);
  expect(()=>resetFamilyAccount(getDb(),admin,'default','default','passkey')).toThrow();
  clock += 16*60_000; pruneExpiredAuthState(getDb(),clock); expect(getDb().query('SELECT * FROM user_auth_invitations').all()).toEqual([]);
});

test('production passkey-only HTTP enrolment and reset are explicit, restricted and cannot enter TOTP or chat APIs', async () => {
  const json = (body:unknown,status=200)=>Response.json(body,{status});
  const config = {accessMode:'family-shared' as const,passkeyMode:'passkey-only',totpSecret:'',internalSecret:'',sessionTtlSeconds:3600,hasTls:true};
  const authGateway = new WebAuthGateway(config,{json,challenges:new WebauthnChallengeTracker(),failureTracker:new TotpFailureTracker()});
  const router = new RequestRouterService({json,authGateway} as any,'family-shared');
  const post = (path:string,body:unknown,cookie='',from=origin)=>router.handle(new Request(origin+path,{method:'POST',headers:{origin:from,cookie},body:JSON.stringify(body)}));
  const path = `/admin/users/${alice}/passkey-invitation`;
  expect((await post(path,{confirm_username:'alice'},'piclaw_session=admin-token','')).status).toBe(403);
  expect((await post(path,{confirm_username:'wrong'},'piclaw_session=admin-token')).status).toBe(403);
  const issued = await post(path,{confirm_username:'alice'},'piclaw_session=admin-token'); expect(issued.status).toBe(201); const grant = await issued.json();
  expect((await post('/auth/invitation/claim',{token:grant.token})).status).toBe(403);
  const response = await post('/auth/invitation/passkey/claim',{token:grant.token}); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
  const cookie = response.headers.get('set-cookie')!; expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('Secure'); expect(cookie).toContain('SameSite=Strict'); expect(cookie).not.toContain('piclaw_session=');
  const start = await response.json(); expect(start.secret).toBeUndefined();
  const proof = {token:grant.token,enrolment_token:start.enrolment_token};
  expect((await post('/auth/invitation/passkey/check',proof,cookie.split(';')[0])).status).toBe(200);
  expect((await router.handle(new Request(origin+'/timeline',{headers:{cookie:cookie.split(';')[0]!}}))).status).toBe(401);
  const finished = await post('/auth/invitation/passkey/confirm',{...proof,credential:invitationProof(invitationKey('http-key'),start.options.challenge)},cookie.split(';')[0]);
  expect(finished.status).toBe(200); expect(await finished.json()).toEqual({enrolled:true,login_required:true}); expect(finished.headers.get('set-cookie')).not.toContain('piclaw_session=');
  const reset = await post(`/admin/users/${alice}/reset-passkey`,{confirm_username:'alice'},'piclaw_session=admin-token'); expect(reset.status).toBe(201); expect((await reset.json()).method).toBe('passkey');
  config.passkeyMode='totp-only'; expect((await post(path,{confirm_username:'alice'},'piclaw_session=admin-token')).status).toBe(403);
});

test('two independently invited users sign in with their own new passkey and immutable userHandle', async () => {
  const json = (body:unknown,status=200)=>Response.json(body,{status});
  const authGateway = new WebAuthGateway({accessMode:'family-shared',passkeyMode:'passkey-only',totpSecret:'',internalSecret:'',sessionTtlSeconds:3600,hasTls:true},{json,challenges:new WebauthnChallengeTracker(),failureTracker:new TotpFailureTracker()});
  const ctx = authGateway.createWebauthnContext();
  const post = (path:string,body:unknown)=>(path.endsWith('/start') ? handleWebauthnLoginStart : handleWebauthnLoginFinish)(new Request(origin+path,{method:'POST',headers:{origin},body:JSON.stringify(body)}),ctx);
  for (const user of [alice,bob]) {
    const value = await claim(user), key = invitationKey('key-'+user.slice(-8)); await finish(value,invitationProof(key,value.start.options.challenge));
    const start = await (await post('/auth/webauthn/login/start',{})).json();
    const response = await post('/auth/webauthn/login/finish',{token:start.token,credential:invitationLoginProof(key,start.options.challenge,user)});
    expect(response.status).toBe(200); const cookie = response.headers.get('set-cookie')!.split(';')[0]!.slice('piclaw_session='.length);
    expect(getWebSession(cookie)?.user_id).toBe(user);
  }
});
