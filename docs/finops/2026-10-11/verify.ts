import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const dir = import.meta.dir;
const manifest = await Bun.file(`${dir}/sources/evidence-manifest.json`).json();
for (const source of manifest.sources) assert.equal(createHash('sha256').update(await Bun.file(`${dir}/sources/${source.file}`).bytes()).digest('hex'),source.sha256,source.file);
const data = await Bun.file(`${dir}/pricing.json`).json();
assert.equal(data.rates.length,9);
assert.equal(new Set(data.rates.map((rate: {provider: string; id: string}) => `${rate.provider}/${rate.id}`)).size,9);
for (const rate of data.rates) {
  assert.deepEqual([rate.input,rate.cr,rate.cw,rate.output], rate.id.includes('gpt-5.5') ? [5,.5,null,30] : [2,.1,2.5,10]);
  assert.equal(rate.cacheWriteEstimator,rate.cw ?? rate.input);
  if (rate.id.includes('claude-sonnet')) {
    assert.deepEqual(rate.long,{input:2,cr:.1,cw:2.5,output:10});
    assert.equal(rate.write1h,rate.provider === 'github-copilot' ? undefined : 4);
  } else {
    assert.equal(rate.threshold,272000);
    assert.equal(rate.thresholdOperator,rate.provider === 'openrouter' ? '>=' : '>');
    assert.deepEqual(rate.long,rate.id.includes('gpt-5.5') ? {input:10,cr:1,cw:null,output:45} : {input:4,cr:.2,cw:5,output:15});
  }
}
const expected = [[.395,.8,2.56,5.8],[.1315,.3,.852,2.2],[.1315,.3,.526,1.2]];
data.examples.forEach((example: {shortCached: number; shortCold: number; longCached: number; longCold: number},i: number) => assert.deepEqual([example.shortCached,example.shortCold,example.longCached,example.longCold],expected[i]));
console.log(JSON.stringify({status:'PASS',digestChecks:manifest.sources.length,routes:data.rates.length,examples:data.examples.length,documentationOnly:true}));
