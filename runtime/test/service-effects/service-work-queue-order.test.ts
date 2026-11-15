import { expect, test } from 'bun:test';
import { createCurrentPiclawServiceWorkStore } from '../../src/service-effects/current-piclaw/service-work-store.js';
import { hashCanonicalRequest, type CanonicalJsonValue } from '../../src/service-effects/contracts/common.js';
import { openSqliteSubject } from './terminal-settlement-test-support.js';
import { computeClosedSourceFrontier } from '../../src/service-effects/current-piclaw/source-frontier.js';

function seal<T extends { effect: { requestHash: string } }>(request:T):T {
  request.effect.requestHash=hashCanonicalRequest(request as unknown as CanonicalJsonValue); return request;
}
function fixture() {
  const subject=openSqliteSubject(':memory:',[],false); const db=subject.database;
  let order:readonly string[]=[];
  const made=createCurrentPiclawServiceWorkStore(db,{hitFault:()=>false,recordTrace(){},validateAcceptance:()=>true,pendingQueuedSourceOrder:()=>order});
  if(!made.ok)throw Error('fixture'); const work=made.value;
  const effect=(key:string,seq:number|null=null)=>({idempotencyKey:key,requestHash:'',operationId:null,sourceSeq:seq,provenanceRef:'host',redactionClass:'private' as const});
  const accept=(id:string,queued=true)=>db.transaction(()=>work.acceptSourceInTransaction(seal({effect:effect('accept:'+id),chatJid:'web:order',sourceId:id,kind:'message' as const,payloadRef:queued?`queued-source:${id}`:'message-row:1',targetOperationId:null,parentSourceSeq:null,acceptedAt:'2026-10-22T21:00:00.000Z',createWakeIntent:false}),db))();
  const claim=(id:string,seq:number)=>work.claimNext(seal({effect:effect('claim:'+id,seq),chatJid:'web:order',expectedFrontier:0,newOperationId:id,claimedAt:'2026-10-22T21:00:00.000Z'}));
  return {subject,db,work,accept,claim,setOrder:(next:readonly string[])=>{order=next;}};
}
test('native claims persisted queue priority without rewriting accepted identities; stale order fails closed',async()=>{
  const f=fixture(); try {
    const a=f.accept('a'), b=f.accept('b');
    const before=f.db.query('SELECT * FROM service_effect_s01_sources ORDER BY source_seq').all();
    f.setOrder(['stale', 'b','a']);
    const frontier=await f.work.getChatFrontier('web:order');expect(frontier.ok&&frontier.value.nextPendingSourceSeq).toBe(b.sourceSeq);
    const stale=await f.claim('stale-order',a.sourceSeq);expect(stale.ok).toBe(false);
    expect(f.db.query('SELECT * FROM service_effect_s01_sources ORDER BY source_seq').all()).toEqual(before);
    const claimed=await f.claim('b-operation',b.sourceSeq);
    expect(claimed.ok&&claimed.value?.source.sourceId).toBe('b');
    expect(claimed.ok&&claimed.value?.operation.primarySourceSeq).toBe(b.sourceSeq);
    expect(f.work.getAcceptedSource('web:order','a')?.state).toBe('pending');
    expect(computeClosedSourceFrontier(f.db,'web:order',0,3)).toBe(0);
    // Terminal source state must not advance the recovery frontier over pending a.
    f.db.query("UPDATE service_effect_s01_sources SET state='consumed' WHERE source_id='b'").run();
    expect(computeClosedSourceFrontier(f.db,'web:order',0,3)).toBe(0);
    f.db.query("UPDATE service_effect_s01_sources SET state='consumed' WHERE source_id='a'").run();
    expect(computeClosedSourceFrontier(f.db,'web:order',0,3)).toBe(2);
  } finally {f.subject.dispose?.();}
});
test('priority cannot jump an ordinary input barrier or select an unknown source',async()=>{
  const f=fixture(); try {
    const a=f.accept('a'), barrier=f.accept('ordinary',false), b=f.accept('b');
    f.setOrder(['b','unknown','a']);
    const frontier=await f.work.getChatFrontier('web:order');expect(frontier.ok&&frontier.value.nextPendingSourceSeq).toBe(a.sourceSeq);
    const result=await f.claim('a-operation',a.sourceSeq);expect(result.ok&&result.value?.source.sourceId).toBe('a');
    expect(f.work.getAcceptedSource('web:order','ordinary')?.sourceSeq).toBe(barrier.sourceSeq);
    expect(f.work.getAcceptedSource('web:order','b')?.sourceSeq).toBe(b.sourceSeq);
  }finally{f.subject.dispose?.();}
});

test('actual terminal settlement closes reordered sources without skipping the pending gap or replaying claims',async()=>{
  const { TERMINAL_HARNESS,terminalRequest }=await import('../../src/service-effects/testing/contract-suites/terminal-settlement-store-contract.js');
  const f=fixture();try{
    const a=f.accept('a'),b=f.accept('b'); f.setOrder(['b','a']);
    for(const source of [b,a]){
      const id='operation:'+source.sourceId;
      const claimed=await f.claim(id,source.sourceSeq);expect(claimed.ok&&claimed.value?.source.sourceId).toBe(source.sourceId);
      const bound=await f.work.bindHarness(seal({effect:{idempotencyKey:'bind:'+id,requestHash:'',operationId:id,sourceSeq:source.sourceSeq,provenanceRef:'host',redactionClass:'private' as const},expectedVersion:1,...TERMINAL_HARNESS}));
      expect(bound.ok).toBe(true);
      const committed=await f.subject.store.commitTerminal(terminalRequest({key:'terminal:'+id,operationId:id,chatJid:'web:order',effectSourceSeq:source.sourceSeq,expectedVersion:2,committedAt:'2026-10-22T21:01:00.000Z',mode:'none',disposition:'failed',sourceDispositions:[{sourceSeq:source.sourceSeq,state:'consumed',reason:'terminal'}]}));
      expect(committed).toMatchObject({ok:true});
      const frontier=await f.work.getChatFrontier('web:order');
      expect(frontier.ok&&frontier.value.activeOperationId).toBeNull();
      expect(frontier.ok&&frontier.value.consumedThroughSourceSeq).toBe(source===b?0:2);
      const replay=await f.claim(id,source.sourceSeq);expect(replay.ok&&replay.value?.operation.operationId).toBe(id);
    }
    expect(f.db.query('SELECT state FROM service_effect_s01_sources ORDER BY source_seq').all()).toEqual([{state:'consumed'},{state:'consumed'}]);
    expect(f.db.query('SELECT COUNT(*) AS n FROM service_effect_s01_operations').get()).toEqual({n:2});
  }finally{f.subject.dispose?.();}
});
