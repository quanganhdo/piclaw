import { readFileSync as readFileSyncForTarget } from "node:fs";

const historicalTest = JSON.parse(readFileSyncForTarget(new URL("../../../node_modules/@earendil-works/pi-coding-agent/package.json", import.meta.url), "utf8")).version === "1.0.3" ? test : test.skip;

import {expect,test} from 'bun:test';
import {streamSimple} from '@earendil-works/pi-ai/api/openai-completions';
import {normalizeContext,type Model,type SimpleStreamOptions} from '@earendil-works/pi-ai';
const model:Model<'openai-completions'>={id:'synthetic',name:'Synthetic',provider:'synthetic',api:'openai-completions',baseUrl:'https://synthetic.invalid/v1',reasoning:true,input:['text'],contextWindow:1000,maxTokens:10,cost:{input:1,output:1,cacheRead:0,cacheWrite:0},compat:{supportsReasoningEffort:true},samplingParams:{temperature:0.1,top_p:0.2},samplingParamsByThinkingLevel:{high:{temperature:0.7},low:{top_p:0.4}}};
async function payload(options:SimpleStreamOptions){let observed:any;let sends=0;const signal=new AbortController();
 const stream=streamSimple(model,normalizeContext({messages:[{role:'user',content:'synthetic',timestamp:1}]}),{...options,apiKey:'synthetic-fixture-only',signal:signal.signal,maxRetries:0,onPayload:value=>{observed=value;signal.abort();},fetch:Object.assign(async()=>{sends++;throw Error('Network forbidden');},{preconnect(){throw Error('Network forbidden');}})});
 const result=await stream.result();expect(result.stopReason).toBe('aborted');expect(sends).toBe(0);return observed;
}
historicalTest('Pi 1.0.3 thinking-level sampling overrides model defaults through the public API',async()=>{const high=await payload({reasoning:'high'});expect(high.temperature).toBe(0.7);expect(high.top_p).toBe(0.2);const low=await payload({reasoning:'low'});expect(low.temperature).toBe(0.1);expect(low.top_p).toBe(0.4);});
historicalTest('request sampling overrides the selected thinking-level defaults',async()=>{const request=await payload({reasoning:'high',samplingParams:{temperature:0.9,top_p:0.8}});expect(request.temperature).toBe(0.9);expect(request.top_p).toBe(0.8);});
