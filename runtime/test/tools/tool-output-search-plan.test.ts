import { test, expect } from 'bun:test';
import '../helpers.js';
import { initDatabase, getDb, storeToolOutputWithChunks, searchToolOutputSnippets, deleteToolOutputById } from '../../src/db.js';
import { prepareFtsQuery } from '../../src/utils/fts-query.js';

test('target-first FTS preserves query semantics, limits and isolation across common/rare terms', () => {
  initDatabase(); const db=getDb(),id='search-plan-target';
  db.transaction(()=>{
    for(let n=0;n<50;n++)storeToolOutputWithChunks({id:`search-plan-other-${n}`,created_at:'2999-01-01T00:00:00Z'},Array.from({length:4},()=>`common secret${n} other output`));
    storeToolOutputWithChunks({id,created_at:'2999-01-01T00:00:00Z'},['common alpha beta','common alpha only','common beta only','rare punctuation/path.local','phrase alpha beta common']);
  }).immediate();
  const baseline=db.prepare("SELECT snippet(tool_outputs_fts,0,'[',']','…',12) AS snippet FROM tool_outputs_fts WHERE tool_outputs_fts MATCH ? AND output_id=? LIMIT ?");
  for(const query of ['common','rare','alpha AND beta','alpha OR beta','alpha NOT beta','"alpha beta"','alpha*','missing']){
    const fts=prepareFtsQuery(query,'or');
    for(const limit of [0,1,3,10]){
      const old=(baseline.all(fts,id,limit) as {snippet:string}[]).map(x=>x.snippet);
      const actual=searchToolOutputSnippets(id,query,limit);
      expect(actual).toHaveLength(old.length);
      for(const snippet of actual){expect(old.length===limit||old.includes(snippet)).toBe(true);expect(snippet).not.toContain('secret');}
      if(old.length<limit)expect(actual.toSorted()).toEqual(old.toSorted());
    }
  }
  expect(searchToolOutputSnippets('search-plan-missing','common')).toEqual([]);
  expect(searchToolOutputSnippets(id,'common',5,{ownerUserId:'other',rootBranchId:'root',sourceBranchId:'source',chatJid:'other',executionKind:'interactive'})).toEqual([]);
  deleteToolOutputById(id);expect(searchToolOutputSnippets(id,'common')).toEqual([]);
});
