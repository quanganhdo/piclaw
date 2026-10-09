import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const dir = import.meta.dir;
const manifest = await Bun.file(`${dir}/sources/evidence-manifest.json`).json();
for (const source of manifest.sources) {
  assert.equal(createHash('sha256').update(await Bun.file(`${dir}/sources/${source.file}`).bytes()).digest('hex'), source.sha256, source.file);
}
const html = await Bun.file(`${dir}/sources/mistral-model.html`).text();
const streams = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)]
  .filter(match => match[1].startsWith('self.__next_f.push('))
  .map(match => JSON.parse(match[1].slice('self.__next_f.push('.length, -1))[1]).join('\n');
const pricing = [...streams.matchAll(/"pricing":(\{[^\n]+?\}),"isRetired"/g)]
  .map(match => JSON.parse(match[1]));
assert(pricing.length > 0, 'No structured model-page pricing');
const price = pricing[0];
const meter = (label: string) => [...price.input, ...price.output].find(entry => entry.label === label);
const input = meter('Input').originalPrice, cr = meter('Cached input').originalPrice, output = meter('Output').originalPrice;
assert.deepEqual([input, cr, output], [1.36, 0.14, 4.18]);
assert.deepEqual([meter('Input').price, meter('Cached input').price, meter('Output').price], [0.68, 0.07, 2.09]);
assert(streams.includes('"names":["mistral-large-4","mistral-large-4-0"]'));
assert(html.includes('Public Preview') && html.includes('1M'));
const caching = await Bun.file(`${dir}/sources/mistral-caching.md`).text();
assert(caching.includes('prompt_tokens - cached_tokens') && caching.includes('64 tokens'));
const record = {
  provider: 'mistral', id: 'mistral-large-4', aliases: ['mistral-large-4-0'], name: 'Mistral Large 4',
  input, output, cr, cw: null, cacheWriteEstimator: input, contextWindowLabel: '1M',
  contextPricing: 'One published price schedule; no separate long-context uplift found.',
  source: 'https://docs.mistral.ai/models/mistral-large-4-0',
  announcement: 'https://mistral.ai/news/mistral-large-4/',
  retrievedDate: '2026-10-06', evidence: 'public-first-party', lifecycle: 'public-preview',
  pricingBasis: 'Undiscounted originalPrice fields. Two-week 50% launch discount is excluded.',
  cache: {writeTariff: 'not separately published', ttl: 'not published in captured documentation', blockTokens: 64,
    inputAccounting: 'prompt_tokens includes cached_tokens; uncached input = prompt_tokens - cached_tokens'},
  notes: 'No separate cache-write tariff; local separated write tokens use ordinary input estimator fallback, not an additional surcharge. The launch discount is excluded. No separate long-context uplift found; public preview can receive silent updates. No other provider route, subscription entitlement or invoice is inferred.',
};
await Bun.write(`${dir}/mistral-large-4.json`, JSON.stringify({asOf: '2026-10-06', units: 'USD per million tokens', rates: [record]}, null, 2) + '\n');
await Bun.write(`${dir}/../../../runtime/skills/operator/token-chart/pricing-2026-10-06.json`, JSON.stringify([{
  provider: record.provider, model: record.id, canonicalModel: record.name,
  basis: `${record.evidence}; undiscounted native Mistral API; retrieved 2026-10-06 (${record.source})`,
  inputPerMTok: input, outputPerMTok: output, cacheReadPerMTok: cr, cacheWritePerMTok: input, notes: record.notes,
}], null, 2) + '\n');
const baseline = await Bun.file(`${dir}/sources/six-model-baseline.json`).json();
const rates = {input, read: cr, write: input, output};
const models = [...baseline.models, {id: record.id, name: record.name, provider: record.provider, short: rates, long: rates,
  threshold: null, cacheWritePublished: false, notes: record.notes}];
const cost = (rate: {input: number; read: number; write: number; output: number}, prompt: number, completion: number, cached: boolean) => (prompt * (cached ? 0.05 * rate.input + 0.9 * rate.read + 0.05 * rate.write : rate.input) + completion * rate.output) / 1e6;
const examples = models.map(model => ({name: model.name, shortCached: cost(model.short, 100000, 10000, true), shortCold: cost(model.short, 100000, 10000, false), longCached: cost(model.long, 400000, 40000, true), longCold: cost(model.long, 400000, 40000, false)}));
assert(Math.abs(examples[6].shortCached - 0.068) < 1e-12);
assert(Math.abs(examples[6].shortCold - 0.1778) < 1e-12);
assert(Math.abs(examples[6].longCached - 0.272) < 1e-12);
assert(Math.abs(examples[6].longCold - 0.7112) < 1e-12);
assert.deepEqual(examples.slice(0, 6), baseline.examples);
const comparison = {...baseline, models, examples, sources: manifest.sources,
  limitations: 'Mistral undiscounted native prices; writes charged once as uncached input. No separate cache-write tariff or guaranteed cache hit/TTL. Other models use their 6 October 06:46 UTC captures. Equal token counts do not establish equal task quality; no promotional or self-hosted entry is ranked.'};
await Bun.write(`${dir}/comparison.json`, JSON.stringify(comparison, null, 2) + '\n');
await Bun.write(`${dir}/comparison.csv`, 'model,input_per_mtok,output_per_mtok,cache_read_per_mtok,cache_write_estimator_per_mtok,short_cached_request,short_cold_request,long_cached_request,long_cold_request\n' + models.map((model, i) => [model.name, model.short.input, model.short.output, model.short.read, model.short.write, examples[i].shortCached, examples[i].shortCold, examples[i].longCached, examples[i].longCold].join(',')).join('\n') + '\n');
await Bun.write(`${dir}/comparison.md`, '# Seven-model native API price comparison\n\nUSD per million tokens; Mistral launch discount excluded.\n\n| Model | Input | Output | Cache read | Write estimator | Cached 100K + 10K | Cold 100K + 10K |\n|---|---:|---:|---:|---:|---:|---:|\n' + models.map((model, i) => `| ${model.name} | $${model.short.input} | $${model.short.output} | $${model.short.read} | $${model.short.write}${i === 6 ? '†' : ''} | $${examples[i].shortCached.toFixed(4)} | $${examples[i].shortCold.toFixed(4)} |`).join('\n') + '\n\nCached example: 90% reads, 5% writes, 5% fresh input. † Mistral publishes no separate write tariff; writes use ordinary input once. Other provider writes use their published rates. Anthropic writes use 5m TTL. These are equal-token price scenarios, not measured task costs or quality rankings. GPT-5.6 Sol via OpenRouter remains a separate $2/$10/$0.20/$2.50 route, not the native $4/$20/$0.40/$5 row above.\n');
console.log(JSON.stringify({status: 'PASS', nativeRoute: 'mistral/mistral-large-4', prices: [input, cr, output], models: models.length, examples: examples[6]}));
