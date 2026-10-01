#!/usr/bin/env bun
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const VERSION='0.99.1', GIT_HEAD='d86654abb8862e201933517d6f1fce9f88dd117f';
export const EXACT_CONTRACT_SHA256='f984b289503a6238eee03e5007083663da6e44d25085d4ce4c585a1f383f492e';
const positiveSource=`
import { createMcpExtension, createToolSearchExtension, createCodemodeExtension } from '@earendil-works/pi-coding-agent';
import type { McpExtensionOptions, McpTransportFactory, McpServerConfig } from '@earendil-works/pi-coding-agent';
import { McpClient, StdioTransport, StreamableHttpTransport } from '@earendil-works/pi-mcp';
import * as oauth from '@earendil-works/pi-mcp/oauth';
const factory: McpTransportFactory=()=>new StdioTransport({command:'synthetic'});
const config:McpServerConfig={type:'http',url:'https://example.invalid/mcp',enabled:false,exposure:'deferred',toolExposure:{read:'direct',write:'hidden'}};
const options:McpExtensionOptions={loadConfig:()=>({servers:[{name:'synthetic',config,source:'fixture'}],errors:[],autoEnableCodemode:false}),createTransport:factory,updateConfig:()=>{},startupWaitMs:0,openUrl:()=>{}};
void createMcpExtension(options);void createToolSearchExtension;void createCodemodeExtension;void StreamableHttpTransport;void oauth.startAuthorization;void oauth.refreshAuthorization;void oauth.MemoryOAuthStateStore;
const client=new McpClient({name:'probe',version:'0'});void client.listTools;void client.listResources;void client.listResourceTemplates;void client.readResource;void client.callTool;void client.request;void client.close;
`;
const negativeSource=`
import type { McpExtensionOptions, McpServerConfig } from '@earendil-works/pi-coding-agent';
import { McpClient } from '@earendil-works/pi-mcp';
const lazy:McpExtensionOptions={lazy:true};
const status:McpExtensionOptions={statusObserver:()=>{}};
const resources:McpExtensionOptions={resourceFilter:()=>true};
const headless:McpExtensionOptions={authStart:async()=>({})};
const apps:McpExtensionOptions={appRenderer:()=>{}};
const deadline:McpExtensionOptions={absoluteDeadlineMs:1};
const credentials:McpExtensionOptions={credentials:{}};
const socket:McpServerConfig={type:'socket',socket:'/tmp/mcp.sock'};
const client=new McpClient({name:'probe',version:'0'});client.listPrompts();client.getPrompt('name');
void lazy;void status;void resources;void headless;void apps;void deadline;void credentials;void socket;
`;
export const expectedNegatives=[
  ['lazy','TS2353'],['statusObserver','TS2353'],['resourceFilter','TS2353'],['authStart','TS2353'],['appRenderer','TS2353'],['absoluteDeadlineMs','TS2353'],
  ['McpOAuthCredentialStore','TS2740'],['socket','TS2322'],['listPrompts','TS2339'],['getPrompt','TS2339'],
] as const;
export type PublicApiReceipt={version:string;gitHead:string;positive:'pass';negative:Array<{symbol:string;code:string}>;lifecycle:LifecycleReceipt;matrixSha256:string};
export type LifecycleReceipt={runtimeLoads:number;connectionsConstructed:number;clientStarts:number;connectionCloses:number;toolRegistrations:number;classification:'generation_gate_prevents_resources_transient_unclosed_object'};
function json(path:string){return JSON.parse(readFileSync(path,'utf8')) as any;}
function digest(path:string){return new Bun.CryptoHasher('sha256').update(readFileSync(path)).digest('hex');}
export function validateContract(path:string){const bytes=readFileSync(path),hash=new Bun.CryptoHasher('sha256').update(bytes).digest('hex');if(hash!==EXACT_CONTRACT_SHA256)throw Error('MCP contract hash differs from exact 0.99.1 matrix');const value=JSON.parse(bytes.toString());
 if(value.version!==VERSION||value.gitHead!==GIT_HEAD||!Array.isArray(value.requirements)||value.requirements.length!==15)throw Error('MCP contract metadata/count mismatch');
 const ids=value.requirements.map((row:any)=>row.id);if(JSON.stringify(ids)!==JSON.stringify(Array.from({length:15},(_,i)=>`MCP-${String(i+1).padStart(2,'0')}`)))throw Error('MCP contract IDs/order mismatch');
 const statuses=new Set(['pass','implementable','pending','blocked','fail']);for(const row of value.requirements)if(!row.owner||!statuses.has(row.status)||typeof row.reason!=='string'||row.reason.length<30)throw Error(`invalid MCP contract row ${row.id}`);
 if(value.requirements.filter((row:any)=>row.status==='pass').map((row:any)=>row.id).join(',')!=='MCP-01')throw Error('only MCP-01 may pass at public-contract admission');
 const owners=Object.fromEntries(value.requirements.map((row:any)=>[row.id,row.owner]));const expectedOwners={'MCP-02':'1446','MCP-03':'1446,1450','MCP-06':'1447,1449','MCP-15':'1454,1455,1456'};for(const [id,owner] of Object.entries(expectedOwners))if(owners[id]!==owner)throw Error(`MCP contract owner drift for ${id}`);
 if(!Array.isArray(value.forbiddenWorkarounds)||value.forbiddenWorkarounds.length<6)throw Error('forbidden workaround inventory incomplete');return{value,hash};}
