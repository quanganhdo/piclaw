import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { createMcpBridgeOwner, bindMcpBridgeOwner } from '../../../src/agent-pool/mcp-bridge-owner';
import { createConstrainedNativeOwner } from '../../../src/agent-pool/mcp-native-owner';
import { McpCodemodeController, mcpCodemodeExtension, bindMcpCodemodePolicy, selectedMcpPolicy, resetMcpCodemodeRuntimeForTests } from '../../../src/agent-pool/mcp-codemode-runtime';
import { hydrateMcpKeychainCredentials, getMcpBridgeSnapshot } from '../../../src/secure/mcp-keychain';
const { createMcpAdapter } = createRequire(import.meta.url)('pi-mcp-adapter');
const root = process.env.PICLAW_WORKSPACE!; assert(root);
const mode=process.argv[2]??'success';
const agentDir = join(root, 'agent'); mkdirSync(agentDir, {recursive:true});mkdirSync(join(root,'.piclaw'),{recursive:true});mkdirSync(join(root,'.pi'),{recursive:true});
const instance=join(root,'.piclaw/config.json');
writeFileSync(instance,JSON.stringify({domains:{access:{mode:'single-user'},mcp:{engine:'adapter',codemode:'auto'}}}),{mode:0o600});
writeFileSync(join(root,'.pi/mcp.json'),JSON.stringify({mcpServers:{fixture:{command:process.execPath,args:['--no-env-file',resolve(import.meta.dir,'../../fixtures/mcp-native-tool-server.mjs')],directTools:true}}}),{mode:0o600});
resetMcpCodemodeRuntimeForTests();await hydrateMcpKeychainCredentials(root);
let generations=0,quarantines=0,resumes=0;
const owner=createMcpBridgeOwner((bridge,lifecycle)=>{
  generations++;
  if(selectedMcpPolicy().engine==='native')return createConstrainedNativeOwner(getMcpBridgeSnapshot().nativePreview,lifecycle,name=>bridge.resolveRuntimeEnv(name));
  return createMcpAdapter({config:bridge.config,initializeOnLoad:false,onLifecycle:(handle:any)=>lifecycle(mode==='close-failure'?{async shutdown(){await handle.shutdown();throw Error('Injected old owner cleanup failure');}}:handle),resolveRuntimeEnv:(name:string)=>bridge.resolveRuntimeEnv(name)});
},undefined,{requireLifecycle:true});
const settings=SettingsManager.inMemory();
const runtime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false});
const loader=new DefaultResourceLoader({cwd:root,agentDir,settingsManager:settings,noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true,extensionFactories:[mcpCodemodeExtension,owner.extension,...(mode==='startup-failure'?[(pi:any)=>{pi.registerMcpServer('extension-server',{type:'stdio',command:'never-run'});}]:[])]});await loader.reload();
const result=await createAgentSession({cwd:root,agentDir,modelRuntime:runtime,settingsManager:settings,sessionManager:SessionManager.inMemory(root),resourceLoader:loader,noTools:'builtin'});
await result.session.bindExtensions({mode:'rpc',onError:error=>{if(mode!=='startup-failure')throw Error(JSON.stringify(error));}});bindMcpBridgeOwner(result.session,loader,owner);bindMcpCodemodePolicy(result.session);
const manager={blockMcpAdmissions(){},async fenceMcpAndSnapshot(){return[result] as any;},resumeMcpAdmissions(){resumes++;},async quarantineMcpRuntime(){quarantines++;}};
const controller=new McpCodemodeController(manager,5000),session=result.session;
session.sessionManager.appendMessage({role:'user',content:'Keep controller history',timestamp:Date.now()});const history=JSON.stringify(session.sessionManager.getEntries()),id=session.sessionId;
const apply=(engine:'native'|'adapter')=>controller.apply({policy:{engine,codemode:'auto'},revision:controller.inspect({engine,codemode:'auto'}).revision,acknowledgeInterruptions:true},()=>{});
try{
  if(mode==='startup-failure'){
    await assert.rejects(apply('native'),/remain blocked/);assert.equal(generations,2);assert.equal(resumes,0);assert(quarantines>0);
  }else if(mode==='close-failure'){
    await assert.rejects(apply('native'),/remain blocked/);assert.equal(generations,1);assert.equal(resumes,0);assert(quarantines>0);assert.equal(JSON.parse(readFileSync(instance,'utf8')).domains.mcp.engine,'adapter');
  }else{
    const inspect=await apply('native');assert.equal(inspect.runtime.configuredFactory,'native');assert.equal(generations,2);
    const deadline=Date.now()+5000;while(!session.getAllTools().some(t=>t.name==='mcp__fixture__echo')&&Date.now()<deadline)await Bun.sleep(10);assert(session.getAllTools().some(t=>t.name==='mcp__fixture__echo'));
    assert.equal(session.sessionId,id);assert.equal(JSON.stringify(session.sessionManager.getEntries()),history);
    await apply('adapter');assert.equal(generations,3);assert.equal(resumes,2);assert.equal(quarantines,0);assert.equal(JSON.parse(readFileSync(instance,'utf8')).domains.mcp.engine,'adapter');
  }
  console.log(JSON.stringify({mode,generations,quarantines,resumes,historyPreserved:JSON.stringify(session.sessionManager.getEntries())===history,passed:true}));
}finally{await session.abort();try{await owner.shutdown();}catch(error){if(mode!=='close-failure')throw error;assert.match(String(error),/cleanup failed/);}session.dispose();}
