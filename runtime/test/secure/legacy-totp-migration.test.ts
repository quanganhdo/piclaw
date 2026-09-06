import {beforeEach,afterEach,expect,test} from 'bun:test';
import {createHmac} from 'node:crypto';
import {chmodSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createTempWorkspace,setEnv} from '../helpers.js';
import {getDb,initDatabase,closeDatabase} from '../../src/db/connection.js';
import {UserAuthFactors} from '../../src/secure/user-auth-factors.js';
import {prepareLegacyTotpFile} from '../../src/secure/legacy-totp-migration-file.js';
import {readAccessMigrationInventory,prepareAccessMigrationCopy,validateAccessMigrationPlan} from '../../src/db/access-migration-plan.js';
import {RESOURCE_MIGRATION_POLICY} from '../../src/db/access-resource-migration.js';
import {validateFactorMigration} from '../../src/db/access-factor-migration.js';
import {getUser,createUser} from '../../src/db/users.js';
import {createWebSession,getWebSession} from '../../src/db/web-sessions.js';
import {WebauthnChallengeTracker} from '../../src/channels/web/auth/webauthn-challenges.js';
import {handleWebauthnLoginStart,handleWebauthnLoginFinish,type WebauthnAuthContext} from '../../src/channels/web/auth/webauthn-auth.js';
import {invitationKey,invitationLoginProof} from './passkey-fixture.js';

export function legacyTotpCode(secret:string,time=Date.now()):string {
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits=0,buffer=0;const bytes:number[]=[];
  for(const c of secret){buffer=(buffer<<5)|alphabet.indexOf(c);bits+=5;if(bits>=8){bits-=8;bytes.push((buffer>>bits)&255);}}
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(time/30_000)));const h=createHmac('sha1',Buffer.from(bytes)).update(counter).digest();return(h.readUInt32BE(h[h.length-1]!&15)%0x80000000%1_000_000).toString().padStart(6,'0');
}
let ws:ReturnType<typeof createTempWorkspace>,restore:()=>void,clock:number,service:UserAuthFactors;
const secret='JBSWY3DPEHPK3PXP';
const preserve={passkeys:'preserve-immutable-handles',legacy_totp:'none'};
function plan(imports=false){const p=readAccessMigrationInventory(getDb()).plan;p.assignments[0]!.owner_user_id='default';return {...p,version:4,child_sessions:[],resource_policy:RESOURCE_MIGRATION_POLICY,factor_policy:{...preserve,legacy_totp:imports?'import-default':'none'}};}
beforeEach(()=>{ws=createTempWorkspace('piclaw-factor-migration-');restore=setEnv({PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data,PICLAW_KEYCHAIN_KEY:'fixture-existing-key'});closeDatabase();initDatabase();getDb().exec("INSERT INTO chats(jid,name,last_message_time) VALUES ('web:default','main','now');INSERT INTO chat_branches(branch_id,chat_jid,root_chat_jid,agent_name,created_at,updated_at) VALUES ('root','web:default','web:default','main','now','now')");clock=Date.now();service=new UserAuthFactors(getDb(),()=> 'fixture-existing-key',()=>clock);});
afterEach(()=>{closeDatabase();restore();ws.cleanup();});

test('explicit legacy proof is encrypted for default, consumes proof step and does not create sessions or alter account',async()=>{
  const db=getDb(),before=getUser(db,'default'),proof=legacyTotpCode(secret,clock),p=plan(true);
  const prepared=await service.prepareLegacyDefaultMigration(secret,proof);expect(JSON.stringify(prepared)).not.toContain(secret);expect(db.query('SELECT * FROM user_totp_factors').all()).toEqual([]);
  prepareAccessMigrationCopy(db,p,[],prepared);expect(getUser(db,'default')).toEqual(before);expect(db.query('SELECT * FROM web_sessions').all()).toEqual([]);
  expect(await service.verifyLogin('default',proof)).toBeNull();clock+=30_000;expect((await service.verifyLogin('default',legacyTotpCode(secret,clock)))?.userId).toBe('default');
  expect(db.query('SELECT preserved_passkeys,preserved_totp,imported_default_totp FROM access_factor_migration').get()).toEqual({preserved_passkeys:0,preserved_totp:0,imported_default_totp:1});
  const row=db.query('SELECT * FROM user_totp_factors').get() as any;expect(Buffer.from(row.ciphertext).toString()).not.toContain(secret);expect(row.salt).toHaveLength(16);expect(row.nonce).toHaveLength(12);
  await expect(new UserAuthFactors(db,()=> 'wrong-key',()=>clock).verifyLogin('default',legacyTotpCode(secret,clock))).rejects.toThrow();
});

