import {expect,test} from 'bun:test';
import type {Context} from '@earendil-works/pi-ai';
import {validateChildRequest} from '../../src/addons/child-request-validation.js';
const context=():Context=>({systemPrompt:'synthetic',messages:[{role:'user',content:[{type:'text',text:'synthetic'}],timestamp:1}]});
test('host validates cloned bounded context and applies trusted output default',()=>{const raw=context();const result=validateChildRequest(raw,{},10);expect(result.options.maxTokens).toBe(10);expect(result.context).toEqual(raw);expect(result.context).not.toBe(raw);});
test('unknown authority options, tools, images and unsupported reasoning fail before provider',()=>{
 for(const raw of [{...context(),workId:'spoof'},{...context(),tools:[{name:'mcp',description:'spoof',parameters:{}}]},{messages:[{role:'user',content:[{type:'image',data:'abc',mimeType:'image/png'}],timestamp:1}]}])expect(()=>validateChildRequest(raw as Context,{},10)).toThrow('invalid_request');
 for(const options of [{apiKey:'spoof'},{baseUrl:'spoof'},{maxTokens:11},{reasoning:'off'},{temperature:Infinity}])expect(()=>validateChildRequest(context(),options as any,10)).toThrow('invalid_request');
});
test('historic usage is structurally checked but cannot inject accounting authority',()=>{
 const message={role:'assistant',content:[{type:'text',text:'synthetic'}],api:'openai-completions',provider:'history',model:'history',stopReason:'stop',timestamp:1,usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:1,output:1,cacheRead:0,cacheWrite:0,total:2}}};
 expect(validateChildRequest({messages:[message]} as Context,{},10).context.messages).toHaveLength(1);
 for(const usage of [{...message.usage,workId:'spoof'},{...message.usage,input:-1},{...message.usage,cost:{...message.usage.cost,total:'spoof'}}])expect(()=>validateChildRequest({messages:[{...message,usage}]} as Context,{},10)).toThrow('invalid_request');
 expect(()=>validateChildRequest({messages:[{...message,content:[{type:'text',text:'synthetic',arguments:{key:'spoof'}}]}]} as Context,{},10)).toThrow('invalid_request');
});
test('non JSON, excessive depth, prototype keys and request byte cap reject',()=>{
 const raw=context();(raw as any).constructor='spoof';expect(()=>validateChildRequest(raw,{},10)).toThrow('invalid_request');
 let deep:any={};for(let n=0;n<34;n++)deep={x:deep};expect(()=>validateChildRequest({...context(),messages:[deep]} as Context,{},10)).toThrow('invalid_request');
 expect(()=>validateChildRequest({messages:[{role:'user',content:'x'.repeat(4*1024*1024),timestamp:1}]},{},10)).toThrow('invalid_request');
 expect(()=>validateChildRequest({...context(),systemPrompt:()=> 'bad'} as any,{},10)).toThrow('invalid_request');
});
