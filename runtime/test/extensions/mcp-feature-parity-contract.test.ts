import {expect,test} from 'bun:test';
import {createRequire} from 'node:module';
import {existsSync,readFileSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dir,'../../..'),require=createRequire(import.meta.url);
const {acquireMcpOutputArtifactOwner,guardMcpOutput}=require('../../../node_modules/pi-mcp-adapter/mcp-output-guard.ts') as any;
const {McpServerManager}=require('../../../node_modules/pi-mcp-adapter/server-manager.ts') as any;
const {initializeMcp}=require('../../../node_modules/pi-mcp-adapter/init.ts') as any;
const {createMcpRuntimeOwner}=require('../../../node_modules/pi-mcp-adapter/runtime-owner.ts') as any;
const {reconstructPromptMetadata}=require('pi-mcp-adapter/metadata-cache') as any;
const {createPromptCommand}=require('../../../node_modules/pi-mcp-adapter/prompts.ts') as any;

test('retained adapter owns prompts, resources, Apps and bounded result surfaces absent from native exact target',()=>{
 const client=readFileSync(resolve(root,'node_modules/@earendil-works/pi-mcp/dist/client.d.ts'),'utf8');
 expect(client).not.toContain('listPrompts');expect(client).not.toContain('getPrompt');
 const nativeResources=readFileSync(resolve(root,'node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/resources.js'),'utf8');
 expect(nativeResources).toContain('isMcpAppResource');expect(nativeResources).toContain('const visible = (item) => !isMcpAppResource(item)');
 const adapterClient=readFileSync(resolve(root,'node_modules/pi-mcp-adapter/server-manager.ts'),'utf8');
 expect(adapterClient).toContain('fetchAllPrompts');expect(adapterClient).toContain('fetchAllResources');
 const adapterUi=readFileSync(resolve(root,'node_modules/pi-mcp-adapter/ui-resource-handler.ts'),'utf8');expect(adapterUi).toContain('UiResourceHandler');
 const proxy=readFileSync(resolve(root,'node_modules/pi-mcp-adapter/proxy-modes.ts'),'utf8');expect(proxy).toContain('executeUiMessages');expect(proxy).toContain('result.isError');
 const streamTypes=readFileSync(resolve(root,'node_modules/pi-mcp-adapter/ui-stream-types.ts'),'utf8');expect(streamTypes).toContain('structuredContent');expect(streamTypes).toContain('isError');
});

test('retained adapter executes real prompt and structured-result flows through one client owner',async()=>{
 const manager=new McpServerManager();
 try{
  const promptFixture=resolve(root,'node_modules/pi-mcp-adapter/__tests__/fixtures/prompts-server.mjs');
  const promptConnection=await manager.connect('prompts',{command:process.execPath,args:[promptFixture]});
  const metadata=reconstructPromptMetadata('prompts',promptConnection.prompts,'server');const brief=metadata.find((item:any)=>item.originalName==='brief');expect(brief).toBeDefined();
  const messages:string[]=[];const promptState={manager,config:{settings:{},mcpServers:{prompts:{command:process.execPath,args:[promptFixture]}}},toolMetadata:new Map(),resourceCounts:new Map(),promptMetadata:new Map([['prompts',metadata]]),promptMetadataLive:new Set(),serverInstructions:new Map(),failureTracker:new Map(),failureMessages:new Map(),completedUiSessions:[]};
  const command=createPromptCommand({sendUserMessage:(text:string)=>messages.push(text)},()=>promptState,brief);
  await command.handler('topic=mcp date=2026-09-30',{hasUI:false});expect(messages).toEqual(['Give me the brief on mcp for 2026-09-30.']);
  const toolFixture=resolve(root,'node_modules/pi-mcp-adapter/__tests__/fixtures/mcp-code-server.mjs');
  const toolConnection=await manager.connect('tools',{command:process.execPath,args:[toolFixture]});
  expect(await toolConnection.client.callTool({name:'echo',arguments:{value:'ok'}})).toMatchObject({structuredContent:{echoed:'ok'}});
  expect(await toolConnection.client.callTool({name:'fail',arguments:{}})).toMatchObject({isError:true});
 }finally{await manager.closeAll();}
},20000);

test('Piclaw default-deny config does not advertise or register sampling/elicitation',async()=>{
 const owner=createMcpRuntimeOwner();
 const state=await initializeMcp({getFlag:()=>undefined} as any,{cwd:root,hasUI:true,mode:'tui',ui:{},modelRegistry:{},model:undefined,signal:undefined} as any,owner,{config:{settings:{sampling:false,samplingAutoApprove:false,elicitation:false},mcpServers:{}}});
 try{
  expect(state.config.settings).toMatchObject({sampling:false,samplingAutoApprove:false,elicitation:false});
  expect((state.manager as any).samplingConfig).toBeUndefined();expect((state.manager as any).elicitationConfig).toBeUndefined();
  const fixture=resolve(root,'node_modules/pi-mcp-adapter/__tests__/fixtures/elicitation-server.mjs');
  const connection=await state.manager.connect('denied',{command:process.execPath,args:[fixture]});
  const capabilities=await connection.client.callTool({name:'capabilities',arguments:{}});
  expect(capabilities.content).toEqual([{type:'text',text:'null'}]);
 }
 finally{await owner.stop('test complete');}
},20000);

test('adapter output guard bounds text/details, preserves images and cleans protected spills',async()=>{
 const image={type:'image',data:'YQ==',mimeType:'image/png'};
 const raw={content:[{type:'text',text:'x'.repeat(500)}],structuredContent:{private:'y'.repeat(500)},isError:false};
 const releaseFirst=acquireMcpOutputArtifactOwner(),releaseSecond=acquireMcpOutputArtifactOwner();
 const guarded=await guardMcpOutput([{type:'text',text:'x'.repeat(500)},image],{maxBytes:100,maxLines:10,detailsMaxBytes:120,rawMcpResult:raw});
 expect(guarded.outputGuard).toMatchObject({truncated:true,imageBlocksPassedThrough:1});expect(guarded.content.at(-1)).toEqual(image);
 const returnedText=guarded.content[0]?.type==='text'?guarded.content[0].text:'';expect(Buffer.byteLength(returnedText,'utf8')).toBeLessThanOrEqual(100);expect(returnedText.split('\n').length).toBeLessThanOrEqual(10);
 const outputPath=guarded.outputGuard.fullOutputPath as string;expect(existsSync(outputPath)).toBe(true);expect(statSync(outputPath).mode&0o777).toBe(0o600);
 expect(JSON.stringify(guarded.mcpResult)).not.toContain('y'.repeat(100));
 await releaseFirst();expect(existsSync(outputPath)).toBe(true);await releaseSecond();expect(existsSync(outputPath)).toBe(false);
});
