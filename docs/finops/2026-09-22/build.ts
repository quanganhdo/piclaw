import { readFileSync,writeFileSync,readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const dir=import.meta.dir,repo=fileURLToPath(new URL('../../../',import.meta.url));
const text=(name:string)=>readFileSync(`${dir}/sources/${name}.md`,'utf8');
const rows=(s:string)=>s.split('\n').filter(l=>l.trim().startsWith('|')).map(l=>l.split('|').slice(1,-1).map(c=>c.trim()));
const rate=(s:string):number|null=>{if(/^Free$/i.test(s))return 0;const m=s.replaceAll('\\','').match(/\$([\d.]+)/);return m?Number(m[1]):null;};
const now='2026-09-22',rates:any[]=[],variants:any[]=[];
const manifest=JSON.parse(readFileSync(`${dir}/sources/fetch-manifest.json`,'utf8'));
const source=(key:string)=>manifest.find((s:any)=>s.key===key)?.url??key;
const base=(provider:string,id:string,name:string,input:number|null,output:number|null,cr:number|null,cw:number|null,key:string,extra:any={})=>({provider,id,name,input,output,cr,cw,source:source(key),sourceFile:`sources/${key}.md`,retrievedDate:now,evidence:'public-first-party',...extra});
const add=(r:any)=>{assert(r.id&&r.provider);for(const k of ['input','output','cr','cw'])assert(r[k]===null||Number.isFinite(r[k])&&r[k]>=0);assert(!rates.some(x=>x.provider===r.provider&&x.id===r.id),`Duplicate ${r.provider}/${r.id}`);rates.push(r);};
// OpenAI processing tiers remain separate, including long-context and real cache-write prices.
const openai=text('openai-pricing');
for(const mode of ['Standard','Batch','Flex','Fast']){
 const section=openai.split(`### ${mode} pricing data`)[1]?.split('\n### ')[0];assert(section);
 for(const r of rows(section).filter(r=>r.length===9&&/^(gpt-|o\d|davinci|babbage)/.test(r[0]))){
  const id=r[0].replace(/\s*\(.*/,'');const short=base('openai',id,id,rate(r[1]),rate(r[4]),rate(r[2]),rate(r[3]),'openai-pricing',{processing:mode.toLowerCase(),threshold:rate(r[5])===null?null:272000,thresholdOperator:'>',long:rate(r[5])===null?null:{input:rate(r[5]),cr:rate(r[6]),cw:rate(r[7]),output:rate(r[8])},notes:id==='gpt-5.6-sol'?'Promotional rate available at least through 2026-11-21.':'Regional processing adds 10% where eligible; see source restrictions.'});
  variants.push(short);if(mode==='Standard')add(short);
  // Fast is a selected service tier, not a newly asserted provider model ID.
 }
}
// Anthropic native model rows, full cache lifetimes and availability qualifiers.
for(const r of rows(text('anthropic-pricing').split('## Model pricing')[1].split('## Cloud platform pricing')[0]).filter(r=>r.length===6&&r[0].startsWith('Claude'))){
 const name=r[0].split(' (')[0],id=name.toLowerCase().replaceAll(' ','-');
 add(base('anthropic',id,name,rate(r[1]),rate(r[5]),rate(r[4]),rate(r[2]),'anthropic-pricing',{apiModelId:id.replace(/\.(\d)/g,'-$1'),cw1h:rate(r[3]),threshold:null,long:null,availability:/retired/.test(r[0])?'retired-native':/limited availability/.test(r[0])?'limited':'listed',notes:'Claude 4.6+ has standard pricing across 1M context. Tokenizer differences affect workload cost; newer models may emit ~30% more tokens. Sonnet 5 $2/$10 is permanent, not a pending September increase.'}));
}
for(const r of rates.filter(r=>r.provider==='anthropic')){
 variants.push({...r,processing:'standard'});
 variants.push({...r,processing:'batch',input:r.input*.5,output:r.output*.5,cr:r.cr*.5,cw:r.cw*.5,cw1h:r.cw1h*.5,notes:'50% Batch discount; cache multipliers stack per official pricing.'});
 if(['claude-opus-5.5','claude-opus-5','claude-opus-4.8'].includes(r.id))variants.push({...r,processing:'fast',input:r.input*2,output:r.output*2,cr:r.cr*2,cw:r.cw*2,cw1h:r.cw1h*2,notes:'Native Fast preview; cannot combine with Batch. Full-context rates.'});
}
// Copilot: do not borrow native model rates or native context thresholds.
for(const r of rows(text('copilot-pricing')).filter(r=>r[0]&&/^(GPT|Claude|Gemini|Grok|MAI|Kimi)/.test(r[0])&&r.some(c=>c.includes('$')))){
 const clean=r[0].replace(/\[\^.*?\]/g,'').replace(/\s*\(.*$/,'').trim();let id=clean.toLowerCase().replaceAll(' ','-').replace('gpt-5-mini','gpt-5-mini').replace('gpt-5.3-codex','gpt-5.3-codex');
 if(r[0].includes('fast mode'))id+='-fast';
 let input:number|null,output:number|null,cr:number|null,cw:number|null=null,threshold:number|null=null;
 if(r.length===9){[input,cr,cw,output]=r.slice(5).map(rate);threshold=/272K/.test(r[4])?272000:/200K/.test(r[4])?200000:null;}
 else if(r.length===8){[input,cr,output]=r.slice(5).map(rate);threshold=/200K/.test(r[4])?200000:null;}
 else if(r.length===7)[input,cr,cw,output]=r.slice(3).map(rate);
 else if(r.length===6)[input,cr,output]=r.slice(3).map(rate);else continue;
 const long=r[3]==='Long context';const value=base('github-copilot',id,clean,input!,output!,cr!,cw,'copilot-pricing',{evidence:'public-route',threshold,thresholdOperator:'>',billing:'AI credit valuation: 1 credit = $0.01. Included allowances, legacy annual billing, quotas and eligibility are separate.',notes:/Gemini 3.[678] Flash/.test(clean)?'Promotional prices through 2026-12-31.':id==='gpt-5.6-luna'?'Copilot threshold is 200K; native model page says 272K. Preserve route-specific threshold.':''});
 if(long){const existing=rates.find(x=>x.provider===value.provider&&x.id===id);assert(existing,`Long tier without base ${id}`);existing.long={input,output,cr,cw};}
 else add(value);
}
// Public OpenRouter API is authoritative for that route only; keep all overrides verbatim.
const router=JSON.parse(readFileSync(`${dir}/sources/openrouter.json`,'utf8')).data;
const million=(v:any)=>v===undefined||v===null||v===''?null:Number((Number(v)*1e6).toPrecision(12));
for(const m of router){const p=m.pricing; if(!p)continue;const input=million(p.prompt),output=million(p.completion);if(input===null||output===null||input<0||output<0)continue;
 add(base('openrouter',m.id,m.name,input,output,million(p.input_cache_read),million(p.input_cache_write),'openrouter',{evidence:'public-route',sourceFile:'sources/openrouter.json',cw1h:million(p.input_cache_write_1h),pricingOverrides:m.pricing_overrides??null,additionalMeters:Object.fromEntries(Object.entries(p).filter(([k])=>!['prompt','completion','input_cache_read','input_cache_write','input_cache_write_1h'].includes(k))),contextWindow:m.context_length,inputModalities:m.architecture?.input_modalities??null,outputModalities:m.architecture?.output_modalities??null,notes:'Token-only route quote; a zero token meter does not waive separately priced image/request/tool charges; no substitution into native/provider billing. Non-token meters and funding/tax costs are separate.'}));
}
// Z.ai token meters: free cache storage is a distinct unit, not a zero cache-write tariff.
for(const r of rows(text('zai-pricing')).filter(r=>r.length===5&&/^GLM-/.test(r[0]))){add(base('zai',r[0].toLowerCase(),r[0],rate(r[1]),rate(r[4]),rate(r[2]),null,'zai-pricing',{cacheStorage:r[3],notes:'PAYG API valuation; a coding subscription is not this tariff. Free cache storage does not establish a free token-write meter.'}));}
// DeepSeek changes model aliases and bills peak/off-peak independently.
const ds=text('deepseek-pricing');assert(ds.includes('| OFF-PEAK | $0.003 | $0.022 |')&&ds.includes('| PEAK | $0.006 | $0.044 |')&&ds.includes('| OFF-PEAK | $0.15 | $0.66 |')&&ds.includes('| PEAK | $0.3 | $1.32 |')&&ds.includes('| OFF-PEAK | $0.6 | $1.98 |')&&ds.includes('| PEAK | $1.2 | $3.96 |'));
for(const id of ['deepseek-flash','deepseek-v4-flash','deepseek-v4-flash-vision-exp'])add(base('deepseek',id,'DeepSeek V4.1 Flash',.15,.6,.003,null,'deepseek-pricing',{resolvedModel:'DeepSeek-V4.1-Flash',peak:{input:.3,output:1.2,cr:.006,cw:null},peakSchedule:'Monday–Friday 01:00–04:00 and 06:00–10:00 UTC, excluding Chinese public holidays',notes:'Off-peak base quote; select peak rates by request time. Legacy Flash IDs now use V4.1 Flash; cache write unpublished.'}));
assert(ds.includes('DeepSeek-V4-Pro-0813'));add(base('deepseek','deepseek-v4-pro','DeepSeek V4 Pro 0813',.66,1.98,.022,null,'deepseek-pricing',{resolvedModel:'DeepSeek-V4-Pro-0813',peak:{input:1.32,output:3.96,cr:.044,cw:null},peakSchedule:'Monday–Friday 01:00–04:00 and 06:00–10:00 UTC, excluding Chinese public holidays'}));
// xAI native threshold is inclusive, unlike Copilot. Never round the boundary away.
for(const r of rows(text('xai-details')).filter(r=>r.length===5&&r[0].startsWith('grok-'))){const id=r[0].split(' ')[0],long=r[0].includes('≥');const obj=base('xai',id,id,rate(r[2]),rate(r[4]),rate(r[3]),null,'xai-details',{threshold:200000,thresholdOperator:'>=',notes:'Whole-request long-context billing at >=200K. Priority 2x. Batch discounts only for named models; tool charges separate.'});if(long){const prev=rates.find(x=>x.provider==='xai'&&x.id===id);assert(prev);prev.long={input:obj.input,output:obj.output,cr:obj.cr,cw:null};}else add(obj);}
// Fireworks exact per-model tables. Mode/geography rows are retained but not invented as model IDs.
for(const r of rows(text('fireworks-serverless')).filter(r=>r.length===3&&r[0].includes('app.fireworks.ai/models/'))){const name=r[0].match(/^\[([^\]]+)/)![1],id=r[0].match(/models\/fireworks\/([^)]*)/)![1];const parse=(s:string)=>[...s.replaceAll('\\','').matchAll(/\$([\d.]+)/g)].map(m=>Number(m[1]));const a=parse(r[1]);assert.equal(a.length,3);const obj=base('fireworks',`accounts/fireworks/models/${id}`,name,a[0],a[2],a[1],null,'fireworks-serverless',{processing:name.includes('Fast')?'fast':'standard',geography:name.includes('(US)')||name.includes('Fast US')?'us':'global',notes:'Mode/geography preserved separately; do not infer routers from names. Batch input/output 50%; no separate published cache-write meter.'});variants.push(obj);if(obj.processing==='standard'&&obj.geography==='global')add(obj);const priority=parse(r[2]);if(priority.length===3)variants.push({...obj,processing:'priority',input:priority[0],cr:priority[1],output:priority[2]});}
// Official Kimi MDX table (dollar tokens inside JSX), not a catalogue substitution.
const kimi=text('kimi-pricing-md');for(const line of kimi.split('\n').filter(l=>/^\["kimi-/.test(l))){const id=line.match(/^\["([^"]+)/)![1],v=[...line.matchAll(/\{"\$"\}([\d.]+)/g)].map(m=>Number(m[1]));if(id==='kimi-k3'){assert.equal(v.length,5);add(base('moonshot',id,'Kimi K3',v[3],v[4],v[2],v[0],'kimi-pricing-md',{cw1h:v[1]}));}else{assert.equal(v.length,3);add(base('moonshot',id,id,v[1],v[2],v[0],null,'kimi-pricing-md'));}}
// Groq has explicit Contact Sales rows: do not promote the stale catalogue prices.
for(const r of rows(text('groq-models')).filter(r=>r.length===7&&/(openai|qwen)\//.test(r[0]))){const id=r[0].match(/((?:openai|qwen)\/[\w.-]+)$/)![1];const v=[...r[2].matchAll(/\$([\d.]+)/g)].map(m=>Number(m[1]));if(v.length===2)add(base('groq',id,r[0].replace(id,'').trim(),v[0],v[1],null,null,'groq-models'));}
// Google standard text/image/video cells; keep alternative modes/modalities in raw source.
const google=text('google-pricing');for(const id of ['gemini-3.8-flash','gemini-3.7-flash','gemini-3.6-flash','gemini-3.5-flash','gemini-3.1-flash-lite']){
 const heading=id.replaceAll('-',' ').replace('gemini','Gemini').replace('flash lite','Flash-Lite').replace('flash','Flash');
 const block=google.split(`## ${heading}\n`)[1]?.split('\n## ')[0];assert(block,heading);const table=rows(block);const inrow=table.find(r=>r[0].startsWith('Input price')),outrow=table.find(r=>r[0].startsWith('Output price')),crrow=table.find(r=>r[0]==='Context caching price');assert(inrow&&outrow&&crrow);add(base('google',id,heading,rate(inrow[2]),rate(outrow[2]),rate(crrow[2]),null,'google-pricing',{promotion:/3\.[678]-flash/.test(id)?{through:'2026-12-31',next:{input:1.5,output:7.5,cr:.15},effective:'2027-01-01'}:null,notes:`Standard paid text/image/video quote. Audio and cache-storage token-hour charges are separate. Cache cell: ${crrow[2]}`}));
}
// Pricing aliases supported by installed model metadata only; do not invent entitlement.
const installed=JSON.parse(readFileSync(`${dir}/installed-catalogue.json`,'utf8')).models;
for(const r of rates.filter(r=>r.provider==='openai'))if(installed.some(m=>m.provider==='openai-codex'&&m.id===r.id))add({...r,provider:'openai-codex',evidence:'public-API-equivalent',billing:'OpenAI API-equivalent only; Codex subscription invoices, quotas and entitlements are separate.'});
// Explicit known Fast aliases already supported by reference routes.
for(const r of variants.filter(r=>r.provider==='anthropic'&&r.processing==='fast'))add({...r,id:r.id+'-fast',notes:r.notes+' Local pricing selector alias; not an asserted upstream model ID.'});
for(const m of installed.filter(m=>m.provider==='fireworks'&&m.id.includes('/routers/'))){const short=m.id.split('/').at(-1),candidate=variants.find(v=>v.provider==='fireworks'&&v.processing==='fast'&&v.geography==='global'&&`${v.id.split('/').at(-1)}-fast`===short);if(candidate)add({...candidate,id:m.id});}
// Official dated/alias IDs differ from display/catalogue IDs for some Anthropic models.
for(const r of rates.filter(r=>r.provider==='anthropic'&&r.id.startsWith('claude-haiku-4.5')))r.apiModelId='claude-haiku-4-5-20251001';
const get=(p:string,id:string)=>rates.find(r=>r.provider===p&&r.id===id);assert.equal(get('openai','gpt-6-sol').input,2);assert.equal(get('anthropic','claude-opus-5.5').cr,.2);assert.equal(get('github-copilot','gpt-5.6-luna').threshold,200000);assert.equal(get('openai','gpt-5.6-luna').threshold,272000);
const old=JSON.parse(readFileSync(`${dir}/../2026-09-05/audit/pricing-catalogue.json`,'utf8')).rates;
const deltas=rates.map(r=>{const p=old.find(x=>x.provider===r.provider&&x.id===r.id);const keys=['input','output','cr','cw'];return {provider:r.provider,id:r.id,status:!p?'new':keys.some(k=>p[k]!==r[k])?'changed':'unchanged',old:p?Object.fromEntries(keys.map(k=>[k,p[k]])):null,current:Object.fromEntries(keys.map(k=>[k,r[k]])),source:r.source};});
const coverage={installedRoutes:installed.length,verifiedRoutes:rates.length,providers:[...new Set(rates.map(r=>r.provider))],installedUnverified:installed.filter(m=>!get(m.provider,m.id)).map(m=>({provider:m.provider,id:m.id,status:'catalogue-only; not freshly verified'})),gaps:['Cerebras public page and pricing redirect do not expose numeric model tariffs; catalogue remains unverified.','SambaNova pricing page is client-rendered/empty in extraction; model list confirms availability only.','Azure DeepSeek PAYG page exposes placeholders for dollar amounts; deployment/region rates not inferred.','Together and Mistral public pages lack reliably extractable model/API-ID tariff mapping in this snapshot.','Groq Llama and MiniMax Contact Sales rows cannot be refreshed numerically.','Copilot does not yet list GPT-6 Sol/Luna; native pricing does not establish Copilot route availability.','Google only five current text models parsed; older and multimodal sections retained as source evidence, not flattened.']};
rates.sort((a,b)=>a.provider.localeCompare(b.provider)||a.id.localeCompare(b.id));
writeFileSync(`${dir}/pricing-catalogue.json`,JSON.stringify({asOf:now,units:'USD per million tokens unless additional meter states otherwise',notes:['Unknown prices remain null. This is a new snapshot; September 5 evidence stays unchanged.','Modes, TTLs, context boundaries and time-of-week tariffs are separate fields. API-equivalent valuations do not establish subscription entitlement.','Default executable resolver remains base-tier only; explicit input fallback for unpublished cache tariffs.'],rates,variants},null,2)+'\n');
writeFileSync(`${dir}/deltas.json`,JSON.stringify(deltas,null,2)+'\n');writeFileSync(`${dir}/coverage.json`,JSON.stringify(coverage,null,2)+'\n');
const flat=rates.filter(r=>r.input!==null&&r.output!==null).map(r=>({provider:r.provider,model:r.id,canonicalModel:r.name,basis:`${r.evidence}; retrieved ${now} (${r.source})`,inputPerMTok:r.input,outputPerMTok:r.output,cacheReadPerMTok:r.cr??r.input,cacheWritePerMTok:r.cw??r.input,notes:[r.cr===null?'Cache read has no quoted tariff; ordinary input fallback.':'',r.cw===null?'Cache write has no quoted tariff; ordinary input fallback.':'',r.long||r.pricingOverrides?.length?'Base tier only; long-context or conditional overrides require request-level pricing.':'',r.peak?'Off-peak base only; scheduled peak pricing requires request timestamp.':'',r.cw1h!=null?`1h cache-write tariff: $${r.cw1h}/MTok; single-write field uses base/5m rate.`:'',r.availability==='retired-native'?'Historical tariff: retired on native API; not evidence of current availability.':'',r.apiModelId?`Upstream API ID: ${r.apiModelId}.`:'',r.billing??'',r.notes??''].filter(Boolean).join(' ')}));
writeFileSync(`${repo}/runtime/skills/operator/token-chart/pricing-${now}.json`,JSON.stringify(flat,null,2)+'\n');
const cell=(v:any)=>v===null?'—':`$${v}`;
const table=(rs:any[])=>['| Provider | Model | Input | Output | Cache read | Cache write |','|---|---|---:|---:|---:|---:|',...rs.map(r=>`| ${r.provider} | ${r.id} | ${cell(r.input)} | ${cell(r.output)} | ${cell(r.cr)} | ${cell(r.cw)} |`)].join('\n');
writeFileSync(`${dir}/prices.md`,`# Verified model prices — ${now}\n\nUSD per million tokens. Standard/base or explicitly labelled off-peak tariff; — is unpublished, not free. See [pricing-catalogue.json](pricing-catalogue.json) for sources, 1h writes, context/mode/geography/time conditions.\n\n${table(rates)}\n`);
writeFileSync(`${dir}/prices.csv`,['provider,model,input_usd_per_mtok,output_usd_per_mtok,cache_read_usd_per_mtok,cache_write_usd_per_mtok,source',...rates.map(r=>[r.provider,r.id,r.input,r.output,r.cr,r.cw,r.source].map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(','))].join('\n')+'\n');
const files=readdirSync(`${dir}/sources`).filter(f=>f!== 'evidence-manifest.json');writeFileSync(`${dir}/sources/evidence-manifest.json`,JSON.stringify(files.map(file=>{const b=readFileSync(`${dir}/sources/${file}`);return{file,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')};}),null,2)+'\n');
console.log(JSON.stringify({verified:rates.length,exported:flat.length,variants:variants.length,changed:deltas.filter(d=>d.status==='changed').length,new:deltas.filter(d=>d.status==='new').length,providers:coverage.providers},null,2));
