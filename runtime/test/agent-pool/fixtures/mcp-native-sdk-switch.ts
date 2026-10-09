import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { createMcpBridgeOwner, bindMcpBridgeOwner, acknowledgeMcpSessionsShutdown, reloadAcknowledgedMcpSessions } from '../../../src/agent-pool/mcp-bridge-owner';
import { createConstrainedNativeOwner } from '../../../src/agent-pool/mcp-native-owner';
const { createMcpAdapter } = createRequire(import.meta.url)('pi-mcp-adapter');
const root = process.env.PICLAW_WORKSPACE!; assert(root);
const agentDir = join(root, 'agent'); mkdirSync(agentDir, {recursive:true});
const args = ['--no-env-file', resolve(import.meta.dir, '../../fixtures/mcp-native-tool-server.mjs')];
let native = false, acquired = 0, released = 0;
const owner = createMcpBridgeOwner((_lease, lifecycle) => native
  ? createConstrainedNativeOwner({servers:[{name:'fixture',config:{type:'stdio',command:process.execPath,args,exposure:'direct'},source:'fixture'}],errors:[]}, lifecycle)
  : createMcpAdapter({config:{mcpServers:{fixture:{command:process.execPath,args,directTools:true}}},initializeOnLoad:false,onLifecycle:lifecycle}),
  () => { acquired++; let done=false; return {config:{mcpServers:{}},revision:'fixture',resolveRuntimeEnv:()=>({}),release(){if(!done){done=true;released++;}}}; }, {requireLifecycle:true});
const settings = SettingsManager.inMemory();
const runtime = await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false});
const loader = new DefaultResourceLoader({cwd:root,agentDir,settingsManager:settings,noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true,extensionFactories:[owner.extension]});
await loader.reload();
const result = await createAgentSession({cwd:root,agentDir,modelRuntime:runtime,settingsManager:settings,sessionManager:SessionManager.inMemory(root),resourceLoader:loader,noTools:'builtin'});
await result.session.bindExtensions({mode:'rpc',onError:error=>{throw Error(JSON.stringify(error));}});
bindMcpBridgeOwner(result.session, loader, owner);
const session=result.session;
session.sessionManager.appendMessage({role:'user',content:'Preserve synthetic history',timestamp:Date.now()});
const history=JSON.stringify(session.sessionManager.getEntries()),id=session.sessionId;
async function switchTo(next:boolean){
  const signal=new AbortController().signal;
  const receipt=await acknowledgeMcpSessionsShutdown([session],signal);
  assert.equal(acquired,released,'Old owner lease must release before new generation.');
  native=next;
  await reloadAcknowledgedMcpSessions(receipt,{beforeSessionStart:()=>{assert.equal(acquired,released+1);}});
  assert.equal(session.sessionId,id);assert.equal(JSON.stringify(session.sessionManager.getEntries()),history);
}
try{
  await switchTo(true);
  const deadline=Date.now()+5000;
  while(!session.getAllTools().some(tool=>tool.name==='mcp__fixture__echo')&&Date.now()<deadline)await Bun.sleep(10);
  assert(session.getAllTools().some(tool=>tool.name==='mcp__fixture__echo'));
  assert(!session.getAllTools().some(tool=>tool.name==='list_mcp_resources'));
  await switchTo(false);
  assert.equal(acquired,3);assert.equal(released,2);
  await owner.shutdown();session.dispose();
  await Bun.sleep(10);assert.equal(acquired,released);
  console.log(JSON.stringify({adapterNativeAdapter:true,historyPreserved:true,acquired,released,soleOwner:true}));
}finally{await session.abort();await owner.shutdown();session.dispose();}
