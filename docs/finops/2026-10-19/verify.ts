import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const dir=import.meta.dir;
const manifest=await Bun.file(`${dir}/sources/evidence-manifest.json`).json();
assert.equal(manifest.sources.length,3);
for(const source of manifest.sources){
  assert.equal(source.status,200);
  assert.equal(createHash('sha256').update(await Bun.file(`${dir}/sources/${source.file}`).bytes()).digest('hex'),source.sha256,source.file);
}
const docs=(await Bun.file(`${dir}/sources/models.md`).text()).replaceAll('\\$','$');
const rows=docs.split('\n').filter(line=>line.startsWith('|')).map(line=>line.split('|').slice(1,-1).map(cell=>cell.trim()));
const row=rows.find(row=>row[0]==='**Mercury 3**');assert(row,'Mercury 3 row missing');
assert.deepEqual(row.slice(1,4),['~~$0.20~~ → **$0.10**','~~$0.02~~ → **$0.01**','~~$0.70~~ → **$0.35**']);
assert.equal(row[4],'`v1/chat/completions`');assert.equal(row[5],'Chat: 1M');assert.equal(row[6],'131,072');
const section=docs.split('<Tab title="Mercury 3">')[1]?.split('<Tab title=')[0];assert(section);
assert(section.includes('regularly $0.20 and $0.70'));
assert(section.includes('"model": "mercury-3"')||section.includes('model="mercury-3"'));
const data=await Bun.file(`${dir}/mercury-3.json`).json();assert.equal(data.rates.length,1);
const rate=data.rates[0];assert.equal(rate.provider,'inception');assert.equal(rate.id,'mercury-3');
assert.deepEqual([rate.input,rate.cr,rate.cw,rate.output],[.2,.02,null,.7]);
assert.equal(rate.maximumOutputTokens,131072);assert.equal(rate.contextWindowLabel,'1M');
assert.equal(rate.source,'https://docs.inceptionlabs.ai/get-started/models.md');
assert(rate.pricingBasis.includes('undiscounted'));
const csv=(await Bun.file(`${dir}/prices.csv`).text()).trim().split('\n');assert.equal(csv.length,2);
assert.deepEqual(csv[1].split(',').slice(0,7),['inception','mercury-3','regular undiscounted native API','0.20','0.02','','0.70']);
console.log(JSON.stringify({status:'PASS',sourceHashes:manifest.sources.length,model:rate.id,regular:[rate.input,rate.cr,rate.output],cacheWrite:'unpublished',documentationOnly:true}));
