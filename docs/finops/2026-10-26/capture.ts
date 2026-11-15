import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const sources=[];
if(!process.argv.includes('--verify-only')) for(const [file,url] of [['openai-pricing.md','https://developers.openai.com/api/docs/pricing.md'],['terra-model.md','https://developers.openai.com/api/docs/models/gpt-6.1-terra.md'],['openrouter.json','https://openrouter.ai/api/v1/models'],['copilot.md','https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing.md']]){
 const r=await fetch(url,{signal:AbortSignal.timeout(45000)});assert(r.ok);const text=await r.text();await Bun.write(`${import.meta.dir}/${file}`,text);sources.push({file,url,retrievedAt:new Date().toISOString(),sha256:createHash('sha256').update(text).digest('hex')});
}
if(sources.length)await Bun.write(`${import.meta.dir}/sources.json`,JSON.stringify(sources,null,2)+'\n');
for(const source of await Bun.file(`${import.meta.dir}/sources.json`).json())assert.equal(createHash('sha256').update(await Bun.file(`${import.meta.dir}/${source.file}`).text()).digest('hex'),source.sha256);
const pricing=await Bun.file(`${import.meta.dir}/openai-pricing.md`).text();
assert(pricing.includes('| gpt-6.1-terra | $1.00 | $5.00 | $0.05 | $1.25 | $2.50 | $2.00 | $7.50 | $0.10 | $2.50 | $5.00 |'));
const model=await Bun.file(`${import.meta.dir}/terra-model.md`).text();assert(model.includes('more than 272K'));assert(model.includes('full request'));
const catalogue=await Bun.file(`${import.meta.dir}/openrouter.json`).json();const route=catalogue.data.find(x=>x.id==='openai/gpt-6.1-terra');assert(route);
for(const [key,value]of Object.entries({prompt:1,completion:5,input_cache_read:.05,input_cache_write:1.25}))assert(Math.abs(Number(route.pricing[key])*1e6-value)<1e-10);
const long=route.pricing.overrides.find(x=>x.min_prompt_tokens===272000);assert(long);
for(const [key,value]of Object.entries({prompt:2,completion:7.5,input_cache_read:.1,input_cache_write:2.5}))assert(Math.abs(Number(long[key])*1e6-value)<1e-10);
const record={model:'gpt-6.1-terra',currency:'USD',unit:'per million tokens',native:{standard:{input:1,output:5,cacheRead:.05,cacheWrite30m:1.25,cacheWrite12h:2.5},longContext:{inputTokensGreaterThan:272000,appliesTo:'whole request',input:2,output:7.5,cacheRead:.1,cacheWrite30m:2.5,cacheWrite12h:5}},openrouter:{route:route.id,standard:{input:1,output:5,cacheRead:.05,cacheWrite:1.25},longContext:{input:2,output:7.5,cacheRead:.1,cacheWrite:2.5},cacheWrite12h:null},copilot:{publishedInCapturedTable:/GPT-6\.1 Terra/i.test(await Bun.file(`${import.meta.dir}/copilot.md`).text()),rates:null}};
await Bun.write(`${import.meta.dir}/pricing.json`,JSON.stringify(record,null,2)+'\n');
console.log('PASS: native and OpenRouter standard/long rates verified; four source captures hashed.');
