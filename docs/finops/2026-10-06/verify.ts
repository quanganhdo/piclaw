import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {resolveProviderModelPricing} from '../../../runtime/skills/operator/token-chart/provider-model-pricing-reference';

const dir = import.meta.dir;
const manifest = await Bun.file(`${dir}/sources/evidence-manifest.json`).json();
for (const source of manifest.sources) {
  assert.equal(createHash('sha256').update(await Bun.file(`${dir}/sources/${source.file}`).bytes()).digest('hex'), source.sha256, source.file);
}
const record = (await Bun.file(`${dir}/mistral-large-4.json`).json()).rates[0];
assert.deepEqual([record.input, record.cr, record.output, record.cw], [1.36, 0.14, 4.18, null]);
assert.equal(record.cacheWriteEstimator, record.input);
assert.equal(record.lifecycle, 'public-preview');
const reference = resolveProviderModelPricing('mistral', record.id);
assert.deepEqual([reference.inputPerMTok, reference.cacheReadPerMTok, reference.outputPerMTok, reference.cacheWritePerMTok], [1.36, 0.14, 4.18, 1.36]);
assert.deepEqual(resolveProviderModelPricing('mistral', record.aliases[0]), reference);
for (const provider of ['openrouter', 'github-copilot', 'azure-foundry']) assert(resolveProviderModelPricing(provider, record.id).basis.includes('Unpriced'));
const comparison = await Bun.file(`${dir}/comparison.json`).json();
assert.equal(comparison.models.length, 7);
assert.equal(comparison.models.filter((model: {provider: string}) => model.provider === 'mistral').length, 1);
const example = comparison.examples[6];
for (const [field, expected] of Object.entries({shortCached: 0.068, shortCold: 0.1778, longCached: 0.272, longCold: 0.7112})) assert(Math.abs(example[field] - expected) < 1e-12);
assert.deepEqual(comparison.examples.slice(0, 6), (await Bun.file(`${dir}/sources/six-model-baseline.json`).json()).examples);
console.log(JSON.stringify({status: 'PASS', digestChecks: manifest.sources.length, undiscounted: true, models: 7, writeTariff: 'unpublished; input estimator fallback'}));
