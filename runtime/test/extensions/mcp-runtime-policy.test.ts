import {expect,test} from 'bun:test';
import {createRequire} from 'node:module';
import {mcpRuntimeRegistrationPolicy} from '../../src/extensions/mcp-runtime-policy.js';
const require=createRequire(import.meta.url);
const {MCP_RUNTIME_REGISTER_EVENT,MCP_RUNTIME_REGISTER_VERSION}=require('pi-mcp-adapter') as {MCP_RUNTIME_REGISTER_EVENT:string;MCP_RUNTIME_REGISTER_VERSION:number};

test('immutable MCP policy rejects extension-side runtime servers before the adapter sees them',()=>{
 const handlers=new Map<string,(request:any)=>void>();
 mcpRuntimeRegistrationPolicy({events:{on:(name:string,handler:(request:any)=>void)=>{handlers.set(name,handler);}}} as any);
 const handler=handlers.get(MCP_RUNTIME_REGISTER_EVENT)!;expect(handler).toBeFunction();
 const request:any={version:MCP_RUNTIME_REGISTER_VERSION,name:'bypass',definition:{url:'https://example.test/mcp'}};
 handler(request);expect(request.result.ok).toBe(false);expect(request.result.error.message).toContain('immutable policy snapshot');
 const prior={ok:false,error:new Error('prior')};const already:any={...request,result:prior};handler(already);expect(already.result).toBe(prior);
 const wrong:any={version:999,name:'bad',definition:{command:'node'}};handler(wrong);expect(wrong.result.error.message).toContain('Unsupported');
});
