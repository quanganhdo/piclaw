import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { installServiceWorkSchema } from '../../src/service-effects/current-piclaw/service-work-schema.js';
import { createCurrentPiclawServiceWorkStore } from '../../src/service-effects/current-piclaw/service-work-store.js';
import { hashCanonicalRequest, type CanonicalJsonValue } from '../../src/service-effects/contracts/common.js';
import '../helpers.js';

const at = '2026-10-28T00:00:00.000Z';
function sealed<T extends {effect:{requestHash:string}}>(request:T,method?:string):T {
  request.effect.requestHash=hashCanonicalRequest((method?{method,...request}:request) as unknown as CanonicalJsonValue);return request;
}
function effect(key:string,operationId:string|null=null){return{idempotencyKey:key,requestHash:'',operationId,sourceSeq:1,provenanceRef:'owned-test',redactionClass:'private' as const};}
async function fixture(){
  const db=new Database(':memory:');installServiceWorkSchema(db);
  const made=createCurrentPiclawServiceWorkStore(db,{validateAcceptance:()=>true,recordTrace(){},hitFault(){return false;}});
  if(!made.ok)throw Error('fixture');const work=made.value;
  const accepted=await work.acceptSource(sealed({effect:effect('accept'),chatJid:'chat',sourceId:'input',kind:'message' as const,payloadRef:'payload',targetOperationId:null,parentSourceSeq:null,acceptedAt:at,createWakeIntent:false}));
  expect(accepted.ok).toBe(true);
  const claimed=await work.claimNext(sealed({effect:effect('claim'),chatJid:'chat',expectedFrontier:0,newOperationId:'operation',claimedAt:at}));
  expect(claimed.ok&&claimed.value?.operation.phase).toBe('claimed');
  return{db,work};
}

test('host binds immutable execution identity without persisting an SDK observation',async()=>{
  const f=await fixture();try{
    const request=sealed({effect:{...effect('bind','operation'),operationId:'operation'},expectedVersion:1,sessionId:'session',harnessOperationId:'43'});
    const bound=await f.work.bindHarness(request as any);
    expect(bound.ok).toBe(true);if(!bound.ok)throw Error('bind');
    expect(bound.value.harness).toEqual({sessionId:'session',harnessOperationId:'43'});
    expect(bound.value.phase).toBe('executing'); // host admission phase, not SDK task status
    const before=f.db.query('SELECT * FROM service_effect_s01_operations').all();
    expect(await f.work.bindHarness(request as any)).toEqual(bound);
    expect(f.db.query('SELECT * FROM service_effect_s01_operations').all()).toEqual(before);
    const finished=await f.work.finishHarness(sealed({effect:{...effect('finish','operation'),operationId:'operation'},expectedVersion:bound.value.version,expectedHarness:bound.value.harness!},'finishHarness.v1'));
    expect(finished.ok).toBe(true);if(!finished.ok)throw Error('settlement');
    expect(finished.value.phase).toBe('settling');
    expect(finished.value.harness).toEqual(bound.value.harness);
  }finally{f.db.close();}
});

test('historical decision bytes and hash remain unchanged while their SDK mirrors are inert on replay',async()=>{
  const f=await fixture();try{
    const bound=await f.work.bindHarness(sealed({effect:{...effect('bind','operation'),operationId:'operation'},expectedVersion:1,sessionId:'session',harnessOperationId:'43'}));
    if(!bound.ok)throw Error('bind');
    const request=sealed({effect:{...effect('old-append','operation'),operationId:'operation'},expectedVersion:bound.value.version,intentId:'old-intent',kind:'abort' as const,payloadRef:'old-payload',createdAt:at});
    const result=JSON.stringify({kind:'operation',operation:{...bound.value,harness:{...bound.value.harness,lane:'historical-lane',state:'running',watchGeneration:91}}});
    f.db.query('INSERT INTO service_effect_s01_decisions VALUES(?,?,?,?)').run('old-append','appendIntent',request.effect.requestHash,result);
    const before=f.db.serialize();const replay=await f.work.appendIntent(request);
    expect(replay.ok).toBe(true);if(!replay.ok)throw Error('replay');
    expect(replay.value.harness).toEqual({sessionId:'session',harnessOperationId:'43'});
    expect(f.db.query("SELECT request_hash,result_json FROM service_effect_s01_decisions WHERE idempotency_key='old-append'").get()).toEqual({request_hash:request.effect.requestHash,result_json:result});
    expect(f.db.serialize()).toEqual(before);
  }finally{f.db.close();}
});

test('stale SDK mirror fields cannot become new binding or settlement authority',async()=>{
  const f=await fixture();try{
    const before=f.db.query('SELECT * FROM service_effect_s01_operations').all();
    const stale=sealed({effect:{...effect('stale','operation'),operationId:'operation'},expectedVersion:1,sessionId:'session',harnessOperationId:'43',lane:'main',state:'running',watchGeneration:1});
    expect((await f.work.bindHarness(stale as any)).ok).toBe(false);
    expect(f.db.query('SELECT * FROM service_effect_s01_operations').all()).toEqual(before);
  }finally{f.db.close();}
});
