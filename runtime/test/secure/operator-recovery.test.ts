import { afterEach, beforeEach, expect, test } from 'bun:test';
import '../helpers.js';
import { createHmac } from 'node:crypto';
import { getDb, initDatabase, closeDatabase } from '../../src/db/connection.js';
import { getUser } from '../../src/db/users.js';
import { createWebSession } from '../../src/db/web-sessions.js';
import { provisionFamilyAccount, updateManagedAccount } from '../../src/db/account-administration.js';
import { resolveRequestPrincipal } from '../../src/channels/web/auth/principal.js';
import { inspectOperatorRecovery, issueOperatorRecovery, type OperatorRecoveryInput } from '../../src/secure/operator-recovery.js';
import { AccountInvitations } from '../../src/secure/account-invitations.js';
import { UserAuthFactors } from '../../src/secure/user-auth-factors.js';
import { invitationKey, invitationProof } from './passkey-fixture.js';
import { pruneExpiredAuthState } from '../../src/db/auth-maintenance.js';
import { validateAccessStartup } from '../../src/db/access-state.js';

const origin = 'https://family.local';
let input: OperatorRecoveryInput, other: string;
beforeEach(() => {
  closeDatabase(); initDatabase(); const db = getDb();
  const login = createWebSession('original-admin','default',3600,'passkey');
  const actor = resolveRequestPrincipal(new Request(origin,{headers:{cookie:'piclaw_session=fixture'}}),{mode:'family-shared',authEnabled:true},{getSession:()=>login,getUser:()=>getUser(db,'default'),getLocalDisplayName:()=>''})!;
  const admin = provisionFamilyAccount(db,actor,{username:'alice',displayName:'Alice',role:'admin'});
  other = provisionFamilyAccount(db,actor,{username:'bob',displayName:'Bob'}).id;
  db.query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key) VALUES (?,'family.local','lost-key','key'),(?,'family.local','bob-key','bobkey')").run(admin.id,other);
  updateManagedAccount(db,actor,admin.id,{enabled:true},{totp:false,passkey:true,rpId:'family.local'});
  createWebSession('lost-admin-login',admin.id,3600,'passkey');
  updateManagedAccount(db,actor,'default',{enabled:false},{totp:false,passkey:true,rpId:'family.local'});
  db.query("UPDATE access_state SET activated_mode='family-shared'").run();
  input = {userId:admin.id,username:'alice',method:'passkey',origin};
});
afterEach(() => closeDatabase());
function issue() { let grant!: {url:string;expires_at:number}; const result=issueOperatorRecovery(getDb(),input,value=>{grant=value;}); return {result,grant,token:new URLSearchParams(new URL(grant.url).hash.slice(1)).get('token')!}; }
function code(secret: string): string {
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits=0,buffer=0; const bytes:number[]=[];
  for(const c of secret){buffer=(buffer<<5)|alphabet.indexOf(c);bits+=5;if(bits>=8){bits-=8;bytes.push((buffer>>bits)&255);}}
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30_000)));const h=createHmac('sha1',Buffer.from(bytes)).update(counter).digest();
  return (h.readUInt32BE(h[h.length-1]!&15)%0x80000000%1_000_000).toString().padStart(6,'0');
}

test('offline lone-admin grant preserves ownership/content, removes only target factors/logins and enrols without login', async () => {
  const db=getDb(), roots=db.query('SELECT * FROM session_roots').all(), branches=db.query('SELECT * FROM chat_branches').all(), before=getUser(db,input.userId)!;
  expect(inspectOperatorRecovery(db,input)).toMatchObject({enabled:true,passkeys:1,logins:1});
  const {grant,token,result}=issue(); expect(grant.url).toStartWith(origin+'/auth/invitation#');
  expect(getUser(db,input.userId)).toMatchObject({id:before.id,role:'admin',enabled:false,home_chat_jid:before.home_chat_jid});
  expect(db.query('SELECT * FROM session_roots').all()).toEqual(roots);expect(db.query('SELECT * FROM chat_branches').all()).toEqual(branches);
  expect(db.query('SELECT * FROM webauthn_credentials WHERE user_id=?').all(input.userId)).toEqual([]);expect(db.query('SELECT * FROM web_sessions WHERE user_id=?').all(input.userId)).toEqual([]);
  expect(db.query('SELECT credential_id FROM webauthn_credentials WHERE user_id=?').get(other)).toEqual({credential_id:'bob-key'});
  const audit=db.query('SELECT * FROM operator_recovery_events').get();expect(audit).toMatchObject({id:result.recovery_id,target_user_id:input.userId,method:'passkey',origin});expect(JSON.stringify(audit)).not.toContain(token);
  pruneExpiredAuthState(db);expect(db.query('SELECT * FROM user_auth_invitations').all()).toHaveLength(1);
  const service=new AccountInvitations(db);await expect(service.claimPasskey(token,'evil.local','https://evil.local')).rejects.toThrow();
  const start=await service.claimPasskey(token,'family.local',origin);
  await service.confirmPasskey(token,start.browserToken,origin,start.enrolmentToken,'family.local',invitationProof(invitationKey('recovered-admin'),start.options.challenge));
  expect(getUser(db,input.userId)?.enabled).toBe(true);expect(db.query('SELECT * FROM web_sessions WHERE user_id=?').all(input.userId)).toEqual([]);
  expect(db.query('SELECT * FROM operator_recovery_events').all()).toHaveLength(1);expect(()=>validateAccessStartup(db)).toThrow();
});

