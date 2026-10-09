
import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { OAuthCredential, Provider } from '@earendil-works/pi-ai';
import { FileCredentialStore } from '../../src/agent-pool/credential-store.js';
import { createTempWorkspace } from '../helpers.js';

test('released 1.1.0 cancellation rejects delivery but preserves late rotated refresh tokens', async () => {
 const ws=createTempWorkspace('pi103-refresh-');
 const credentials=new FileCredentialStore(join(ws.base,'agent/auth.json'));
 const old:OAuthCredential={type:'oauth',access:'synthetic-old-access',refresh:'synthetic-old-refresh',expires:1};
 const next:OAuthCredential={type:'oauth',access:'synthetic-new-access',refresh:'synthetic-new-refresh',expires:Date.now()+3600000};
 let release!:()=>void,started!:()=>void,refreshes=0,rawDone=false,rawSignal:AbortSignal|undefined,waiting:Promise<unknown>|undefined;
 const gate=new Promise<void>(r=>release=r),entered=new Promise<void>(r=>started=r);
 const provider:Provider={id:'synthetic-pi103-cancelled-refresh',name:'Synthetic gated refresh',auth:{oauth:{name:'Synthetic',login:async()=>old,refresh:async(_credential,signal)=>{refreshes++;rawSignal=signal;started();await gate;rawDone=true;return next;},toAuth:async c=>({apiKey:c.access})}},getModels:()=>[],stream:()=>{throw Error('No provider stream allowed')},streamSimple:()=>{throw Error('No provider stream allowed')}};
 try {
  await credentials.modify(provider.id,async()=>old);
  const runtime=await ModelRuntime.create({credentials,modelsPath:null,refreshOnCreate:false,allowModelNetwork:false});
  runtime.registerNativeProvider(provider);await runtime.refresh({allowNetwork:false});
  const controller=new AbortController();waiting=runtime.getAuth(provider.id,{signal:controller.signal});
  const observed=waiting.then(()=>({resolved:true,error:null}),error=>({resolved:false,error}));
  await entered;controller.abort(new DOMException('Synthetic request cancelled','AbortError'));
  const outcome=await observed;expect(outcome.resolved).toBe(false);expect(rawDone).toBe(false);
  expect(rawSignal?.aborted).toBe(false); // raw refresh has its own timeout, not the delivery signal.
  release();expect((await credentials.read(provider.id))).toEqual(next);
  const reopened=await ModelRuntime.create({credentials:new FileCredentialStore(credentials.authPath),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false});
  reopened.registerNativeProvider(provider);await reopened.refresh({allowNetwork:false});
  expect((await reopened.getAuth(provider.id))?.auth.apiKey).toBe(next.access);expect(refreshes).toBe(1);
 } finally {
  release?.();await waiting?.then(()=>({resolved:true}),error=>({resolved:false,error}));
  // A synthetic resolver may still hold the backing store after delivery
  // rejection; acquire its lock to drain refresh/persistence before cleanup.
  await credentials.read(provider.id);ws.cleanup();
 }
},10000);
