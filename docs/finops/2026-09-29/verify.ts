import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const dir = import.meta.dir;
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const manifest = JSON.parse(readFileSync(`${dir}/sources/evidence-manifest.json`, 'utf8'));
for (const source of manifest.sources) {
  const bytes = readFileSync(`${dir}/sources/${source.file}`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256);
}
const data = JSON.parse(readFileSync(`${dir}/gpt-6.1-sol.json`, 'utf8'));
const chart = JSON.parse(readFileSync(`${repo}/runtime/skills/operator/token-chart/pricing-2026-09-29.json`, 'utf8'));
assert.equal(data.rates.length, 1);
assert.equal(chart.length, 1);
const rate = data.rates[0];
assert.equal(rate.provider, 'openai');
assert.equal(rate.id, 'gpt-6.1-sol');
assert.deepEqual([rate.input, rate.cr, rate.cw, rate.output], [2, 0.1, 2.5, 10]);
assert.deepEqual(rate.long, { input: 4, cr: 0.2, cw: 5, output: 15 });
assert.equal(rate.threshold, 272000);
assert.equal(rate.thresholdOperator, '>');
assert.deepEqual(chart[0], {
  provider: 'openai', model: rate.id, canonicalModel: rate.name,
  basis: `${rate.evidence}; retrieved 2026-09-29 (${rate.source})`,
  inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.1, cacheWritePerMTok: 2.5,
  notes: `${rate.notes} Chart estimates use the base tier only; Batch, Flex, Fast and regional modifiers require request-level selection. ${rate.billing}`,
});
assert.deepEqual(data.variants.map((x: { processing: string }) => x.processing), ['standard', 'batch', 'flex', 'fast']);
assert.equal(data.variants[1].cr, 0.05);
assert.equal(data.variants[2].cr, 0.05);
assert.equal(data.variants[3].cr, 0.2);
assert.equal(manifest.otherChecks.find((x: { url: string }) => x.url.includes('openrouter.ai'))?.matchingModelIds, 0);
assert(!readFileSync(`${dir}/sources/copilot.md`, 'utf8').includes('gpt-6.1-sol'));
console.log(JSON.stringify({ status: 'PASS', nativeRoute: 'openai/gpt-6.1-sol', variants: data.variants.length, digestChecks: manifest.sources.length }));
