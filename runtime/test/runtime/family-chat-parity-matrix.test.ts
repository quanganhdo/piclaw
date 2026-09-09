import {expect,test} from 'bun:test';import {readFileSync} from 'node:fs';import {join} from 'node:path';
interface Row{id:string;area:string;expectation:string;evidence:string[]}
const fixture=JSON.parse(readFileSync(join(import.meta.dir,'../fixtures/family-chat-parity-matrix.json'),'utf8')) as {schema:string;rows:Row[]};
const testRoot=join(import.meta.dir,'..');

test('family chat parity matrix is complete unique and backed by exact tests',()=>{
  expect(fixture.schema).toBe('piclaw.family-chat-parity.v1');expect(fixture.rows.length).toBeGreaterThanOrEqual(17);
  const ids=new Set<string>();
  for(const row of fixture.rows){expect(row.id.length).toBeGreaterThan(2);expect(ids.has(row.id)).toBe(false);ids.add(row.id);expect(row.area.length).toBeGreaterThan(2);expect(row.expectation.length).toBeGreaterThan(2);expect(row.evidence.length).toBeGreaterThan(0);
    for(const item of row.evidence){const separator=item.indexOf('::');expect(separator).toBeGreaterThan(0);const relative=item.slice(0,separator),name=item.slice(separator+2),path=join(testRoot,relative),source=readFileSync(path,'utf8');expect(source,`${relative}::${name}`).toContain(name);}
  }
  for(const required of ['shared-component-tree','shared-chat-css','markdown-html-code','thinking-tools-outcomes','compose-layout-drafts-keyboard','curated-model-picker','session-picker-tree','queue-steer-stop-retry','realtime-reconnect','media-upload-send','media-view-preview-download','annotations','adaptive-card-submit','widget-open-submit','account-replacement-stale-events'])expect(ids.has(required),required).toBe(true);
});