test('invalid proof, existing factor, unsupported policy and expired preparation cannot overwrite or partially migrate',async()=>{
  const db=getDb();await expect(service.prepareLegacyDefaultMigration(secret,'bad')).rejects.toThrow();await expect(service.prepareLegacyDefaultMigration('<script>','123456')).rejects.toThrow();
  await expect(service.prepareLegacyDefaultMigration(secret,legacyTotpCode(secret,clock-300000))).rejects.toThrow('Invalid legacy');
  await expect(new UserAuthFactors(db,()=>'',()=>clock).prepareLegacyDefaultMigration(secret,legacyTotpCode(secret,clock))).rejects.toThrow('bootstrap');
  const p=plan(true),prepared=await service.prepareLegacyDefaultMigration(secret,legacyTotpCode(secret,clock));
  expect(()=>prepareAccessMigrationCopy(db,p,[],{...prepared,expiresAt:Date.now()-1})).toThrow();expect(db.query('SELECT * FROM session_roots').all()).toEqual([]);
  expect(()=>prepareAccessMigrationCopy(db,plan(),[],prepared)).toThrow('does not match');
  db.exec("CREATE TRIGGER reject_factor BEFORE INSERT ON user_totp_factors BEGIN SELECT RAISE(ABORT,'factor failure'); END");createWebSession('retain-me','default',3600,'passkey');
  expect(()=>prepareAccessMigrationCopy(db,plan(true),[],prepared)).toThrow('factor failure');expect(db.query('SELECT * FROM web_sessions').all()).toHaveLength(1);expect(db.query('SELECT * FROM session_roots').all()).toEqual([]);db.exec('DROP TRIGGER reject_factor');
  service.commitLegacyDefaultMigration(prepared);await expect(service.prepareLegacyDefaultMigration(secret,legacyTotpCode(secret,clock))).rejects.toThrow('already exists');expect(()=>validateFactorMigration(db,{...preserve,legacy_totp:'import-default'})).toThrow();expect(()=>validateFactorMigration(db,{...preserve,owner_user_id:'other'})).toThrow();
});

test('factor fingerprint catches counter/key changes and rejects malformed/orphan metadata without exporting identifiers',()=>{
  const db=getDb(),key=invitationKey('legacy');db.query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key) VALUES ('default','family.local',?,?)").run(key.id.toString('base64url'),key.cose.toString('base64url'));
  const p=plan();const text=JSON.stringify(readAccessMigrationInventory(db));expect(text).not.toContain(key.cose.toString('base64url'));expect(text).not.toContain(key.id.toString('base64url'));
  db.exec('UPDATE webauthn_credentials SET sign_count=1');expect(()=>validateAccessMigrationPlan(db,p)).toThrow('changed');
  db.exec("UPDATE webauthn_credentials SET user_id='unknown'");expect(()=>validateFactorMigration(db,preserve)).toThrow('orphaned');db.exec("UPDATE webauthn_credentials SET user_id='default',transports='{}'");expect(()=>validateFactorMigration(db,preserve)).toThrow('transports');
});

test('legacy passkeys preserve exact credential IDs, counters and default userHandle and still verify with family authentication',async()=>{
  const db=getDb(),key=invitationKey('legacy-default');db.query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key,sign_count,transports,label) VALUES ('default','family.local',?,?,0,'[\"internal\"]','Legacy key')").run(key.id.toString('base64url'),key.cose.toString('base64url'));
  const before=db.query('SELECT * FROM webauthn_credentials').all();prepareAccessMigrationCopy(db,plan());expect(db.query('SELECT * FROM webauthn_credentials').all()).toEqual(before);
  const ctx:WebauthnAuthContext={accessMode:'family-shared',isPasskeyEnabled:()=>true,json:(body,status=200)=>Response.json(body,{status}),buildSessionCookie:token=>'piclaw_session='+token,logAuthEvent:()=>{},getClientKey:()=> 'fixture',challenges:new WebauthnChallengeTracker()};
  const req=(path:string,body:unknown)=>new Request('https://family.local'+path,{method:'POST',headers:{origin:'https://family.local'},body:JSON.stringify(body)});
  const start=await(await handleWebauthnLoginStart(req('/auth/webauthn/login/start',{}),ctx)).json();const response=await handleWebauthnLoginFinish(req('/auth/webauthn/login/finish',{token:start.token,credential:invitationLoginProof(key,start.options.challenge,'default')}),ctx);
  expect(response.status).toBe(200);expect(getWebSession(response.headers.get('set-cookie')!.slice('piclaw_session='.length))?.user_id).toBe('default');
  const other=createUser(db,{username:'other',displayName:'Other'});expect(other.id).not.toBe('default');
  const again=await(await handleWebauthnLoginStart(req('/auth/webauthn/login/start',{}),ctx)).json();expect((await handleWebauthnLoginFinish(req('/auth/webauthn/login/finish',{token:again.token,credential:invitationLoginProof(key,again.options.challenge,other.id)}),ctx)).status).toBe(401);
});

test('secret input is bounded owner-only non-symlink JSON and is never removed automatically',async()=>{
  const file=join(ws.workspace,'secret.json');writeFileSync(file,JSON.stringify({secret,code:legacyTotpCode(secret)}),{mode:0o600});expect((await prepareLegacyTotpFile(getDb(),file)).step).toBeGreaterThan(0);
  chmodSync(file,0o644);await expect(prepareLegacyTotpFile(getDb(),file)).rejects.toThrow('owner-only');chmodSync(file,0o600);symlinkSync(file,join(ws.workspace,'alias'));await expect(prepareLegacyTotpFile(getDb(),join(ws.workspace,'alias'))).rejects.toThrow();
  writeFileSync(file,JSON.stringify({secret,code:legacyTotpCode(secret),user_id:'other'}));await expect(prepareLegacyTotpFile(getDb(),file)).rejects.toThrow('Invalid');
});