function args(argv:string[]){const out:any={};for(let i=0;i<argv.length;i++){const key=argv[i];if(!key?.startsWith('--'))throw Error(`unknown argument ${key}`);out[key.slice(2)]=argv[++i];}for(const key of ['consumer-root','tsc','contract'])if(!out[key])throw Error(`--${key} is required`);return out;}
function compile(consumer:string,tsc:string){const scratch=mkdtempSync(join(tmpdir(),'earendil-mcp-api-'));try{
  symlinkSync(join(consumer,'node_modules'),join(scratch,'node_modules'),'dir');writeFileSync(join(scratch,'positive.ts'),positiveSource);writeFileSync(join(scratch,'negative.ts'),negativeSource);
  const config=(file:string)=>{const p=join(scratch,`${file}.json`);writeFileSync(p,JSON.stringify({compilerOptions:{target:'ES2024',module:'NodeNext',moduleResolution:'NodeNext',strict:true,noEmit:true,skipLibCheck:true},files:[`${file}.ts`]}));return p;};
  const positive=Bun.spawnSync([tsc,'-p',config('positive'),'--pretty','false'],{cwd:scratch,stdout:'pipe',stderr:'pipe'});if(positive.exitCode!==0)throw Error(`positive public API compile failed: ${positive.stdout}${positive.stderr}`);
  const negative=Bun.spawnSync([tsc,'-p',config('negative'),'--pretty','false'],{cwd:scratch,stdout:'pipe',stderr:'pipe'}),text=negative.stdout.toString()+negative.stderr.toString();if(negative.exitCode===0)throw Error('negative public API compile unexpectedly passed');
  for(const [symbol,code] of expectedNegatives)if(!text.includes(code)||!text.includes(symbol))throw Error(`missing ${code} negative for ${symbol}: ${text}`);
  const diagnostics=[...text.matchAll(/error (TS\d+): ([^\n]+)/g)].map(match=>({code:match[1]!,message:match[2]!}));if(diagnostics.length!==expectedNegatives.length)throw Error(`expected ${expectedNegatives.length} negative diagnostics, got ${diagnostics.length}: ${text}`);
  const matched=expectedNegatives.map(([symbol,code])=>{const rows=diagnostics.filter(row=>row.code===code&&row.message.includes(symbol));if(rows.length!==1)throw Error(`expected one ${code} diagnostic for ${symbol}, found ${rows.length}: ${text}`);return{symbol,code};});
  return matched;
 }finally{rmSync(scratch,{recursive:true,force:true});}}
