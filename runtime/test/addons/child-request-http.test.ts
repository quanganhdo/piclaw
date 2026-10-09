import { expect, test } from 'bun:test';
import { createChildRequestHttp } from '../../src/addons/child-request-http.js';
const endpoint='https://synthetic.invalid/v1/chat/completions';
function gate(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return{promise,resolve};}
function fixture(overrides:Partial<Parameters<typeof createChildRequestHttp>[0]>={}){
 let calls=0,admissions=0;let seen:RequestInit|undefined;const abort=new AbortController();
 const host=createChildRequestHttp({endpoint,maxResponseBytes:100,signal:abort.signal,authorise(){},async beforeSend(){admissions++;},fetch:async(_request,options)=>{calls++;seen=options;return new Response('synthetic');},...overrides});
 return{host,abort,calls:()=>calls,admissions:()=>admissions,options:()=>seen};
}
test('single exact endpoint send waits admission and overrides redirect policy',async()=>{
 const f=fixture();const response=await f.host.fetch(endpoint,{redirect:'follow'});expect(await response.text()).toBe('synthetic');await f.host.finish();expect(f.calls()).toBe(1);expect(f.admissions()).toBe(1);expect(f.options()?.redirect).toBe('manual');
});
test('mutable URL and headers are frozen before asynchronous send admission',async()=>{
 const admission=gate();const url=new URL(endpoint),headers=new Headers({authorization:'synthetic'});let sentUrl='',sentHeader='';
 const f=fixture({beforeSend:()=>admission.promise,fetch:async request=>{const captured=request as Request;sentUrl=captured.url;sentHeader=captured.headers.get('authorization')||'';return new Response('synthetic');}});
 const pending=f.host.fetch(url,{headers});await Bun.sleep(0);url.hostname='changed.invalid';headers.set('authorization','mutated');admission.resolve();const response=await pending;await response.text();await f.host.finish();expect(sentUrl).toBe(endpoint);expect(sentHeader).toBe('synthetic');
});
test('revocation after admission prevents actual send without leaking errors',async()=>{
 let revoked=false;const f=fixture({authorise(){if(revoked)throw Error('PRIVATE_DETAIL');},async beforeSend(){revoked=true;}});
 await expect(f.host.fetch(endpoint)).rejects.toThrow('execution_failed');expect(f.calls()).toBe(0);await expect(f.host.finish()).rejects.toThrow('settlement_failed');
});
test('wrong endpoint and repeated sends are rejected before upstream invocation',async()=>{
 const wrong=fixture();await expect(wrong.host.fetch('https://other.invalid')).rejects.toThrow('execution_failed');expect(wrong.calls()).toBe(0);await expect(wrong.host.finish()).rejects.toThrow('settlement_failed');
 const twice=fixture();const response=await twice.host.fetch(endpoint);await response.text();await expect(twice.host.fetch(endpoint)).rejects.toThrow('execution_failed');expect(twice.calls()).toBe(1);await expect(twice.host.finish()).rejects.toThrow('settlement_failed');
});
test('finish cancels unread body and awaits actual asynchronous cancellation tail',async()=>{
 const tail=gate();let cancelled=false;const f=fixture({fetch:async()=>new Response(new ReadableStream({async cancel(){cancelled=true;await tail.promise;}}))});
 await f.host.fetch(endpoint);let done=false;const finish=f.host.finish().then(()=>{done=true;});await Bun.sleep(0);expect(cancelled).toBe(true);expect(done).toBe(false);tail.resolve();await finish;
});
test('cancellation stops delivery while raw fetch resolution stays tracked',async()=>{
 const raw=gate();let cancelled=false;const f=fixture({fetch:async()=>{await raw.promise;return new Response(new ReadableStream({cancel(){cancelled=true;}}));}});
 const response=f.host.fetch(endpoint);await Bun.sleep(0);f.abort.abort();let done=false;const finish=f.host.finish().then(()=>{done=true;});await Bun.sleep(0);expect(done).toBe(false);raw.resolve();const result=await response;await expect(result.text()).rejects.toThrow('cancelled');await finish;expect(cancelled).toBe(true);
});
test('response byte cap rejects without exposing payload or raw provider diagnostic',async()=>{
 const f=fixture({maxResponseBytes:1});const response=await f.host.fetch(endpoint);await expect(response.text()).rejects.toThrow('execution_failed');await expect(f.host.finish()).rejects.toThrow('settlement_failed');
});
test('redirect response never triggers another send',async()=>{
 let calls=0;const f=fixture({fetch:async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://secret.invalid'}});}});
 await expect(f.host.fetch(endpoint)).rejects.toThrow('execution_failed');expect(calls).toBe(1);await expect(f.host.finish()).rejects.toThrow('settlement_failed');
});
test('finish publishes a shared promise before body cancellation reenters',async()=>{
 let reentrant:Promise<void>|undefined;let host:ReturnType<typeof createChildRequestHttp>;
 const f=fixture({fetch:async()=>new Response(new ReadableStream({cancel(){reentrant=host.finish();}}))});host=f.host;
 await host.fetch(endpoint);const finish=host.finish();await finish;expect(reentrant).toBe(finish);
});
test('failed raw body cancellation fences settlement',async()=>{
 const f=fixture({fetch:async()=>new Response(new ReadableStream({cancel(){throw Error('PRIVATE');}}))});await f.host.fetch(endpoint);await expect(f.host.finish()).rejects.toThrow('settlement_failed');
});
