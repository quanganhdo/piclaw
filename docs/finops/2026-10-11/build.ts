import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const dir = import.meta.dir;
const manifest: {sources: Array<{file: string; url: string; sha256: string}>} = await Bun.file(`${dir}/sources/evidence-manifest.json`).json();
const sourceUrl = (file: string): string => {const source = manifest.sources.find(source => source.file === file); assert(source, file); return source.url;};
for (const source of manifest.sources) assert.equal(createHash('sha256').update(await Bun.file(`${dir}/sources/${source.file}`).bytes()).digest('hex'), source.sha256, source.file);
const rows = (text: string): string[][] => text.split('\n').filter(line => line.startsWith('|')).map(line => line.split('|').slice(1,-1).map(cell => cell.trim()));
const money = (cell: string): number => {const match = cell.match(/\$([\d.]+)/); assert(match, cell); return Number(match[1]);};
const openai = await Bun.file(`${dir}/sources/openai.md`).text();
const anthropic = await Bun.file(`${dir}/sources/anthropic.md`).text();
const copilot = rows(await Bun.file(`${dir}/sources/copilot.md`).text());
const router: Array<{id: string; pricing: {prompt: string; completion: string; input_cache_read: string; input_cache_write?: string; input_cache_write_1h?: string; overrides?: Array<{min_prompt_tokens: number; prompt: string; completion: string; input_cache_read: string; input_cache_write?: string}>}}> = (await Bun.file(`${dir}/sources/openrouter.json`).json()).data;
const standard = rows(openai.split('### Standard pricing data')[1]?.split('\n### ')[0] ?? '');
const native = ['gpt-5.5', 'gpt-6.1-sol'].map(id => {
  const row = standard.find(row => row[0] === id || (id === 'gpt-5.5' && row[0] === 'gpt-5.5 (<272K context length)'));
  assert(row && row.length === 9);
  const tier = (offset: number) => ({input: money(row[offset]), cr: money(row[offset+1]), cw: row[offset+2] === '-' ? null : money(row[offset+2]), output: money(row[offset+3])});
  return {provider: 'openai', id, name: id === 'gpt-5.5' ? 'GPT-5.5' : 'GPT-6.1 Sol', ...tier(1), long: tier(5), threshold: 272000, thresholdOperator: '>', source: sourceUrl('openai.md')};
});
const sonnetRow = rows(anthropic).find(row => row[0] === 'Claude Sonnet 5.5'); assert(sonnetRow);
const sonnetPrices = {input: money(sonnetRow[1]), cr: money(sonnetRow[4]), cw: money(sonnetRow[2]), output: money(sonnetRow[5])};
assert((await Bun.file(`${dir}/sources/sonnet-model.md`).text()).includes('`claude-sonnet-5-5`'));
const sonnet = {provider: 'anthropic', id: 'claude-sonnet-5.5', apiId: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', ...sonnetPrices, long: sonnetPrices, threshold: null, thresholdOperator: null, write1h: money(sonnetRow[3]), source: sourceUrl('anthropic.md')};
const bases = [...native, sonnet];
assert.deepEqual(bases.map(rate => [rate.input,rate.cr,rate.cw,rate.output]), [[5,.5,null,30],[2,.1,2.5,10],[2,.1,2.5,10]]);
const copilotRates = bases.map(base => {
  const row = copilot.find(row => row[0] === base.name && row[3] === 'Default'); assert(row);
  const rate = {input: money(row[5]), cr: money(row[6]), cw: row[7] === 'Not applicable' ? null : money(row[7]), output: money(row[8])};
  assert.deepEqual(rate, {input:base.input,cr:base.cr,cw:base.cw,output:base.output});
  let long = rate;
  if (base.threshold !== null) {const longRow = copilot.find(row => row[0] === base.name && row[3] === 'Long context'); assert(longRow); long = {input:money(longRow[5]), cr:money(longRow[6]), cw:longRow[7] === 'Not applicable' ? null : money(longRow[7]), output:money(longRow[8])}; assert.deepEqual(long,base.long);}
  const {write1h: _write1h,...copilotBase} = base as typeof base & {write1h?: number};
  return {...copilotBase,...rate,long,provider:'github-copilot',source:sourceUrl('copilot.md')};
});
const toMillion = (value: string): number => Number((Number(value) * 1e6).toPrecision(12));
const routerRates = bases.map(base => {
  const id = `${base.provider}/${base.id}`; const model = router.find(model => model.id === id); assert(model, id);
  const price = model.pricing;
  const rate = {input:toMillion(price.prompt),cr:toMillion(price.input_cache_read),cw:price.input_cache_write == null ? null : toMillion(price.input_cache_write),output:toMillion(price.completion)};
  assert.deepEqual(rate,{input:base.input,cr:base.cr,cw:base.cw,output:base.output});
  const override = price.overrides?.[0];
  const long = override ? {input:toMillion(override.prompt),cr:toMillion(override.input_cache_read),cw:override.input_cache_write == null ? null : toMillion(override.input_cache_write),output:toMillion(override.completion)} : rate;
  assert.deepEqual(long,base.long);
  const {write1h: _write1h,...routerBase} = base as typeof base & {write1h?: number};
  return {...routerBase,...rate,long,...(price.input_cache_write_1h == null ? {} : {write1h:toMillion(price.input_cache_write_1h)}),provider:'openrouter',id,threshold:override?.min_prompt_tokens ?? null,thresholdOperator:override ? '>=' : null,source:sourceUrl('openrouter.json'),rawOverrides:price.overrides ?? []};
});
const rates = [...bases,...copilotRates,...routerRates].map(rate => ({...rate,cacheWriteEstimator:rate.cw ?? rate.input,retrievedDate:'2026-10-11',evidence:'public-first-party',notes:`${rate.cw === null ? 'No separate cache-write tariff; ordinary input charges written/miss tokens once in the examples.' : 'Published cache-write tariff; Sonnet examples use 5m TTL.'} ${rate.threshold === null ? 'One standard price schedule across Sonnet 1M context.' : 'Long-context rates and this route boundary are recorded separately.'} This exact route is independently verified; subscription allowances, credits and invoices remain separate.`}));
assert.equal(new Set(rates.map(rate => `${rate.provider}/${rate.id}`)).size,9);
const cost = (rate: {input:number;cr:number;cw:number|null;output:number}, prompt:number, completion:number, cached:boolean) => (prompt * (cached ? .05*rate.input + .9*rate.cr + .05*(rate.cw ?? rate.input) : rate.input) + completion*rate.output)/1e6;
const examples = bases.map(rate => ({name:rate.name,shortCached:cost(rate,100000,10000,true),shortCold:cost(rate,100000,10000,false),longCached:cost(rate.long,400000,40000,true),longCold:cost(rate.long,400000,40000,false)}));
assert.deepEqual(examples.map(example => [example.shortCached,example.shortCold,example.longCached,example.longCold]),[[.395,.8,2.56,5.8],[.1315,.3,.852,2.2],[.1315,.3,.526,1.2]]);
await Bun.write(`${dir}/pricing.json`,JSON.stringify({asOf:'2026-10-11',units:'USD per million tokens',rates,examples,sources:manifest.sources},null,2)+'\n');
await Bun.write(`${dir}/prices.csv`,'provider,model,input,output,cache_read,cache_write_published,cache_write_estimator\n'+rates.map(rate => [rate.provider,rate.id,rate.input,rate.output,rate.cr,rate.cw ?? '',rate.cacheWriteEstimator].join(',')).join('\n')+'\n');
console.log(JSON.stringify({status:'PASS',routes:rates.length,sonnetCacheRead:sonnet.cr,examples}));