export async function lifecycleProbe(consumerRoot:string):Promise<LifecycleReceipt>{const scratch=mkdtempSync(join(tmpdir(),'earendil-mcp-life-'));try{
 const script=join(scratch,'probe.ts'),lazy=join(consumerRoot,'node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/runtime.lazy.js');
 writeFileSync(script,`import {mock} from 'bun:test';import {pathToFileURL} from 'node:url';let loads=0,constructed=0,starts=0,closes=0,tools=0;let release;const second=new Promise(r=>release=r);let enteredDone;const entered=new Promise(r=>enteredDone=r);class Store{}class Log{}class Conn{constructor(){constructed++}getClient(){starts++;return Promise.resolve({})}close(){closes++;return Promise.resolve()}}const runtime={McpServerConnection:Conn,McpOAuthCredentialStore:Store,McpServerLog:Log,createDefaultTransport(){throw Error('transport must not start')},signInMcpServer(){},McpSignInCancelledError:class extends Error{}};mock.module(pathToFileURL(${JSON.stringify(lazy)}).href,()=>({loadMcpRuntime:async()=>{loads++;if(loads===2){enteredDone();await second}return runtime}}));const {createMcpExtension}=await import(${JSON.stringify(pathToFileURL(join(consumerRoot,'node_modules/@earendil-works/pi-coding-agent/dist/index.js')).href)});const handlers={};const base={on:(e,h)=>handlers[e]=h,getMcpServers:()=>[],registerTool:()=>tools++,getActiveTools:()=>[],setActiveTools:()=>{},registerCommand:()=>{}};const pi=new Proxy(base,{get:(o,k)=>k in o?o[k]:(()=>{})});createMcpExtension({loadConfig:()=>({servers:[{name:'slow',config:{command:'synthetic'},source:'fixture'}],errors:[]}),createTransport:()=>{throw Error('transport must not start')},startupWaitMs:0})(pi);const ctx={cwd:process.cwd(),ui:{notify:()=>{},isTTY:true}};handlers.session_start({},ctx);await entered;await handlers.session_shutdown({},ctx);release();await new Promise(r=>setTimeout(r,20));console.log(JSON.stringify({runtimeLoads:loads,connectionsConstructed:constructed,clientStarts:starts,connectionCloses:closes,toolRegistrations:tools,classification:'generation_gate_prevents_resources_transient_unclosed_object'}));`);
 const result=Bun.spawnSync([process.execPath,script],{cwd:consumerRoot,stdout:'pipe',stderr:'pipe',timeout:30000});if(result.exitCode!==0)throw Error(`lifecycle probe failed: ${result.stderr}${result.stdout}`);const receipt=JSON.parse(result.stdout.toString().trim().split('\n').at(-1)!);if(JSON.stringify(receipt)!==JSON.stringify({runtimeLoads:2,connectionsConstructed:1,clientStarts:0,connectionCloses:0,toolRegistrations:0,classification:'generation_gate_prevents_resources_transient_unclosed_object'}))throw Error(`unexpected lifecycle receipt: ${JSON.stringify(receipt)}`);return receipt;
 }finally{rmSync(scratch,{recursive:true,force:true});}}
export async function run(options:{consumerRoot:string;tsc:string;contract:string}):Promise<PublicApiReceipt>{const consumer=realpathSync(options.consumerRoot),manifest=json(join(consumer,'node_modules/@earendil-works/pi-coding-agent/package.json')),{hash}=validateContract(options.contract);if(manifest.version!==VERSION)throw Error('exact package/contract mismatch');
 const negative=compile(consumer,realpathSync(options.tsc)),lifecycle=await lifecycleProbe(consumer);return{version:VERSION,gitHead:GIT_HEAD,positive:'pass',negative,lifecycle,matrixSha256:hash};}
if(import.meta.main){run((()=>{const a=args(process.argv.slice(2));return{consumerRoot:a['consumer-root'],tsc:a.tsc,contract:a.contract}})()).then(r=>console.log(JSON.stringify(r,null,2)),e=>{console.error(`[earendil-mcp-public-api] ${e instanceof Error?e.message:String(e)}`);process.exitCode=1});}