test('operator TOTP grant uses encrypted first-factor proof and cannot read/reuse a lost factor', async () => {
  input.method='totp';const {token}=issue();const service=new AccountInvitations(getDb(),new UserAuthFactors(getDb(),()=> 'fixture-key'));
  const start=await service.claim(token,origin);expect(getUser(getDb(),input.userId)?.enabled).toBe(false);
  expect(await service.confirm(token,start.browserToken,origin,start.enrolmentToken,code(start.secret))).toBe(true);
  expect(getUser(getDb(),input.userId)?.enabled).toBe(true);expect(JSON.stringify(getDb().query('SELECT * FROM user_totp_factors').get())).not.toContain(start.secret);
});

test('invalid identity/mode/home and failing audit/output cannot remove factors or leave partial grants', () => {
  const db=getDb(), before=JSON.stringify(db.query('SELECT * FROM users').all());
  for(const patch of [{username:'wrong'},{userId:other,username:'bob'},{origin:'http://family.local'},{origin:origin+'/'},{method:'invalid'}]) expect(()=>inspectOperatorRecovery(db,{...input,...patch} as any)).toThrow();
  db.exec("UPDATE access_state SET activated_mode='single-user'");expect(()=>issue()).toThrow();db.exec("UPDATE access_state SET activated_mode='family-shared'");
  expect(()=>issueOperatorRecovery(db,input,()=>{throw new Error('disk full');})).toThrow('disk full');
  expect(JSON.stringify(db.query('SELECT * FROM users').all())).toBe(before);expect(db.query('SELECT * FROM operator_recovery_events').all()).toEqual([]);expect(db.query('SELECT * FROM user_auth_invitations').all()).toEqual([]);
  db.exec("CREATE TRIGGER fail_recovery BEFORE INSERT ON operator_recovery_events BEGIN SELECT RAISE(ABORT,'audit failed'); END");expect(()=>issue()).toThrow('audit failed');
  expect(getUser(db,input.userId)?.enabled).toBe(true);expect(db.query('SELECT * FROM webauthn_credentials WHERE user_id=?').all(input.userId)).toHaveLength(1);
});

test('reissue and missing/mismatched audit revoke operator authority; normal grants never inherit it', async () => {
  const db=getDb(), first=issue(), second=issue();const service=new AccountInvitations(db);
  await expect(service.claimPasskey(first.token,'family.local',origin)).rejects.toThrow();
  const start=await service.claimPasskey(second.token,'family.local',origin);
  const pending=service.confirmPasskey(second.token,start.browserToken,origin,start.enrolmentToken,'family.local',invitationProof(invitationKey('revoked-recovery'),start.options.challenge));
  db.exec('DELETE FROM operator_recovery_events');await expect(pending).rejects.toThrow();expect(getUser(db,input.userId)?.enabled).toBe(false);
  pruneExpiredAuthState(db);expect(db.query('SELECT * FROM user_auth_invitations').all()).toEqual([]);
  const third=issue();db.query('UPDATE operator_recovery_events SET origin=? WHERE id=?').run('https://evil.local',third.result.recovery_id);
  await expect(service.claimPasskey(third.token,'family.local',origin)).rejects.toThrow();
  expect(db.query('SELECT * FROM webauthn_credentials WHERE user_id=?').all(input.userId)).toEqual([]);
  // A normal administrator reissue must explicitly drop operator authority.
  db.query("UPDATE users SET enabled=1 WHERE id='default'").run();const login=createWebSession('other-admin','default',3600,'passkey');
  const actor=resolveRequestPrincipal(new Request(origin,{headers:{cookie:'piclaw_session=fixture'}}),{mode:'family-shared',authEnabled:true},{getSession:()=>login,getUser:()=>getUser(db,'default'),getLocalDisplayName:()=>''})!;
  const normal=service.issue(actor,input.userId,'passkey');expect(db.query('SELECT recovery_event_id,expected_origin FROM user_auth_invitations').get()).toEqual({recovery_event_id:null,expected_origin:null});
  db.query("UPDATE users SET enabled=0 WHERE id='default'").run();await expect(service.claimPasskey(normal.token,'family.local',origin)).rejects.toThrow();
});
