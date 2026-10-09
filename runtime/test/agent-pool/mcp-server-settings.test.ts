import {expect,test} from 'bun:test';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import lockfile from 'proper-lockfile';
import {withTempWorkspaceEnv} from '../helpers.js';
import {McpCodemodeController,resetMcpCodemodeRuntimeForTests,assertSelectedMcpOwner} from '../../src/agent-pool/mcp-codemode-runtime.js';
import {bindMcpBridgeOwner,createMcpBridgeOwner} from '../../src/agent-pool/mcp-bridge-owner.js';
import {hydrateMcpKeychainCredentials,resetMcpStartupStateForTests,prepareMcpServerEdit,writeMcpProjectOverride,createMcpConfigWriteAuthority,getMcpBridgeSnapshot} from '../../src/secure/mcp-keychain.js';
async function fixture(run:(h:ReturnType<typeof harness>,root:string)=>Promise<void>,options:Parameters<typeof harness>[0]={}){await withTempWorkspaceEnv('server-settings-',{},async ws=>{mkdirSync(join(ws.workspace,'.pi'),{recursive:true});mkdirSync(join(ws.workspace,'.piclaw'),{recursive:true});writeFileSync(join(ws.workspace,'.piclaw','config.json'),JSON.stringify({domains:{access:{mode:'single-user'},other:{keep:true}}}),{mode:0o600});writeFileSync(join(ws.workspace,'.pi','mcp.json'),JSON.stringify({settings:{future:{keep:true}},mcpServers:{demo:{command:'never-run',args:['private-arg'],protocolVersion:'auto'},other:{command:'never-run-other'}}}),{mode:0o600});resetMcpStartupStateForTests();resetMcpCodemodeRuntimeForTests();await hydrateMcpKeychainCredentials(ws.workspace,()=>{throw Error('Forbidden credentials');});const h=harness(options);try{await h.ready;await run(h,ws.workspace);}finally{await h.dispose();resetMcpStartupStateForTests();resetMcpCodemodeRuntimeForTests();}});}
function harness(options:{close?:()=>Promise<void>;reload?:()=>Promise<void>;resume?:()=>void;timeout?:number}={}){
 const events:string[]=[],owners:Array<ReturnType<typeof createMcpBridgeOwner>>=[],sessions:any[]=[];
 const ready=(async()=>{for(let n=0;n<2;n++){let shutdown:Array<()=>Promise<void>>=[];const api=()=>({on(event:string,fn:()=>Promise<void>){if(event==='session_shutdown')shutdown.push(fn);}});const owner=createMcpBridgeOwner((_lease,onLifecycle)=>()=>onLifecycle({async shutdown(){events.push(`close:${n}`);await options.close?.();}}),undefined,{requireLifecycle:true});owners.push(owner);await owner.extension.factory(api() as any);const published={extensions:[{path:'<inline:piclaw-mcp-owner>'}],errors:[]} as any;
 const session={async abort(){events.push(`abort:${n}`);},async prompt(){},dispose(){},getAllTools:()=>[{name:'codemode'}],getActiveToolNames:()=>['read'],setActiveToolsByName(){},async reload(input:any){events.push(`reload:${n}`);for(const fn of shutdown)await fn();shutdown=[];await options.reload?.();await owner.extension.factory(api() as any);await input.beforeSessionStart();events.push(`started:${n}`);}};bindMcpBridgeOwner(session,{getExtensions:()=>published} as any,owner);sessions.push(session);}})();
 const manager={blockMcpAdmissions(){events.push('fence');},async fenceMcpAndSnapshot(){return sessions.map(session=>({session})) as any;},resumeMcpAdmissions(){events.push('resume');options.resume?.();},async quarantineMcpRuntime(){events.push('quarantine');}};
 const controller=new McpCodemodeController(manager,options.timeout??1000);
 return{ready,controller,events,sessions,async dispose(){for(const owner of owners)owner.dispose();await Bun.sleep(0);},input(edit:unknown){const response=controller.inspectServers(edit);return{revision:response.revision,acknowledgeInterruptions:true};}};
}
test('server Apply preserves private/advanced unrelated config, waits both ACKs, reloads both histories and consumes preview',async()=>fixture(async(h,root)=>{
 const original=JSON.parse(readFileSync(join(root,'.pi','mcp.json'),'utf8'));const input=h.input({name:'demo',action:'update',patch:{requestTimeoutMs:4000}});const result=await h.controller.applyServers(input,()=>{},new AbortController().signal);
 expect(result.phase).toBe('ready');expect(h.events.indexOf('reload:0')).toBeGreaterThan(h.events.indexOf('close:1'));expect(h.events.indexOf('resume')).toBeGreaterThan(h.events.indexOf('started:1'));expect(JSON.parse(readFileSync(join(root,'.pi','mcp.json'),'utf8'))).toEqual({...original,mcpServers:{...original.mcpServers,demo:{...original.mcpServers.demo,requestTimeoutMs:4000}}});expect(JSON.stringify(result)).not.toContain('private-arg');await expect(h.controller.applyServers(input,()=>{},new AbortController().signal)).rejects.toThrow('expired');
}));
for(const source of ['local','inherited'] as const)for(const patch of [
 {command:'new-program',args:['--key=PRIVATE_TEST_SENTINEL'],env:null},
 {command:'new-program',env:{OTHER:'PRIVATE_TEST_SENTINEL'},args:null},
])test(`${source} opaque credential payload cannot be wrapped or rekeyed to a new program`,async()=>fixture(async(h,root)=>{
 writeFileSync(join(root,source==='local'?'.pi/mcp.json':'.mcp.json'),JSON.stringify({mcpServers:{sensitive:{command:'old-program',args:['PRIVATE_TEST_SENTINEL'],env:{LABEL:'PRIVATE_TEST_SENTINEL'}}}}),{mode:0o600});await hydrateMcpKeychainCredentials(root,()=>{throw Error('No keychain');});expect(()=>h.input({name:'sensitive',action:'update',patch})).toThrow('inherited_credentials');expect(h.events).toEqual([]);
}));
for(const original of [
 {command:'old',args:['${SYNTHETIC_URL_TOKEN}']},
 {command:'old',env:{LABEL:'${SYNTHETIC_URL_TOKEN}'}},
 {url:'https://old.test/mcp?value=${SYNTHETIC_URL_TOKEN}'},
])test('effective credential reference cannot follow an argument/environment/URL to a replacement URL',async()=>fixture(async(h,root)=>{
 const old=process.env.SYNTHETIC_URL_TOKEN;process.env.SYNTHETIC_URL_TOKEN='synthetic-only';
 try{writeFileSync(join(root,'.pi/mcp.json'),JSON.stringify({mcpServers:{sensitive:original}}),{mode:0o600});await hydrateMcpKeychainCredentials(root,()=>{throw Error('No keychain');});expect(()=>h.input({name:'sensitive',action:'update',patch:{url:'https://replacement.test/mcp?value=${SYNTHETIC_URL_TOKEN}',command:null,args:null,env:null}})).toThrow('inherited_credentials');expect(h.events).toEqual([]);}
 finally{if(old===undefined)delete process.env.SYNTHETIC_URL_TOKEN;else process.env.SYNTHETIC_URL_TOKEN=old;}
}));
test('exact inherited keychain credential cannot follow a repointed endpoint',async()=>fixture(async(h,root)=>{
 writeFileSync(join(root,'.mcp.json'),JSON.stringify({mcpServers:{remote:{url:'https://original.test/mcp',bearerTokenKeychain:'synthetic/key',bearerTokenEnv:'SYNTHETIC'}}}));await hydrateMcpKeychainCredentials(root,async()=>({secret:'SECRET_SENTINEL'} as any));expect(()=>h.input({name:'remote',action:'update',patch:{url:'https://new.test/mcp'}})).toThrow('inherited_credentials');expect(h.events).toEqual([]);
}));
test('owner revocation after all ACKs prevents rename and leaves runtime fenced',async()=>fixture(async(h,root)=>{
 const before=readFileSync(join(root,'.pi','mcp.json'),'utf8'),input=h.input({name:'demo',action:'update',patch:{disabled:true}});await expect(h.controller.applyServers(input,()=>{if(h.events.filter(e=>e.startsWith('close:')).length===2)throw Error('revoked');},new AbortController().signal)).rejects.toThrow('before configuration commit');expect(readFileSync(join(root,'.pi','mcp.json'),'utf8')).toBe(before);expect(h.events).not.toContain('resume');expect(()=>assertSelectedMcpOwner()).toThrow('blocked');
}));
test('codemode and server Apply share one phase and refuse overlap',async()=>{
 let finish!:()=>void;const gate=new Promise<void>(resolve=>{finish=resolve;});await fixture(async(h)=>{const input=h.input({name:'demo',action:'update',patch:{disabled:true}});const pending=h.controller.applyServers(input,()=>{},new AbortController().signal);await Bun.sleep(0);await expect(h.controller.apply({policy:{engine:'adapter',codemode:'on'},revision:h.controller.inspect().revision,acknowledgeInterruptions:true},()=>{})).rejects.toThrow('busy');finish();await pending;},{close:()=>gate});
});
test('failed reload after rename reports saved but unconfirmed and never resumes',async()=>fixture(async(h,root)=>{const input=h.input({name:'demo',action:'update',patch:{disabled:true}});await expect(h.controller.applyServers(input,()=>{},new AbortController().signal)).rejects.toThrow('configuration saved');expect(JSON.parse(readFileSync(join(root,'.pi','mcp.json'),'utf8')).mcpServers.demo.disabled).toBe(true);expect(h.events).not.toContain('resume');expect(()=>assertSelectedMcpOwner()).toThrow('blocked');},{reload:async()=>{throw Error('reload failure');}}));
test('removing override reveals inherited definition and disabling keeps it inert',async()=>fixture(async(h,root)=>{writeFileSync(join(root,'.mcp.json'),JSON.stringify({mcpServers:{demo:{command:'inherited-command'}}}));await hydrateMcpKeychainCredentials(root,()=>{throw Error('No secrets');});const preview=h.controller.inspectServers({name:'demo',action:'remove_override'});expect(preview.preview?.patch).toMatchObject({command:'inherited-command'});const prepared=prepareMcpServerEdit(root,{name:'demo',action:'update',patch:{disabled:true}});await writeMcpProjectOverride({workspaceDir:root,expectedRevision:getMcpBridgeSnapshot().revision,candidate:prepared.candidate,authority:createMcpConfigWriteAuthority({workspaceDir:root,authorise:()=>{},signal:new AbortController().signal})});expect(JSON.parse(readFileSync(join(root,'.pi','mcp.json'),'utf8')).mcpServers.demo.disabled).toBe(true);}));
test('deadline during post-rename unlock reports saved, keeps fenced, and observes the late write tail',async()=>{
 const original=lockfile.lock;let unlock!:()=>void;const tail=new Promise<void>(resolve=>{unlock=resolve;});
 try{lockfile.lock=(async(...args:Parameters<typeof original>)=>{const release=await original(...args);return async()=>{await release();await tail;};}) as typeof original;
 await fixture(async(h,root)=>{const input=h.input({name:'demo',action:'update',patch:{disabled:true}});await expect(h.controller.applyServers(input,()=>{},new AbortController().signal)).rejects.toThrow('configuration saved');expect(JSON.parse(readFileSync(join(root,'.pi','mcp.json'),'utf8')).mcpServers.demo.disabled).toBe(true);expect(h.events).not.toContain('resume');unlock();await Bun.sleep(0);expect(h.controller.inspect().runtime.observedPolicy).toBeNull();},{timeout:50});}
 finally{unlock?.();lockfile.lock=original;}
});
test('cancelled held ACK prevents any file write and captured public prompts stay denied',async()=>{
 let close!:()=>void;const cleanup=new Promise<void>(resolve=>{close=resolve;});await fixture(async(h,root)=>{const before=readFileSync(join(root,'.pi','mcp.json'),'utf8'),input=h.input({name:'demo',action:'update',patch:{disabled:true}}),abort=new AbortController();const pending=h.controller.applyServers(input,()=>{},abort.signal);await Bun.sleep(0);abort.abort(Error('cancelled'));await expect(pending).rejects.toThrow('before configuration commit');close();await Bun.sleep(0);expect(readFileSync(join(root,'.pi','mcp.json'),'utf8')).toBe(before);expect(h.events).not.toContain('resume');expect(()=>h.sessions[0].prompt()).toThrow();},{close:()=>cleanup});
});
test('new configured keychain reference failure after commit cannot be reported as applied',async()=>fixture(async(h,root)=>{
 const input=h.input({name:'remote',action:'update',patch:{url:'https://never-contact.test/mcp',auth:'bearer',bearerTokenKeychain:'missing-synthetic-entry',bearerTokenEnv:'SYNTHETIC_UNAVAILABLE_KEY'}});
 await expect(h.controller.applyServers(input,()=>{},new AbortController().signal)).rejects.toThrow('configuration saved');expect(JSON.parse(readFileSync(join(root,'.pi','mcp.json'),'utf8')).mcpServers.remote.bearerTokenKeychain).toBe('missing-synthetic-entry');expect(h.events).not.toContain('resume');expect(h.controller.inspect().runtime.observedPolicy).toBeNull();
}));
for(const source of ['local','inherited'] as const)for(const patch of [{command:'new-program'},{args:['new-script.ts']},{cwd:'/new/program-root'}])test(`${source} stdio destination edit cannot inherit credential environment`,async()=>fixture(async(h,root)=>{
 const old=process.env.SYNTHETIC_STDIO_TOKEN;process.env.SYNTHETIC_STDIO_TOKEN='synthetic-only';
 try{const path=join(root,source==='local'?'.pi/mcp.json':'.mcp.json');writeFileSync(path,JSON.stringify({mcpServers:{sensitive:{command:'bun',args:['old-script.ts'],cwd:'/original',env:{API_KEY:'${SYNTHETIC_STDIO_TOKEN}'}}}}),{mode:0o600});await hydrateMcpKeychainCredentials(root,()=>{throw Error('No keychain');});expect(()=>h.input({name:'sensitive',action:'update',patch})).toThrow('inherited_credentials');expect(h.events).toEqual([]);}
 finally{if(old===undefined)delete process.env.SYNTHETIC_STDIO_TOKEN;else process.env.SYNTHETIC_STDIO_TOKEN=old;}
}));
for(const source of ['committed','lower'] as const)test(`mutation of ${source} config while unlock waits is saved but never activated`,async()=>{
 const originalLock=lockfile.lock;let release!:()=>void,entered!:()=>void;const tail=new Promise<void>(resolve=>{release=resolve;}),waiting=new Promise<void>(resolve=>{entered=resolve;});
 try{lockfile.lock=(async(...args:Parameters<typeof originalLock>)=>{const unlock=await originalLock(...args);return async()=>{await unlock();entered();await tail;};}) as typeof originalLock;
 await fixture(async(h,root)=>{if(source==='lower'){writeFileSync(join(root,'.mcp.json'),JSON.stringify({mcpServers:{lower:{command:'old-lower'}}}));await hydrateMcpKeychainCredentials(root,()=>{throw Error('No keychain');});}
 const input=h.input({name:'demo',action:'update',patch:{requestTimeoutMs:5000}}),observed=h.controller.applyServers(input,()=>{},new AbortController().signal).then(()=>null,error=>error);await waiting;writeFileSync(join(root,source==='committed'?'.pi/mcp.json':'.mcp.json'),JSON.stringify({mcpServers:{unpreviewed:{command:'must-never-run'}}}),{mode:0o600});release();const error=await observed;expect(String(error)).toContain('configuration saved');expect(h.events.filter(event=>event.startsWith('reload:'))).toEqual([]);expect(h.events).not.toContain('resume');expect(()=>assertSelectedMcpOwner()).toThrow('blocked');});}
 finally{release?.();lockfile.lock=originalLock;}
});
test('a lower-source mutation during replacement loading never reaches session startup',async()=>{
 let mutate=()=>{};await fixture(async(h,root)=>{writeFileSync(join(root,'.mcp.json'),JSON.stringify({mcpServers:{lower:{command:'previewed-lower'}}}));await hydrateMcpKeychainCredentials(root,()=>{throw Error('No keychain');});mutate=()=>writeFileSync(join(root,'.mcp.json'),JSON.stringify({mcpServers:{unpreviewed:{command:'must-never-start'}}}));const input=h.input({name:'demo',action:'update',patch:{requestTimeoutMs:5000}});await expect(h.controller.applyServers(input,()=>{},new AbortController().signal)).rejects.toThrow('configuration saved');expect(h.events.filter(event=>event.startsWith('started:'))).toEqual([]);expect(h.events).not.toContain('resume');},{reload:async()=>{mutate();}});
});
for(const source of ['local','inherited'] as const)for(const patch of [
 {command:'new-program',args:['--key=${SYNTHETIC_STDIO_TOKEN}'],env:null},
 {command:'new-program',env:{AUTH_TOKEN:'${SYNTHETIC_STDIO_TOKEN}'},args:null},
])test(`${source} stdio credential reference cannot be wrapped or moved to a different map key`,async()=>fixture(async(h,root)=>{
 const old=process.env.SYNTHETIC_STDIO_TOKEN;process.env.SYNTHETIC_STDIO_TOKEN='synthetic-only';
 try{writeFileSync(join(root,source==='local'?'.pi/mcp.json':'.mcp.json'),JSON.stringify({mcpServers:{sensitive:{command:'old-program',args:['${SYNTHETIC_STDIO_TOKEN}'],env:{API_KEY:'${SYNTHETIC_STDIO_TOKEN}'}}}}),{mode:0o600});await hydrateMcpKeychainCredentials(root,()=>{throw Error('No keychain');});expect(()=>h.input({name:'sensitive',action:'update',patch})).toThrow('inherited_credentials');expect(h.events).toEqual([]);}
 finally{if(old===undefined)delete process.env.SYNTHETIC_STDIO_TOKEN;else process.env.SYNTHETIC_STDIO_TOKEN=old;}
}));
