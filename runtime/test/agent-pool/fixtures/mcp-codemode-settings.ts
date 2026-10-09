import assert from "node:assert/strict";
import {mkdirSync,writeFileSync,readFileSync} from "node:fs";
import {join} from "node:path";
import type {AssistantMessage,Model,Provider,ToolCall} from "@earendil-works/pi-ai";
const root=process.env.PICLAW_WORKSPACE!; assert.ok(root);
process.env.PI_CODING_AGENT_DIR=join(root,"agent");
mkdirSync(join(root,".piclaw"),{recursive:true});
writeFileSync(join(root,".piclaw/config.json"),JSON.stringify({domains:{access:{mode:"single-user"}}}),{mode:0o600});
const {createAgentSession,DefaultResourceLoader,ModelRuntime,SessionManager,SettingsManager}=await import("@earendil-works/pi-coding-agent");
const {InMemoryCredentialStore,createAssistantMessageEventStream}=await import("@earendil-works/pi-ai");
const {Type}=await import("@sinclair/typebox");
const {McpCodemodeController,mcpCodemodeExtension,bindMcpCodemodePolicy,resetMcpCodemodeRuntimeForTests}=await import("../../../src/agent-pool/mcp-codemode-runtime.js");
resetMcpCodemodeRuntimeForTests();
const modelRuntime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false});
const model:Model<"openai-completions">={id:"synthetic",provider:"codemode-fixture",name:"Fixture",api:"openai-completions",baseUrl:"https://unused.invalid",reasoning:false,input:["text"],contextWindow:128000,maxTokens:4096,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}};
let pending:ToolCall|undefined,invoked=0;const nested:Array<{name:string,parent?:string}>=[];
const stream=()=>{
  const call=pending;pending=undefined;
  const message:AssistantMessage={role:"assistant",content:call?[call]:[{type:"text",text:"done"}],api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),stopReason:call?"toolUse":"stop",usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
  const result=createAssistantMessageEventStream();result.push({type:"done",reason:call?"toolUse":"stop",message});return result;
};
const provider:Provider={id:model.provider,name:"Fixture",getModels:()=>[model],auth:{apiKey:{name:"No credential",login:async()=>{throw Error("Forbidden");},resolve:async()=>({auth:{},source:"synthetic"})}},stream,streamSimple:stream};
modelRuntime.registerNativeProvider(provider);await modelRuntime.refresh({allowNetwork:false});
const sessions:Awaited<ReturnType<typeof createAgentSession>>[]=[];
async function create(){
  const settings=SettingsManager.inMemory();settings.applyOverrides({compaction:{enabled:false},retry:{enabled:false}});
  const loader=new DefaultResourceLoader({cwd:root,agentDir:join(root,"agent"),settingsManager:settings,noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true,extensionFactories:[mcpCodemodeExtension,pi=>{
    pi.registerTool({name:"fixture_echo",label:"Fixture",description:"Echo",parameters:Type.Object({value:Type.String()}),async execute(_id,args){invoked++;return {content:[{type:"text",text:args.value}],details:{}};}});
    pi.on("tool_call",e=>{nested.push({name:e.toolName,parent:e.parentToolCallId});if(e.toolName==="fixture_echo"&&e.input.value==="denied")return {block:true,reason:"Synthetic refusal"};});
  }]});await loader.reload();
  const result=await createAgentSession({cwd:root,agentDir:join(root,"agent"),modelRuntime,model,settingsManager:settings,sessionManager:SessionManager.inMemory(root),resourceLoader:loader,noTools:"builtin"});
  await result.session.bindExtensions({mode:"rpc",onError:e=>{throw Error(JSON.stringify(e));}});bindMcpCodemodePolicy(result.session);sessions.push(result);return result;
}
const first=await create();
const manager={blockMcpAdmissions(){},async fenceMcpAndSnapshot(){return sessions as any;},resumeMcpAdmissions(){},async quarantineMcpRuntime(){throw Error("Unexpected quarantine");}};
const controller=new McpCodemodeController(manager);
async function apply(codemode:string){await controller.apply({policy:{engine:"adapter",codemode},revision:controller.inspect().revision,acknowledgeInterruptions:true},()=>{});}
async function execute(session:typeof first.session,id:string,code:string){pending={type:"toolCall",id,name:"codemode",arguments:{code}};await session.prompt("fixture");assert.equal(pending,undefined);const result=session.messages.findLast(m=>m.role==="toolResult"&&m.toolCallId===id);assert.ok(result&&result.role==="toolResult");return result;}
try{
  assert.ok(!first.session.getActiveToolNames().includes("codemode"));
  let activationWrites=0;
  const setActive=first.session.setActiveToolsByName.bind(first.session);
  first.session.setActiveToolsByName=names=>{activationWrites++;setActive(names);};
  first.session.sessionManager.appendMessage({role:"user",content:"Preserve this history",timestamp:Date.now()});
  const id=first.session.sessionId,history=JSON.stringify(first.session.sessionManager.getEntries());
  await apply("on");assert.ok(first.session.getActiveToolNames().includes("codemode"));assert.equal(first.session.sessionId,id);assert.equal(JSON.stringify(first.session.sessionManager.getEntries()),history);
  const writesAfterApply=activationWrites;
  const result=await execute(first.session,"script","text(await tools.fixture_echo({value:'hello'}));");assert.equal(result.isError,false,JSON.stringify(result));assert.ok(JSON.stringify(result).includes("hello"));assert.equal(invoked,1);assert.ok(nested.some(e=>e.name==="fixture_echo"&&e.parent==="script"));assert.equal(activationWrites,writesAfterApply);
  const denied=await execute(first.session,"denied","await tools.fixture_echo({value:'denied'});");assert.equal(denied.isError,true);assert.equal(invoked,1);
  const models=await execute(first.session,"models","await models();");assert.equal(models.isError,true);assert.equal(invoked,1);
  const second=await create();assert.ok(second.session.getActiveToolNames().includes("codemode"));
  assert.equal((await execute(second.session,"second","text(await tools.fixture_echo({value:'second'}));")).isError,false);assert.equal(invoked,2);
  await apply("off");assert.ok(sessions.every(r=>!r.session.getActiveToolNames().includes("codemode")));
  first.session.setActiveToolsByName(["codemode","fixture_echo"]);
  const off=await execute(first.session,"off","await tools.fixture_echo({value:'never'});");assert.equal(off.isError,true);assert.equal(invoked,2);assert.ok(!first.session.getActiveToolNames().includes("codemode"));
  const third=await create();assert.ok(!third.session.getActiveToolNames().includes("codemode"));
  assert.equal(JSON.parse(readFileSync(join(root,".piclaw/config.json"),"utf8")).domains.mcp.codemode,"off");
  const guard=(globalThis as any).__ADMISSION_ENFORCEMENT__;assert.equal(guard.networkAttempts,0);assert.equal(guard.childProcessAttempts,0);
  console.log(JSON.stringify({version:JSON.parse(readFileSync(new URL('../package.json',import.meta.resolve('@earendil-works/pi-coding-agent')),'utf8')).version,currentAndNewSessions:true,scriptCalls:invoked,nestedPolicy:true,modelsDisabled:true,offFailClosed:true,historyPreserved:true,networkAttempts:guard.networkAttempts,childProcessAttempts:guard.childProcessAttempts}));
}finally{for(const {session} of sessions){await session.abort();session.dispose();}}
