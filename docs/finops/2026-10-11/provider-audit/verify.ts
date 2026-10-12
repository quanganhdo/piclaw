import{readFileSync}from'node:fs';
import{join}from'node:path';
import{createHash}from'node:crypto';
import assert from'node:assert/strict';
const root=import.meta.dir;const audit=JSON.parse(readFileSync(join(root,'audit.json'),'utf8'));
const markdown=readFileSync(join(root,'README.md'),'utf8');
for(const line of markdown.split('\n')){
 const match=line.match(/^\| `([^`]+)` \| \$([\d.]+) \| \$([\d.]+) \| (Unquoted|\$[\d.]+) \|/);if(!match)continue;
 const rate=audit.nemotron.find((row:any)=>row.id===match[1]);assert(rate,match[1]);assert.equal(rate.input,Number(match[2]));assert.equal(rate.output,Number(match[3]));assert.equal(rate.cr,match[4]==='Unquoted'?null:Number(match[4].slice(1)));
}
const manifest=JSON.parse(readFileSync(join(root,'sources/manifest.json'),'utf8'));const baseline=manifest.find((row:any)=>row.originalSha256);
assert.equal(createHash('sha256').update(readFileSync(join(root,'../../2026-09-22/pricing-catalogue.json'))).digest('hex'),baseline.originalSha256);
const pricing=JSON.parse(readFileSync(join(root,'../pricing.json'),'utf8'));assert.deepEqual(pricing.examples.map((row:any)=>row.name),['GPT-5.5','GPT-6.1 Sol','Claude Sonnet 5.5']);
console.log('PASS: README pricing parity, historical snapshot hash and example identities');
