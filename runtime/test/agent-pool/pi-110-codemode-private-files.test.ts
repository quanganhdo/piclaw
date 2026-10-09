import { expect,test } from 'bun:test';
import { readFileSync,statSync,rmSync,readdirSync,mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ModelRuntime,SettingsManager,SessionManager,DefaultResourceLoader,createAgentSessionFromServices,createCodemodeExtension } from '@earendil-works/pi-coding-agent';
import { createTempWorkspace } from '../helpers.js';
import { createAssistantMessageEventStream, type AssistantMessage, type Model, type Provider } from '@earendil-works/pi-ai';
import { createTestCredentialStore } from '../model-services-fixture.js';
import { assertPathWithinTestFilesystemIsolation } from '../../scripts/test-filesystem-isolation.js';

test('public 1.1.0 codemode writes shown images and truncated output as private owned files',async()=>{
 const ws=createTempWorkspace('codemode103-files-'),paths=new Set<string>();
 const originalTmp=process.env.TMPDIR,outputDir=mkdtempSync(join(tmpdir(),'codemode103-private-'));
 assertPathWithinTestFilesystemIsolation(outputDir);process.env.TMPDIR=outputDir;
 let result:Awaited<ReturnType<typeof createAgentSessionFromServices>>|undefined;
 try {
 const runtime=await ModelRuntime.create({credentials:createTestCredentialStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false});
 const model:Model<'openai-completions'>={id:'synthetic',provider:'codemode103-file-fixture',name:'Synthetic',api:'openai-completions',baseUrl:'https://synthetic.invalid',reasoning:false,input:['text'],contextWindow:128000,maxTokens:4096,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}};
 let code:string|undefined;
 const stream=()=>{const message:AssistantMessage={role:'assistant',api:model.api,provider:model.provider,model:model.id,content:code?[{type:'toolCall',id:'synthetic-codemode-image',name:'codemode',arguments:{code}}]:[{type:'text',text:'done'}],usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:code?'toolUse':'stop',timestamp:1};code=undefined;const s=createAssistantMessageEventStream();s.push({type:'done',reason:message.stopReason as 'toolUse'|'stop',message});return s;};
 const provider:Provider={id:model.provider,name:'Synthetic',getModels:()=>[model],auth:{apiKey:{name:'Synthetic',resolve:async()=>({auth:{},source:'fixture'})}},stream,streamSimple:stream};
 runtime.registerNativeProvider(provider);await runtime.refresh({allowNetwork:false});
 const settings=SettingsManager.inMemory({defaultTools:['codemode'],compaction:{enabled:false},retry:{enabled:false}});
 const loader=new DefaultResourceLoader({cwd:ws.workspace,agentDir:ws.base,settingsManager:settings,extensionFactories:[createCodemodeExtension({models:false})],noExtensions:false,noSkills:true,noPromptTemplates:true,noThemes:true});
 await loader.reload();
 const services={cwd:ws.workspace,agentDir:ws.base,modelRuntime:runtime,settingsManager:settings,resourceLoader:loader,diagnostics:[]};
 result=await createAgentSessionFromServices({services,sessionManager:SessionManager.inMemory(ws.workspace),model,customTools:[]});
  await result.session.bindExtensions({});result.session.setActiveToolsByName(['codemode']);
  const tool=result.session.getAllTools().find(t=>t.name==='codemode');expect(tool).toBeDefined();
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1xQAAAAASUVORK5CYII=';
  code=`// @options: {"max_output_tokens": 5}\ntext('Synthetic text '.repeat(100));image({type:'image',data:'${png}',mimeType:'image/png'});image({type:'image',data:'${png}',mimeType:'image/png'});`;
  await result.session.prompt('Synthetic no-network file test');
  const run=result.session.messages.filter(m=>m.role==='toolResult'&&m.toolCallId==='synthetic-codemode-image').at(-1);
  if(!run||run.role!=='toolResult')throw Error('Missing codemode result');
  expect(run.isError).not.toBe(true);
  const text=run.content.filter(c=>c.type==='text').map(c=>(c as any).text).join('\n');
  const images=[...text.matchAll(/Image saved to (\S+) \(/g)].map(m=>m[1]);expect(images).toHaveLength(2);expect(new Set(images).size).toBe(1);
  expect(run.content.filter(c=>c.type==='image')).toHaveLength(2);
  expect(readdirSync(outputDir).filter(name=>name.endsWith('.png'))).toHaveLength(1);
  const full=(run.details as any)?.fullOutputPath;expect(typeof full).toBe('string');
  for(const path of [...images,full]){assertPathWithinTestFilesystemIsolation(path);paths.add(path);expect(statSync(path).mode&0o777).toBe(0o600);expect(statSync(path).uid).toBe(process.getuid?.());}
  expect(readFileSync(images[0]).equals(Buffer.from(png,'base64'))).toBe(true);
  expect(readFileSync(full,'utf8')).toBe('Synthetic text '.repeat(100));
  expect(text).not.toContain('Synthetic text '.repeat(100));
 }finally{
  for(const path of paths)rmSync(path,{force:true});result?.session.dispose();
  if(originalTmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=originalTmp;
  rmSync(outputDir,{recursive:true,force:true});ws.cleanup();
 }
},10000);
