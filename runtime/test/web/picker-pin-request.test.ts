import {expect,test} from 'bun:test';
import {requestPickerPins} from '../../web/src/ui/picker-pin-sync.js';

test('pin contention retries the same desired state with one shared deadline then succeeds',async()=>{
  const signals:AbortSignal[]=[];const bodies:unknown[]=[];let attempts=0;
  const request=(async (_url:any,options:any)=>{signals.push(options.signal);bodies.push(options.body);return ++attempts<3?Response.json({error:'busy'},{status:503,headers:{'Retry-After':'1'}}):Response.json({scope:'test',revision:1,models:['fixture/model'],sessions:[]});}) as typeof fetch;
  const result=await requestPickerPins('POST',{action:'set',kind:'model',key:'fixture/model',pinned:true},request);
  expect(attempts).toBe(3);expect(new Set(signals).size).toBe(1);expect(new Set(bodies).size).toBe(1);expect(result.models).toEqual(['fixture/model']);
});
test('pin request never retries authority, rate limit or ambiguous network failures',async()=>{
  for(const status of [400,401,403,409,429,500,503]){
    let attempts=0;const request=(async()=>{attempts++;return Response.json({error:'denied'},{status});}) as typeof fetch;
    await expect(requestPickerPins('POST',{},request)).rejects.toThrow();expect(attempts).toBe(1);
  }
  let attempts=0;const request=(async()=>{attempts++;throw Error('network');}) as typeof fetch;
  await expect(requestPickerPins('POST',{},request)).rejects.toThrow('network');expect(attempts).toBe(1);
});
test('stopping pin lifecycle cancels backoff without another write',async()=>{
  const lifecycle=new AbortController();let attempts=0;
  const request=(async()=>{attempts++;return Response.json({error:'busy'},{status:503,headers:{'Retry-After':'1'}});}) as typeof fetch;
  const pending=requestPickerPins('POST',{},request,lifecycle.signal);await Bun.sleep(0);lifecycle.abort(Error('stopped'));
  await expect(pending).rejects.toThrow('stopped');expect(attempts).toBe(1);
});
test('pin contention has exactly three retries and rejects non-exact Retry-After',async()=>{
  let attempts=0;const busy=(async()=>{attempts++;return Response.json({error:'busy'},{status:503,headers:{'Retry-After':'1'}});}) as typeof fetch;
  await expect(requestPickerPins('POST',{},busy)).rejects.toThrow();expect(attempts).toBe(4);
  for(const retryAfter of ['0','2','tomorrow']){
    let calls=0;const refused=(async()=>{calls++;return Response.json({error:'busy'},{status:503,headers:{'Retry-After':retryAfter}});}) as typeof fetch;
    await expect(requestPickerPins('POST',{},refused)).rejects.toThrow();expect(calls).toBe(1);
  }
});
