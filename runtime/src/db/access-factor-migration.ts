import type Database from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { UserAuthFactors, type PreparedLegacyTotp } from '../secure/user-auth-factors.js';

export interface FactorMigrationPolicy { passkeys:'preserve-immutable-handles'; legacy_totp:'none'|'import-default' }

/** Counts + opaque fingerprint only; no credential IDs, public keys, ciphertext, salts or seed hashes in preview. */
export function readMigrationFactorInventory(db:Database) {
  const hash=createHash('sha256');
  for(const sql of ['SELECT * FROM webauthn_credentials ORDER BY id','SELECT * FROM user_totp_factors ORDER BY user_id']) {
    hash.update(sql);for(const row of db.query(sql).iterate())hash.update(JSON.stringify(row));
  }
  return {fingerprint:hash.digest('hex'),passkeys:(db.query('SELECT count(*) n FROM webauthn_credentials').get() as {n:number}).n,
    totp:(db.query('SELECT count(*) n FROM user_totp_factors').get() as {n:number}).n,
    default_totp_present:Boolean(db.query("SELECT 1 FROM user_totp_factors WHERE user_id='default'").get())};
}

export function validateFactorMigration(db:Database,input:unknown):FactorMigrationPolicy {
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==2||Object.keys(input).some(key=>!['passkeys','legacy_totp'].includes(key))) throw new Error('Invalid factor migration policy.');
  const policy=input as FactorMigrationPolicy;
  if(policy.passkeys!=='preserve-immutable-handles'||!['none','import-default'].includes(policy.legacy_totp))throw new Error('Unsupported factor migration policy.');
  const users=new Set((db.query('SELECT id FROM users').all() as {id:string}[]).map(row=>row.id));
  const base64=(s:unknown)=>typeof s==='string'&&s.length>0&&/^[A-Za-z0-9_-]+$/.test(s)&&Buffer.from(s,'base64url').toString('base64url')===s;
  for(const row of db.query('SELECT user_id,rp_id,credential_id,public_key,sign_count,transports FROM webauthn_credentials').all() as {user_id:string;rp_id:string;credential_id:string;public_key:string;sign_count:number;transports:string|null}[]) {
    if(!users.has(row.user_id)||!row.rp_id||/[\s\p{Cc}\p{Cf}/]/u.test(row.rp_id)||!base64(row.credential_id)||!base64(row.public_key)||!Number.isSafeInteger(row.sign_count)||row.sign_count<0) throw new Error('Invalid or orphaned passkey metadata. Repair separately; no reassignment is permitted.');
    if(row.transports!==null){const transports=JSON.parse(row.transports);if(!Array.isArray(transports)||transports.some(item=>typeof item!=='string'))throw new Error('Invalid stored passkey transports.');}
  }
  for(const row of db.query('SELECT user_id,ciphertext,salt,nonce,revision,last_used_step FROM user_totp_factors').all() as {user_id:string;ciphertext:Uint8Array;salt:Uint8Array;nonce:Uint8Array;revision:string;last_used_step:number}[]) {
    if(!users.has(row.user_id)||!row.revision||row.salt.byteLength!==16||row.nonce.byteLength!==12||row.ciphertext.byteLength<32||!Number.isSafeInteger(row.last_used_step)||row.last_used_step<0)throw new Error('Invalid or orphaned confirmed TOTP factor.');
  }
  if(policy.legacy_totp==='import-default'&&(!users.has('default')||db.query("SELECT 1 FROM user_totp_factors WHERE user_id='default'").get()))throw new Error('Default TOTP import requires an existing account without a confirmed factor.');
  return policy;
}

/** Called in the destination preparation transaction only. Existing factors are never rewritten. */
export function applyMigrationFactorPolicy(db:Database,input:unknown,snapshot:string,prepared?:PreparedLegacyTotp):void {
  const policy=validateFactorMigration(db,input),before=readMigrationFactorInventory(db);
  if((policy.legacy_totp==='import-default')!==Boolean(prepared))throw new Error('Legacy proof input does not match the reviewed plan.');
  if(prepared)new UserAuthFactors(db).commitLegacyDefaultMigration(prepared);
  db.exec(`CREATE TABLE access_factor_migration (
    id INTEGER PRIMARY KEY CHECK(id=1),source_snapshot TEXT NOT NULL,policy_json TEXT NOT NULL,
    preserved_passkeys INTEGER NOT NULL,preserved_totp INTEGER NOT NULL,imported_default_totp INTEGER NOT NULL CHECK(imported_default_totp IN(0,1)),prepared_at TEXT NOT NULL
  ) STRICT;`);
  db.query('INSERT INTO access_factor_migration VALUES (1,?,?,?,?,?,?)').run(snapshot,JSON.stringify(policy),before.passkeys,before.totp,prepared?1:0,new Date().toISOString());
}
