import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{createHash}from'node:crypto';
const dir=import.meta.dir,j=(p:string)=>JSON.parse(readFileSync(dir+'/'+p,'utf8'));
const d=j('pricing-catalogue.json'),flat=j('../../../runtime/skills/operator/token-chart/pricing-2026-09-22.json');
assert.equal(new Set(d.rates.map(r=>r.provider+'/'+r.id)).size,d.rates.length);assert(d.rates.length>=600);assert.equal(flat.length,d.rates.length);
for(const r of d.rates){for(const k of ['input','output','cr','cw'])assert(r[k]===null||Number.isFinite(r[k])&&r[k]>=0);assert(r.source.startsWith('https://'));assert(readFileSync(dir+'/'+r.sourceFile).length);const f=flat.find(f=>f.provider===r.provider&&f.model===r.id);assert.equal(f.inputPerMTok,r.input);assert.equal(f.cacheReadPerMTok,r.cr??r.input);if(r.cr===null)assert(f.notes.includes('ordinary input fallback'));if(r.long)assert(f.notes.includes('Base tier only'));}
const get=(p:string,id:string)=>{const r=d.rates.find(r=>r.provider===p&&r.id===id);assert(r,`${p}/${id}`);return r;};
assert.deepEqual([get('openai','gpt-6-sol').input,get('openai','gpt-6-sol').output],[2,10]);assert.equal(get('openai','gpt-6-sol').long.output,15);assert.equal(get('openai','gpt-6-luna').cw,.125);
assert.equal(get('anthropic','claude-opus-5.5').cw1h,8);assert.equal(get('anthropic','claude-opus-5.5').apiModelId,'claude-opus-5-5');assert.equal(get('anthropic','claude-opus-5.5').cr,.2);assert.equal(get('anthropic','claude-sonnet-5').input,2);
assert.equal(get('openai','gpt-5.6-luna').threshold,272000);assert.equal(get('github-copilot','gpt-5.6-luna').threshold,200000);
assert.equal(get('xai','grok-4.5').thresholdOperator,'>=');assert.equal(get('github-copilot','grok-4.5').thresholdOperator,'>');assert.equal(get('xai','grok-4.5').cr,.3);assert.equal(get('github-copilot','grok-4.5').cr,.5);
assert.equal(get('google','gemini-3.8-flash').promotion.through,'2026-12-31');assert.equal(get('deepseek','deepseek-flash').peak.output,1.2);assert.equal(get('moonshot','kimi-k3').cw,3);assert.equal(get('moonshot','kimi-k3').cw1h,6);
const router=j('sources/openrouter.json').data;
const priced=router.filter(m=>m.pricing&&Number(m.pricing.prompt)>=0&&Number(m.pricing.completion)>=0);
assert.equal(d.rates.filter(r=>r.provider==='openrouter').length,priced.length);
assert.equal(router.length-priced.length,5); // Variable automatic-routing sentinel tariffs remain unpriced.
assert(!d.rates.some(r=>r.provider==='openrouter'&&r.id==='openrouter/auto'));
assert.equal(d.rates.filter(r=>r.provider==='groq').length,4);assert(!d.rates.some(r=>r.provider==='cerebras'));
assert.equal(d.variants.find(r=>r.provider==='anthropic'&&r.id==='claude-opus-5.5'&&r.processing==='batch').cr,.1);
for(const e of j('sources/evidence-manifest.json'))assert.equal(createHash('sha256').update(readFileSync(dir+'/sources/'+e.file)).digest('hex'),e.sha256,e.file);
console.log(JSON.stringify({status:'PASS',routes:d.rates.length,variants:d.variants.length,providers:new Set(d.rates.map(r=>r.provider)).size,checks:['source digests','unique routes','null cache fallback','upstream IDs','long context and route boundaries','1h write tariffs','promotion dates','peak schedules','OpenRouter coverage','mode separation']}));
