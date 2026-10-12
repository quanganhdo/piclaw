import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const dir = import.meta.dir;
const manifest = await Bun.file(`${dir}/sources/manifest.json`).json();
for (const source of manifest) {
  assert(!source.error && (source.status === undefined || source.status === 200), source.file);
  assert.equal(createHash('sha256').update(await Bun.file(`${dir}/sources/${source.file}`).bytes()).digest('hex'),source.sha256,source.file);
}
const text = (file: string) => Bun.file(`${dir}/sources/${file}`).text();
const rows = (value: string) => value.split('\n').filter(line => line.startsWith('|')).map(line => line.split('|').slice(1,-1).map(cell => cell.trim()));
const money = (cell: string): number|null => {const match = cell.match(/\$([\d.]+)/); return match ? Number(match[1]) : null;};
const baseline = await Bun.file(`${dir}/sources/baseline-2026-09-22.json`).json();
const priorSol = await Bun.file(`${dir}/../pricing.json`).json();
const openai = await text('openai-pricing.md');
const standard = rows(openai.split('### Standard pricing data')[1]?.split('\n### ')[0] ?? '').filter(row => row.length === 9 && /^(gpt-|o\d)/.test(row[0]));
const openaiRates = standard.map(row => {
  const id = row[0].replace(/\s*\(.*/,'');
  const current = {input:money(row[1]),cr:money(row[2]),cw:money(row[3]),output:money(row[4])};
  const previous = baseline.rates.find(rate => rate.provider === 'openai' && rate.id === id) ?? priorSol.rates.find(rate => rate.provider === 'openai' && rate.id === id);
  const old = previous ? {input:previous.input,cr:previous.cr,cw:previous.cw,output:previous.output} : null;
  return {provider:'openai',id,processing:'standard',...current,previous:old,status:old === null ? 'new-coverage' : JSON.stringify(current) === JSON.stringify(old) ? 'unchanged' : 'changed',source:'https://developers.openai.com/api/docs/pricing.md'};
});
const modes = ['Batch','Flex','Fast','Ultrafast'].flatMap(mode => rows(openai.split(`### ${mode} pricing data`)[1]?.split('\n### ')[0] ?? '').filter(row => ['gpt-6-astra','gpt-6.1-sol'].includes(row[0])).map(row => ({provider:'openai',id:row[0],processing:mode.toLowerCase(),input:money(row[1]),cr:money(row[2]),cw:money(row[3]),output:money(row[4]),long:{input:money(row[5]),cr:money(row[6]),cw:money(row[7]),output:money(row[8])},source:'https://developers.openai.com/api/docs/pricing.md'})));
const sol = openaiRates.find(rate => rate.id === 'gpt-6.1-sol'); assert(sol);
const ultra = modes.find(rate => rate.id === sol.id && rate.processing === 'ultrafast'); assert(ultra);
assert.deepEqual([ultra.input,ultra.cr,ultra.cw,ultra.output],[12,.6,15,60]);
assert.deepEqual(ultra.long,{input:24,cr:1.2,cw:30,output:90});
assert((await text('openai-changelog.md')).includes('### Oct 8') && (await text('openai-ultrafast.md')).includes('service_tier'));
const router = (await Bun.file(`${dir}/sources/openrouter.json`).json()).data;
const mtok = (value: string|undefined): number|null => value === undefined ? null : Number((Number(value)*1e6).toPrecision(12));
const nemotron = router.filter(model => model.id.includes('nemotron')).map(model => {
  const previous = baseline.rates.find(rate => rate.provider === 'openrouter' && rate.id === model.id);
  const current = {input:mtok(model.pricing.prompt),output:mtok(model.pricing.completion),cr:mtok(model.pricing.input_cache_read),cw:mtok(model.pricing.input_cache_write)};
  const old = previous ? {input:previous.input,output:previous.output,cr:previous.cr,cw:previous.cw} : null;
  return {provider:'openrouter',id:model.id,...current,contextWindow:model.context_length,previous:old,status:!old ? 'new-coverage' : JSON.stringify(current) === JSON.stringify(old) ? 'unchanged' : 'changed',free:model.id.endsWith(':free'),source:'https://openrouter.ai/api/v1/models',notes:'Exact hosted route quote. Missing cache tariffs stay null. Free variants have separate quotas; not an unlimited production entitlement.'};
});
const nano = nemotron.find(rate => rate.id === 'nvidia/nemotron-3-nano-30b-a3b'); assert(nano);
assert.deepEqual([nano.input,nano.output,nano.cr],[.06,.24,null]);
assert.deepEqual([nano.previous.input,nano.previous.output,nano.previous.cr],[.05,.2,.03]);
// Extract the model-page price object without browser execution. Keep undiscounted originalPrice fields.
const streams = (html: string): string => [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].filter(match => match[1].startsWith('self.__next_f.push(')).map(match => JSON.parse(match[1].slice('self.__next_f.push('.length,-1))[1]).join('\n');
const large4 = streams(await text('mistral-large4.html'));
const match = large4.match(/"pricing":(\{[^\n]+?\}),"isRetired"/); assert(match);
const price = JSON.parse(match[1]);
const meter = (label: string) => [...price.input,...price.output].find(entry => entry.label === label);
const large4Rate = {provider:'mistral',id:'mistral-large-4',input:meter('Input').originalPrice,cr:meter('Cached input').originalPrice,output:meter('Output').originalPrice,cw:null,source:'https://docs.mistral.ai/models/mistral-large-4-0',launchDiscount:{input:meter('Input').price,cr:meter('Cached input').price,output:meter('Output').price,excluded:true}};
assert.deepEqual([large4Rate.input,large4Rate.cr,large4Rate.output],[1.36,.14,4.18]);
const oldMistral = (await Bun.file(`${dir}/sources/mistral-baseline-2026-10-06.json`).json()).rates[0];
assert.deepEqual([large4Rate.input,large4Rate.cr,large4Rate.output],[oldMistral.input,oldMistral.cr,oldMistral.output]);
const mistralTable = await text('mistral-pricing.html');
const mistralRows = [...mistralTable.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(match => match[1]);
const otherMistral = [
  {name:'Mistral Large 3',id:'mistral-large-2512',file:'mistral-large3.html',input:.5,cr:.05,output:1.5},
  {name:'Mistral Medium 3.5',id:'mistral-medium-3-5',file:'mistral-medium35.html',input:1.5,cr:.15,output:7.5},
  {name:'Mistral Small 4',id:'mistral-small-2603',file:'mistral-small4.html',input:.15,cr:.015,output:.6},
];
for (const rate of otherMistral) {
  assert((await text(rate.file)).includes(rate.id),rate.id);
  const row = mistralRows.find(row => row.includes(rate.name)); assert(row,rate.name);
  const values = [...row.matchAll(/\$([\d.]+)/g)].map(match => Number(match[1]));
  assert.deepEqual(values,[rate.input,rate.cr,rate.output],rate.name);
}
const ds = await text('deepseek-pricing.html');
for (const literal of ['DeepSeek-V4.1-Flash','DeepSeek-V4-Pro-0813','$0.003','$0.022','$0.006','$0.044','$0.15','$0.66','$1.32','$1.98','$3.96','01:00','06:00','Chinese public holidays']) assert(ds.includes(literal),literal);
const deepseek = [
  {provider:'deepseek',id:'deepseek-flash',resolvedModel:'DeepSeek-V4.1-Flash',input:.15,cr:.003,output:.6,cw:null,peak:{input:.3,cr:.006,output:1.2}},
  {provider:'deepseek',id:'deepseek-v4-pro',resolvedModel:'DeepSeek-V4-Pro-0813',input:.66,cr:.022,output:1.98,cw:null,peak:{input:1.32,cr:.044,output:3.96}},
].map(rate => {
  const previous = baseline.rates.find(old => old.provider === rate.provider && old.id === rate.id); assert(previous);
  assert.deepEqual([rate.input,rate.cr,rate.output],[previous.input,previous.cr,previous.output]);
  assert.deepEqual([rate.peak.input,rate.peak.cr,rate.peak.output],[previous.peak.input,previous.peak.cr,previous.peak.output]);
  return {...rate,status:'unchanged',source:'https://api-docs.deepseek.com/quick_start/pricing',peakSchedule:'Monday–Friday 01:00–04:00 and 06:00–10:00 UTC, excluding Chinese public holidays'};
});
assert((await text('nvidia-hf-lightning-bf16-license.txt')).includes('OpenMDW-1.1'));
assert((await text('nvidia-api-trial-terms.pdf')).startsWith('%PDF'));
assert((await text('nvidia-api-trial-terms-extracted.txt')).includes('trial service credits'));
const result = {asOf:'2026-10-11',units:'USD per million tokens unless separately noted',openai:{standard:openaiRates,modes,newTier:'Ultrafast, announced October 8; 6x Standard for Astra and Sol 6.1; global, US/EU data-residency endpoints; own limits.'},nemotron,mistral:[{...large4Rate,status:'unchanged'},...otherMistral.map(rate => ({...rate,provider:'mistral',cw:null,status:'newly-verified-coverage',source:'https://docs.mistral.ai/inference/pricing'}))],deepseek,gaps:['No public native NVIDIA pay-per-million production Nemotron tariff verified. NVIDIA trial access/credits, NIM licensing and hardware costs are separate.','NVIDIA AI Enterprise numerical price not verified from the current captured official page; do not reuse historical $/GPU quotes.','Mistral smaller-model cached prices are from the official pricing table; earlier native snapshot lacked extractable model tariffs, so no price-change percentage is asserted.'],sources:manifest};
await Bun.write(`${dir}/audit.json`,JSON.stringify(result,null,2)+'\n');
const csv = (value: unknown) => '"'+String(value ?? '').replaceAll('"','""')+'"';
const all = [...openaiRates,...modes,...nemotron,...result.mistral,...deepseek];
await Bun.write(`${dir}/rates.csv`,'provider,model,processing,status,input,output,cache_read,cache_write_published,source\n'+all.map(rate => [rate.provider,rate.id,rate.processing ?? 'standard',rate.status ?? 'mode-coverage',rate.input,rate.output,rate.cr,rate.cw,rate.source].map(csv).join(',')).join('\n')+'\n');
console.log(JSON.stringify({status:'PASS',sourceHashes:manifest.length,openaiStandard:openaiRates.length,standardChanges:openaiRates.filter(rate => rate.status !== 'unchanged').map(rate => rate.id),nemotronChanges:nemotron.filter(rate => rate.status !== 'unchanged').map(rate => rate.id),mistralLarge4:'unchanged, launch excluded',deepseek:'unchanged',documentationOnly:true}));
