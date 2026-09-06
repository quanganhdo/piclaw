import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const dir=import.meta.dir;const read=(n:string)=>JSON.parse(readFileSync(`${dir}/${n}.json`,'utf8'));const w=read('workload'),c=read('comparison'),p=read('pricing-catalogue');
const g=(key:string)=>c.results.find((r:any)=>r.key===key);const near=(a:number,b:number)=>assert(Math.abs(a-b)<0.00001,`${a} != ${b}`);const f=(t:any,i:number,o:number,cr:number,cw:number)=>(t.input*i+t.output*o+t.cr*cr+t.cw*cw)/1e6;
assert.equal(w.sevenDays.accounted,w.sevenDays.total);assert.equal(w.sevenDays.input+w.sevenDays.output+w.sevenDays.cr+w.sevenDays.cw,w.sevenDays.total);
near(g('anthropic/claude-fable-5.1').sevenDay.usd,f(w.sevenDays,10,50,.25,12.5));near(g('anthropic/claude-fable-5').sevenDay.usd-g('anthropic/claude-fable-5.1').sevenDay.usd,w.sevenDays.cr*.75/1e6);
near(g('openai-codex/gpt-6-astra').sevenDay.usd,f(w.byPromptBand.short,10,50,1,12.5)+f(w.byPromptBand.long,20,75,2,25));
near(g('openrouter/openai/gpt-6-astra').sevenDay.usd,g('openai-codex/gpt-6-astra').sevenDay.usd);
near(g('openai-codex/gpt-6-astra').sevenDay.usd,2.5*g('openai-codex/gpt-5.6-sol').sevenDay.usd);
near(g('openrouter/openai/gpt-5.6-sol').sevenDay.usd*2,g('openai/gpt-5.6-sol').sevenDay.usd);
for(const r of p.rates)for(const k of ['input','output','cr','cw'])assert(r[k]===null||(Number.isFinite(r[k])&&r[k]>=0),`${r.provider}/${r.id} ${k}`);
for(const [name,keys] of Object.entries(c.groups) as any){assert.equal(keys.length,3,name);for(const k of keys)assert(g(k));}
assert.equal(g('cerebras/zai-glm-4.7').sevenDay,null);assert.equal(g('azure-foundry/deepseek-v4-pro').sevenDay,null);
for(const r of c.results){if(r.sevenDay)assert(r.cold.usd>=r.sevenDay.usd-1e-6);}
const html=readFileSync(`${dir}/report.html`,'utf8');assert(html.includes('Claude Fable 5.1'));assert(html.includes('gpt-6-astra'));assert(!/\bNaN\b|\bundefined\b/.test(html));assert(html.includes('viewport'));assert(html.includes('prefers-color-scheme:dark'));
console.log(`PASS: ${p.rates.length} rate rows, ${Object.keys(c.groups).length} three-model groups, category reconciliation, independent aggregate replay, long-context and route deltas, unknown-price handling, report structure.`);
