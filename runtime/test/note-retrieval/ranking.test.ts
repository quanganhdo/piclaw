import { test, expect } from 'bun:test';
import { planNoteQuery, hasLiteralAnchor, noteLexicalSignals, compareNoteCandidates } from '../../src/note-retrieval/ranking.js';
import { chunkMarkdown, CHUNKER_VERSION } from '../../src/note-retrieval/chunker.js';
import { validateNoteChunk, verifiedNoteSlice, isParentHeading } from '../../src/note-retrieval/reference.js';

test('natural words yield bounded lexical/heading streams while phrases and IDs constrain every stream',()=>{
 const p=planNoteQuery('Where is "Amber Kite" catalogue AK-12 stored?')!;
 expect(p.explicit).toBe(false);expect(p.streams).toHaveLength(3);
 expect(p.anchors).toEqual(['Amber Kite','AK-12']);
 expect(p.streams.every(s=>s.includes('"Amber Kite"')&&s.includes('"AK-12"'))).toBe(true);
 expect(p.streams[2]).toContain('heading :');
 expect(planNoteQuery('a '.repeat(257))).toBeNull();expect(planNoteQuery('the where')).toBeNull();
 expect(planNoteQuery('"bad')).toBeNull();expect(planNoteQuery('x\0y')).toBeNull();
 expect(planNoteQuery(Array.from({length:33},(_,i)=>`word${i}`).join(' '))).toBeNull();
});
test('explicit FTS expressions remain a single unchanged stream',()=>{
 for(const q of ['cobalt AND sunrise','cobalt NOT moonset','heading : "Rinse cycle"','NEAR(cobalt sunrise, 3)','cobalt OR "blue"']){
  const p=planNoteQuery(q)!;expect(p.explicit).toBe(true);expect(p.streams).toEqual([q]);
 }
 expect(planNoteQuery('"Amber Kite" catalogue')!.explicit).toBe(false);
});
test('literal anchor boundaries reject decoys without rejecting sentence punctuation',()=>{
 for(const value of ['AK-120','AK-12B','AK-12.extra','AK-12/old','BAK-12'])expect(hasLiteralAnchor(value,'AK-12')).toBe(false);
 expect(hasLiteralAnchor('Use AK-12.','ak-12')).toBe(true);
 expect(hasLiteralAnchor('Amber-Kite','Amber Kite')).toBe(false);
 expect(hasLiteralAnchor('Amber Kites','Amber Kite')).toBe(false);
});
test('rank bounded coverage then heading evidence before stable BM25/path ties',()=>{
 const p=planNoteQuery('Birch Annex Returns slot')!;
 const row=(path:string,heading:string,text:string,rank:number)=>({path,heading,content:Buffer.from(text).toString('hex'),rank,first_byte:0,chunk_id:path});
 const relevant=row('notes/a.md','Birch Annex / Returns','Use slot C.',-1),decoy=row('notes/b.md','Cedar Annex / Returns','Use slot G.',-10);
 expect(compareNoteCandidates(p,relevant,decoy)).toBeLessThan(0);
 expect(compareNoteCandidates(planNoteQuery('Returns OR slot')!,relevant,decoy)).toBeGreaterThan(0);
 expect(noteLexicalSignals(p,relevant.heading,'Use slot C.')).toEqual({matched_terms:4,heading_terms:3,query_terms:4});
 expect(compareNoteCandidates(p,relevant,{...relevant,path:'notes/z.md'})).toBeLessThan(0);
});
test('parent references must be exact UTF8 byte/line slices and ancestor-only headings',()=>{
 const bytes=Buffer.from('\uFEFF# Guide\r\n\r\n## Birch\r\n### Returns\r\nUse slot C.\r\n');
 const c=chunkMarkdown(bytes,'ns','notes/a.md').chunks[1]!;
 const row={chunk_id:c.chunkId,revision:chunkMarkdown(bytes,'ns','notes/a.md').sourceRevision,path:'notes/a.md',chunker:CHUNKER_VERSION,
  first_byte:c.firstByte,after_last_byte:c.afterLastByte,line_start:c.lineStart,line_end:c.lineEnd,heading:JSON.stringify(c.headingPath),kind:c.kind,content:Buffer.from(c.text).toString('hex').toUpperCase()};
 expect(validateNoteChunk(row,'ns')).toEqual(['Guide','Birch']);expect(verifiedNoteSlice(row,bytes)).toBe('## Birch\r\n');
 expect(()=>validateNoteChunk({...row,first_byte:0},'ns')).toThrow();
 expect(()=>verifiedNoteSlice({...row,content:'00'},bytes)).toThrow();
 expect(isParentHeading('## Birch\r\n',['Guide','Birch'],['Guide','Birch','Returns'])).toBe(true);
 expect(isParentHeading('## Cedar\n',['Guide','Cedar'],['Guide','Birch','Returns'])).toBe(false);
 expect(isParentHeading('## Birch\nprose\n',['Guide','Birch'],['Guide','Birch','Returns'])).toBe(false);
 expect(isParentHeading('Birch\n---\n',['Guide','Birch'],['Guide','Birch','Returns'])).toBe(true);
 expect(isParentHeading('Birch\n\n---\n',['Guide','Birch'],['Guide','Birch','Returns'])).toBe(false);
 expect(isParentHeading('    Birch\n---\n',['Guide','Birch'],['Guide','Birch','Returns'])).toBe(false);
});
