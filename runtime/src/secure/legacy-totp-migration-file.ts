import type Database from 'bun:sqlite';
import { constants, closeSync, fstatSync, openSync, readFileSync } from 'node:fs';
import { UserAuthFactors, type PreparedLegacyTotp } from './user-auth-factors.js';
import { getWebRuntimeConfig } from '../core/config-web.js';

/** Operator-provided plaintext input is private, bounded and never included in the plan, logs or output. */
export async function prepareLegacyTotpFile(db:Database,path:string):Promise<PreparedLegacyTotp> {
  if(getWebRuntimeConfig().passkeyMode==='passkey-only')throw new Error('Configured policy disables TOTP.');
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  let bytes:Buffer|undefined;
  try {
    const stat=fstatSync(fd);
    if(!stat.isFile()||stat.size>4096||(stat.mode&0o077)!==0||(process.getuid&&stat.uid!==process.getuid()))throw new Error('Legacy factor input must be an owner-only regular file up to 4 KiB.');
    bytes=readFileSync(fd);const value=JSON.parse(bytes.toString('utf8'));bytes.fill(0);
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==2||Object.keys(value).some(key=>!['secret','code'].includes(key))||typeof value.secret!=='string'||typeof value.code!=='string')throw new Error('Invalid legacy factor input.');
    try{return await new UserAuthFactors(db).prepareLegacyDefaultMigration(value.secret,value.code);}
    finally{value.secret='';value.code='';}
  }finally{bytes?.fill(0);closeSync(fd);}
}
