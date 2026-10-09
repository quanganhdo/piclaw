import {expect,test} from 'bun:test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {withTempWorkspaceEnv} from '../../helpers.js';
import {handleMcpSettings} from '../../../src/channels/web/handlers/mcp-settings.js';
import {handleAgentRoutes} from '../../../src/channels/web/http/dispatch-agent.js';
import {getDataRateLimitRule} from '../../../src/channels/web/http/rate-limit-rules.js';
const principal={kind:'local',role:'admin',mode:'single-user',userId:'default',authentication:{method:'local',sessionId:null,expiresAt:null}};
function request(path='',body?:unknown){return new Request(`http://fixture/agent/settings/mcp/servers${path}`,{...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});}
async function fixture(run:()=>Promise<void>){await withTempWorkspaceEnv('server-http-',{},async ws=>{mkdirSync(join(ws.workspace,'.piclaw'),{recursive:true});writeFileSync(join(ws.workspace,'.piclaw','config.json'),JSON.stringify({domains:{access:{mode:'single-user'}}}),{mode:0o600});await run();});}
test('server routes register GET/preview/Apply with the shared throttle and owner checks',async()=>fixture(async()=>{
 const calls:string[]=[],channel={authGateway:{getPrincipal:()=>principal},agentPool:{inspectMcpServers(edit?:unknown){calls.push(edit?'preview':'get');return{ok:true,servers:[]};},async applyMcpServers(input:unknown,check:()=>void){check();calls.push('apply');return{ok:true};}}} as any;
 for(const req of [request(),request('/preview',{name:'demo',action:'update',patch:{disabled:true}}),request('/apply',{revision:'synthetic',acknowledgeInterruptions:true})]){const url=new URL(req.url);expect(getDataRateLimitRule(req.method,url.pathname)?.bucket).toBe('data/mcp_settings');expect((await handleAgentRoutes(channel,req,url.pathname,url))?.status).toBe(200);}expect(calls).toEqual(['get','preview','apply']);
}));
test('unauthorised server reads/writes reject before body/config access and use no-store',async()=>fixture(async()=>{
 for(const identity of [null,{...principal,role:'member'},{...principal,mode:'family-shared'}]){const channel={authGateway:{getPrincipal:()=>identity},agentPool:{inspectMcpServers(){throw Error('PRIVATE_SENTINEL');}}} as any;const req=request('/preview',{name:'demo',action:'update',patch:{disabled:true}});Object.defineProperty(req,'body',{get(){throw Error('BODY_SENTINEL');}});const response=await handleMcpSettings(channel,req,new URL(req.url));expect(response.status).toBe(403);expect(response.headers.get('cache-control')).toBe('private, no-store');expect(await response.text()).not.toContain('SENTINEL');}
}));
test('server bodies are byte-bounded, strict edits reject literal secrets, and Apply cannot accept a config',async()=>fixture(async()=>{
 const channel={authGateway:{getPrincipal:()=>principal},agentPool:{inspectMcpServers(){throw Error('must not enter');}}} as any;
 for(const [req,status] of [[request('/preview',{name:'demo',action:'update',patch:{bearerToken:'PRIVATE_SENTINEL'}}),422],[request('/apply',{revision:'test',acknowledgeInterruptions:true,config:{PRIVATE_SENTINEL:true}}),400],[request('/preview',{name:'x'.repeat(70000)}),413]] as const){const response=await handleMcpSettings(channel,req,new URL(req.url));expect(response.status).toBe(status);expect(await response.text()).not.toContain('PRIVATE_SENTINEL');}
}));
test('original owner revocation after streamed body blocks preview disclosure',async()=>fixture(async()=>{
 let owner:any=principal;const bytes=new TextEncoder().encode(JSON.stringify({name:'demo',action:'update',patch:{disabled:true}}));const stream=new ReadableStream<Uint8Array>({pull(controller){owner=null;controller.enqueue(bytes);controller.close();}});const req=new Request('http://fixture/agent/settings/mcp/servers/preview',{method:'POST',body:stream});const channel={authGateway:{getPrincipal:()=>owner},agentPool:{inspectMcpServers(){throw Error('PRIVATE_SENTINEL');}}} as any;expect((await handleMcpSettings(channel,req,new URL(req.url))).status).toBe(403);
}));
