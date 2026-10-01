import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const dir = import.meta.dir;
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const manifest = JSON.parse(readFileSync(`${dir}/sources/evidence-manifest.json`, 'utf8'));
for (const source of manifest.sources) {
  const bytes = readFileSync(`${dir}/sources/${source.file}`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256, source.file);
}
const pricing = readFileSync(`${dir}/sources/pricing.md`, 'utf8');
const model = readFileSync(`${dir}/sources/model.md`, 'utf8');
const copilot = readFileSync(`${dir}/sources/copilot.md`, 'utf8');
const routerNote = manifest.otherChecks.find((x: { url: string }) => x.url === 'https://openrouter.ai/api/v1/models');
assert.equal(routerNote?.matchingModelIds, 0);
assert(model.includes('Model ID: `gpt-6.1-sol`'));
assert(model.includes('Prompts with more than 272K input tokens'));
assert(!copilot.includes('gpt-6.1-sol') && !copilot.includes('GPT-6.1 Sol'));
const models = ['Standard', 'Batch', 'Flex', 'Fast'];
const money = (cell: string) => {
  const m = cell.match(/^\$([\d.]+)$/);
  assert(m, `Invalid tariff ${cell}`);
  return Number(m[1]);
};
const variants = models.map((mode) => {
  const section = pricing.split(`### ${mode} pricing data`)[1]?.split('\n### ')[0];
  assert(section, `${mode} table absent`);
  const matches = section.split('\n').filter((line) => line.startsWith('| gpt-6.1-sol |'));
  assert.equal(matches.length, 1, `${mode} row count`);
  const cells = matches[0].split('|').slice(1, -1).map((cell) => cell.trim());
  assert.equal(cells.length, 9);
  const values = cells.slice(1).map(money);
  return {
    processing: mode.toLowerCase(),
    input: values[0], cr: values[1], cw: values[2], output: values[3],
    long: { input: values[4], cr: values[5], cw: values[6], output: values[7] },
  };
});
const standard = variants[0];
const source = 'https://developers.openai.com/api/docs/pricing.md';
const record = {
  provider: 'openai', id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol',
  input: standard.input, output: standard.output, cr: standard.cr, cw: standard.cw,
  threshold: 272000, thresholdOperator: '>', long: standard.long,
  source, modelSource: 'https://developers.openai.com/api/docs/models/gpt-6.1-sol.md',
  retrievedDate: '2026-09-29', evidence: 'public-first-party',
  contextWindow: 1050000, maximumInputTokens: 922000, maximumOutputTokens: 128000,
  billing: 'Native OpenAI API tariff. Not evidence of GitHub Copilot/OpenRouter availability, credits, subscription capacity, or invoice charges.',
  notes: 'Standard short-context tier; whole request uses long-context rates above 272K input tokens. Fast is unavailable with EU data residency. Eligible regional processing adds 10%.',
};
assert.deepEqual([record.input, record.cr, record.cw, record.output], [2, 0.1, 2.5, 10]);
assert.deepEqual(record.long, { input: 4, cr: 0.2, cw: 5, output: 15 });
assert.equal(variants.find((x) => x.processing === 'batch')?.cr, 0.05);
assert.equal(variants.find((x) => x.processing === 'flex')?.cr, 0.05);
assert.equal(variants.find((x) => x.processing === 'fast')?.cr, 0.2);
const output = { asOf: '2026-09-29', units: 'USD per million tokens', rates: [record], variants };
writeFileSync(`${dir}/gpt-6.1-sol.json`, JSON.stringify(output, null, 2) + '\n');
const flat = [{
  provider: 'openai', model: record.id, canonicalModel: record.name,
  basis: `${record.evidence}; retrieved 2026-09-29 (${source})`,
  inputPerMTok: record.input, outputPerMTok: record.output,
  cacheReadPerMTok: record.cr, cacheWritePerMTok: record.cw,
  notes: `${record.notes} Chart estimates use the base tier only; Batch, Flex, Fast and regional modifiers require request-level selection. ${record.billing}`,
}];
writeFileSync(`${repo}/runtime/skills/operator/token-chart/pricing-2026-09-29.json`, JSON.stringify(flat, null, 2) + '\n');
console.log(JSON.stringify({ status: 'PASS', model: record.id, variants: variants.length, short: [record.input, record.cr, record.cw, record.output], long: record.long }));
