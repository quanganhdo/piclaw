import Database from 'bun:sqlite';
import { chmodSync, constants, closeSync, fsyncSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { getStoreDir, getDataDir, getWorkspaceDir } from './core/config-context.js';
import { readAccessConfig } from './core/config-access.js';
import { acquireRuntimeLock } from './runtime/single-instance.js';
import { createVerifiedSqliteBackup, verifySqliteBackup } from './db/backup.js';
import { prepareAccessMigrationCopy, readAccessMigrationInventory, validateAccessMigrationPlan } from './db/access-migration-plan.js';
import { captureChildAdoptions } from './db/access-child-adoption.js';
import { prepareLegacyTotpFile } from './secure/legacy-totp-migration-file.js';

function destination(path:string,source:string):string {
  const parent=realpathSync(dirname(resolve(path))),stat=lstatSync(parent), target=join(parent,basename(path));
  if (!stat.isDirectory() || (stat.mode&0o077)!==0 || (process.getuid && stat.uid!==process.getuid())) throw new Error('Destination directory must be owner-only (0700).');
  if ([source,source+'-wal',source+'-shm',join(dirname(source),'runtime.lock')].includes(target)) throw new Error('Destination cannot replace source state.');
  try {lstatSync(target);} catch(error) {if((error as NodeJS.ErrnoException).code==='ENOENT') return target; throw error;}
  throw new Error('Destination already exists.');
}

/** Offline metadata preview and copy-only preparation; never writes source ownership or activation. */
export async function handleAccessMigration(args:string[]):Promise<void> {
  const [action,...flags]=args;
  if (!['preview','prepare-copy'].includes(action??'')) throw new Error('Use access-migration preview|prepare-copy.');
  const allowed=action==='preview'?['--output']:['--plan','--destination','--writers-stopped','--backup-set-confirmed','--confirm','--legacy-totp-file'];
  const values=new Map<string,string>();
  for(let i=0;i<flags.length;i++) {
    const flag=flags[i]!;if(!allowed.includes(flag)||values.has(flag)) throw new Error('Unknown or duplicate migration option.');
    const value=['--writers-stopped','--backup-set-confirmed'].includes(flag)?'yes':flags[++i];
    if(!value||value.startsWith('--')) throw new Error('Missing migration option value.');values.set(flag,value);
  }
  if(action==='preview' ? !values.has('--output') : !values.has('--plan')||!values.has('--destination')||!values.has('--writers-stopped')||!values.has('--backup-set-confirmed')||values.get('--confirm')!=='PREPARE OWNERSHIP COPY') throw new Error('Missing migration output, plan or explicit confirmations.');
  if(readAccessConfig().mode!=='single-user') throw new Error('Copy preparation requires single-user configuration; no mode transitions are supported.');
  const path=join(getStoreDir(),'messages.db');if(!lstatSync(path).isFile()) throw new Error('Existing regular non-symlink source database required.');
  const source=realpathSync(path),lock=acquireRuntimeLock({lockPath:join(dirname(source),'runtime.lock'),disabled:false,maintenance:true});
  let db:Database|undefined, copy:Database|undefined, created:string|undefined, success=false;
  try {
    db=new Database(source,{readonly:true,strict:true});db.exec('PRAGMA busy_timeout=0');
    const target=destination(values.get(action==='preview'?'--output':'--destination')!,source);
    if(action==='preview') {
      const inventory=readAccessMigrationInventory(db);
      const fd=openSync(target,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);created=target;
      try{writeFileSync(fd,JSON.stringify(inventory,null,2)+'\n');fsyncSync(fd);}finally{closeSync(fd);}
      success=true;console.log(JSON.stringify({output:target,snapshot:inventory.snapshot,roots:inventory.plan.assignments.length,quarantined:inventory.topology.quarantined.length}));return;
    }
    const planPath=values.get('--plan')!;
    const planFd=openSync(planPath,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    let plan:unknown;
    try {const stat=fstatSync(planFd);if(!stat.isFile()||stat.size>1024*1024) throw new Error('Migration plan must be a regular file up to 1 MiB.');plan=JSON.parse(readFileSync(planFd,'utf8'));}finally{closeSync(planFd);}
    const {inventory}=validateAccessMigrationPlan(db,plan);
    const factorPlan=plan as {version:number;factor_policy?:{legacy_totp:string}};
    const importsTotp=factorPlan.version>=4&&factorPlan.factor_policy?.legacy_totp==='import-default';
    if(importsTotp!==values.has('--legacy-totp-file'))throw new Error('Protected TOTP input must match an explicit version-four import-default plan.');
    const legacyTotp=importsTotp?await prepareLegacyTotpFile(db,values.get('--legacy-totp-file')!):undefined;
    if(readAccessMigrationInventory(db).snapshot!==inventory.snapshot)throw new Error('Source changed during factor preparation. Review a fresh preview.');
    const children=(plan as {child_sessions?:unknown}).child_sessions ?? [];
    const adoptions=captureChildAdoptions(db,children,getWorkspaceDir(),join(getDataDir(),'sessions'));
    const version=(db.query('PRAGMA data_version').get() as {data_version:number}).data_version;
    createVerifiedSqliteBackup(db,source,target);created=target;chmodSync(target,0o600);
    if((db.query('PRAGMA data_version').get() as {data_version:number}).data_version!==version || readAccessMigrationInventory(db).snapshot!==inventory.snapshot) throw new Error('Source changed during snapshot. Review a new preview.');
    copy=new Database(target,{readwrite:true,create:false,strict:true});copy.exec('PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=0;');
    const rechecked=captureChildAdoptions(db,children,getWorkspaceDir(),join(getDataDir(),'sessions'));
    if(JSON.stringify(rechecked)!==JSON.stringify(adoptions)) throw new Error('Child snapshots changed during copy preparation.');
    const result=prepareAccessMigrationCopy(copy,plan,adoptions,legacyTotp);copy.close();copy=undefined;verifySqliteBackup(target);
    success=true;console.log(JSON.stringify({...result,destination:target,warning:'Prepared copy cannot start. Source unchanged; activation, factor migration and unverified children remain gated.'}));
  } finally {
    try{copy?.close();db?.close();}finally{try{if(created&&!success)rmSync(created,{force:true});}finally{lock.release();}}
  }
}
