import {expect,test} from 'bun:test';
import type {AssistantMessage} from '@earendil-works/pi-ai';
import {projectChildEvent} from '../../src/addons/child-request-output.js';
const message:AssistantMessage={role:'assistant',content:[{type:'text',text:'output'}],api:'openai-completions',provider:'fixture',model:'fixture',stopReason:'stop',timestamp:1,usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:1e-6,output:1e-6,cacheRead:0,cacheWrite:0,total:2e-6}}};
test('success and partial projection remove diagnostic extras at every public level',()=>{
 const raw=structuredClone(message) as any;raw.errorMessage='PRIVATE';raw.diagnostic='PRIVATE';raw.usage.secret='PRIVATE';raw.usage.cost.secret='PRIVATE';raw.content[0].secret='PRIVATE';
 for(const event of [{type:'start',partial:raw},{type:'done',reason:'stop',message:raw}] as any[]){const output=projectChildEvent(event);expect(JSON.stringify(output)).not.toContain('PRIVATE');expect(JSON.stringify(output)).toContain('output');}
});
test('tool-call completion projection removes diagnostics outside validated tool arguments',()=>{
 const tool={type:'toolCall' as const,id:'tool',name:'fixture',arguments:{value:'synthetic'},diagnostic:'PRIVATE'};
 const output=projectChildEvent({type:'toolcall_end',contentIndex:0,toolCall:tool,partial:{...message,content:[tool]}});expect(JSON.stringify(output)).not.toContain('PRIVATE');expect(JSON.stringify(output)).toContain('synthetic');
});
test('error projection strips content and exposes finite status only',()=>{
 const raw={...message,stopReason:'error' as const,errorMessage:'PRIVATE',content:[{type:'text' as const,text:'PRIVATE'}]};const output=projectChildEvent({type:'error',reason:'error',error:raw});expect(JSON.stringify(output)).not.toContain('PRIVATE');expect(output).toMatchObject({error:{api:'proxy',content:[],errorMessage:'Model request failed.'}});
});
