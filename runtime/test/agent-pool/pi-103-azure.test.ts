import { readFileSync as readFileSyncForTarget } from "node:fs";

const historicalTest = JSON.parse(readFileSyncForTarget(new URL("../../../node_modules/@earendil-works/pi-coding-agent/package.json", import.meta.url), "utf8")).version === "1.0.3" ? test : test.skip;

import { expect,test } from 'bun:test';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all';
import { createTestCredentialStore } from '../model-services-fixture.js';

historicalTest('released Azure Foundry completions resolve the configured endpoint and deployment without sending',async()=>{
 const model=getBuiltinModels('azure').find(m=>m.id==='deepseek-v4-pro');
 if(!model||model.type&&model.type!=='chat')throw Error('Azure chat model missing');
 expect(model.api).toBe('openai-completions');
 const runtime=await ModelRuntime.create({credentials:createTestCredentialStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false});
 let payload:unknown,sends=0;const abort=new AbortController();
 const stream=runtime.streamSimple(model,{messages:[{role:'user',content:'Synthetic deployment mapping',timestamp:1}]},{apiKey:'synthetic-only',env:{AZURE_OPENAI_BASE_URL:'https://synthetic.ai.azure.com',AZURE_OPENAI_DEPLOYMENT_NAME_MAP:'deepseek-v4-pro=synthetic-deployment'},signal:abort.signal,maxRetries:0,onPayload:value=>{payload=value;abort.abort();},fetch:Object.assign(async()=>{sends++;throw Error('Network forbidden')},{preconnect(){throw Error('Network forbidden')}})});
 const result=await stream.result();
 expect(sends).toBe(0);expect(result.stopReason).toBe('aborted');expect(payload).toMatchObject({model:'synthetic-deployment'});
 expect(model.id).toBe('deepseek-v4-pro');expect(model.provider).toBe('azure');
 expect(getBuiltinModels('azure-openai-responses')).toEqual([]);
});
