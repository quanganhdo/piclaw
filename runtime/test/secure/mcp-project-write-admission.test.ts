import {afterEach,expect,test} from 'bun:test';
import {mkdirSync,readFileSync,writeFileSync,renameSync,readdirSync,rmSync,statSync} from 'node:fs';
import {join} from 'node:path';
import lockfile from 'proper-lockfile';
import {withTempWorkspaceEnv} from '../helpers.js';
import {acquireMcpSessionBridge,hydrateMcpKeychainCredentials,getMcpBridgeSnapshot,getPreparedMcpConfig,resetMcpStartupStateForTests,createMcpConfigWriteAuthority,writeMcpProjectOverride,McpConfigWriteError} from '../../src/secure/mcp-keychain.js';
const originalLock=lockfile.lock;
afterEach(()=>{lockfile.lock=originalLock;resetMcpStartupStateForTests();});
async function fixture(run:(root:string)=>Promise<void>){await withTempWorkspaceEnv('mcp-write-admission-',{},async ws=>{mkdirSync(join(ws.workspace,'.pi'),{recursive:true});await hydrateMcpKeychainCredentials(ws.workspace,()=>{throw Error('Keychain is forbidden');});try{await run(ws.workspace);}finally{resetMcpStartupStateForTests();}});}
function input(root:string,authorise:()=>void,signal=new AbortController().signal){return {workspaceDir:root,expectedRevision:getMcpBridgeSnapshot().revision,config:{mcpServers:{demo:{command:'synthetic-never-run'}}},authority:createMcpConfigWriteAuthority({workspaceDir:root,authorise,signal})};}
for(const mutation of ['revoke','abort','file-aba','parent-aba','root-aba'] as const)test(`writer rechecks ${mutation} after asynchronous lock acquisition`,async()=>fixture(async root=>{
 const path=join(root,'.pi','mcp.json');writeFileSync(path,JSON.stringify({mcpServers:{}}));await hydrateMcpKeychainCredentials(root,()=>{throw Error('No keychain');});const before=readFileSync(path,'utf8');let valid=true;const abort=new AbortController();const value=input(root,()=>{if(!valid)throw Error('owner revoked');},abort.signal);
 let releaseGate!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>{releaseGate=resolve;}),waiting=new Promise<void>(resolve=>{entered=resolve;});
 lockfile.lock=(async(...args:Parameters<typeof originalLock>)=>{const release=await originalLock(...args);entered();await gate;return release;}) as typeof originalLock;
 const observed=writeMcpProjectOverride(value).then(()=>null,error=>error);await waiting;
 let restore=()=>{};
 if(mutation==='revoke')valid=false;else if(mutation==='abort')abort.abort(Error('cancelled'));else if(mutation==='file-aba'){renameSync(path,`${path}.old`);writeFileSync(path,before);}
 else {const parent=mutation==='root-aba'?root:join(root,'.pi'),old=`${parent}.old`;renameSync(parent,old);mkdirSync(join(root,'.pi'),{recursive:true});writeFileSync(path,before);restore=()=>{renameSync(parent,`${parent}.new`);renameSync(old,parent);rmSync(`${parent}.new`,{recursive:true,force:true});};}
 releaseGate();try{expect(await observed).toBeTruthy();expect(readFileSync(path,'utf8')).toBe(before);expect(readdirSync(join(root,'.pi')).some(name=>name.endsWith('.tmp'))).toBe(false);expect(getPreparedMcpConfig().mcpServers.demo).toBeUndefined();}finally{restore();}
}));
test('writer refuses cancellation immediately before rename and cleans its staged file',async()=>fixture(async root=>{
 let checks=0;const abort=new AbortController();const value=input(root,()=>{if(++checks===5)abort.abort(Error('cancel before rename'));},abort.signal);
 await expect(writeMcpProjectOverride(value)).rejects.toThrow('cancel before rename');expect(readdirSync(join(root,'.pi')).some(name=>name.endsWith('.tmp'))).toBe(false);expect(()=>readFileSync(join(root,'.pi','mcp.json'))).toThrow();
}));
test('writer snapshots caller config, does not hydrate or execute, and commits a private file',async()=>fixture(async root=>{
 const value=input(root,()=>{});let enter!:()=>void,go!:()=>void;const gate=new Promise<void>(resolve=>{go=resolve;}),waiting=new Promise<void>(resolve=>{enter=resolve;});
 lockfile.lock=(async(...args:Parameters<typeof originalLock>)=>{const release=await originalLock(...args);enter();await gate;return release;}) as typeof originalLock;
 const pending=writeMcpProjectOverride(value);await waiting;value.config.mcpServers.demo.command='mutated-after-admission';go();const receipt=await pending;
 expect(receipt.committed).toBe(true);expect(JSON.parse(readFileSync(receipt.path,'utf8')).mcpServers.demo.command).toBe('synthetic-never-run');expect(statSync(receipt.path).mode&0o777).toBe(0o600);expect(getPreparedMcpConfig().mcpServers.demo).toBeUndefined();
}));
for(const mutation of ['revoke','unlock-failure'] as const)test(`after rename ${mutation} retains an explicit committed receipt`,async()=>fixture(async root=>{
 let valid=true;const value=input(root,()=>{if(!valid)throw Error('owner revoked after commit');});
 lockfile.lock=(async(...args:Parameters<typeof originalLock>)=>{const release=await originalLock(...args);return async()=>{await release();if(mutation==='revoke')valid=false;else throw Error('synthetic unlock failure');};}) as typeof originalLock;
 const error=await writeMcpProjectOverride(value).then(()=>null,cause=>cause);expect(error).toBeInstanceOf(McpConfigWriteError);expect(error.receipt.committed).toBe(true);expect(JSON.parse(readFileSync(error.receipt.path,'utf8')).mcpServers.demo.command).toBe('synthetic-never-run');expect(getPreparedMcpConfig().mcpServers.demo).toBeUndefined();
}));
test('authority is bound to the original workspace and cannot be copied or forged',async()=>fixture(async root=>{
 const value=input(root,()=>{});await expect(writeMcpProjectOverride({...value,workspaceDir:join(root,'other')})).rejects.toThrow('not authorized');await expect(writeMcpProjectOverride({...value,authority:{...value.authority}})).rejects.toThrow('not authorized');
}));
test('directory fsync failure after rename reports a saved receipt in an isolated process',async()=>{
 const entry=new URL('../fixtures/mcp-write-fsync-failure.ts',import.meta.url).pathname;
 await withTempWorkspaceEnv('mcp-write-fsync-',{},async()=>{
  const child=Bun.spawn([process.execPath,'--no-env-file',entry],{env:{...process.env},stdin:'ignore',stdout:'pipe',stderr:'pipe'});const timer=setTimeout(()=>child.kill('SIGKILL'),10000);
  try{const [code,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);expect(code,err).toBe(0);expect(JSON.parse(out.trim().split('\n').at(-1)!)).toEqual({directoryFsyncFailed:true,committedReceipt:true,stagedFilesClean:true});}
  finally{clearTimeout(timer);if(child.exitCode===null)child.kill('SIGKILL');await child.exited;}
 });
},15000);
for(const mutation of ['revoke','abort','file'] as const)test(`guarded hydration rejects late keychain result after ${mutation} without publishing it`,async()=>fixture(async root=>{
 const path=join(root,'.pi','mcp.json');writeFileSync(path,JSON.stringify({mcpServers:{demo:{command:'never-run',bearerTokenKeychain:'synthetic',bearerTokenEnv:'SYNTHETIC_LATE_TOKEN'}}}));
 await hydrateMcpKeychainCredentials(root,async()=>({secret:'old-sentinel'} as any));const snapshot=getMcpBridgeSnapshot(),lease=acquireMcpSessionBridge();let valid=true,entered!:()=>void,release!:()=>void;const waiting=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});const abort=new AbortController();
 const observed=hydrateMcpKeychainCredentials(root,async()=>{entered();await gate;return{secret:'late-sentinel'} as any;},{signal:abort.signal,authorise(){if(!valid)throw Error('owner revoked');}}).then(()=>null,error=>error);
 await waiting;if(mutation==='revoke')valid=false;else if(mutation==='abort')abort.abort(Error('cancelled'));else writeFileSync(path,JSON.stringify({mcpServers:{replacement:{command:'never-run-new'}}}));release();
 try{expect(await observed).toBeTruthy();expect(getMcpBridgeSnapshot().revision).toBe(snapshot.revision);expect(lease.resolveRuntimeEnv('demo').SYNTHETIC_LATE_TOKEN).toBe('old-sentinel');const current=acquireMcpSessionBridge();expect(current.resolveRuntimeEnv('demo').SYNTHETIC_LATE_TOKEN).toBe('old-sentinel');current.release();expect(JSON.stringify(getMcpBridgeSnapshot())).not.toContain('late-sentinel');}finally{lease.release();}
}));
test('same-byte source replacement after hydration but before writer admission is rejected',async()=>fixture(async root=>{
 const path=join(root,'.pi','mcp.json');writeFileSync(path,JSON.stringify({mcpServers:{}}));await hydrateMcpKeychainCredentials(root,()=>{throw Error('No credentials');});const before=readFileSync(path,'utf8');renameSync(path,`${path}.old`);writeFileSync(path,before);
 await expect(writeMcpProjectOverride(input(root,()=>{}))).rejects.toThrow('revision conflict');expect(readFileSync(path,'utf8')).toBe(before);
}));
