import '../helpers.js';
import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BACKGROUND_CONTEXT, Result } from '@earendil-works/pi-agent-core';
import { withAbortSignal } from '@earendil-works/pi-agent-core/harness/context';
import { PiclawExecutionEnv } from '../../src/service-effects/current-piclaw/execution-env-adapter.js';
import { CurrentPiclawLocalExecutionEnvFactory } from '../../src/service-effects/current-piclaw/local-execution-env.js';
import { CurrentPiclawSshExecutionEnvFactory } from '../../src/service-effects/current-piclaw/ssh-execution-env.js';
import { FakeExecutionEnv } from '../../src/service-effects/testing/fakes/fake-execution-env.js';
import { CurrentPiclawExecutionContextResolver } from '../../src/service-effects/current-piclaw/execution-context-resolver.js';
import { FakeExecutionContextResolver } from '../../src/service-effects/testing/fakes/fake-execution-context-resolver.js';

async function readAll(reader: {readLine(context:typeof BACKGROUND_CONTEXT):Promise<any>}) {
 const lines: unknown[]=[];for(;;){const result=await reader.readLine(BACKGROUND_CONTEXT);expect(result.ok).toBe(true);if(!result.ok||result.value===undefined)break;lines.push(result.value);}return lines;
}
test('fake reader preserves LF, CRLF, empty and torn final lines with stable EOF',async()=>{
 const fake=new FakeExecutionEnv('/remote','ssh-route');fake.putText('file','one\ntwo\r\nlast');fake.putText('empty','');
 const env=new PiclawExecutionEnv(fake,()=>({}));const opened=await env.openTextLineReader('file',BACKGROUND_CONTEXT);expect(opened.ok).toBe(true);if(!opened.ok)return;
 expect(await readAll(opened.value)).toEqual([{text:'one',terminated:true},{text:'two\r',terminated:true},{text:'last',terminated:false}]);
 expect((await opened.value.readLine(BACKGROUND_CONTEXT)).value).toBeUndefined();await opened.value.close(BACKGROUND_CONTEXT);await opened.value.close(BACKGROUND_CONTEXT);
 const closed=await opened.value.readLine(BACKGROUND_CONTEXT);expect(!closed.ok&&closed.error.code).toBe('invalid');
 const empty=await env.openTextLineReader('empty',BACKGROUND_CONTEXT);expect(empty.ok).toBe(true);if(empty.ok){expect((await empty.value.readLine(BACKGROUND_CONTEXT)).value).toBeUndefined();await empty.value.close(BACKGROUND_CONTEXT);}await env.cleanup(BACKGROUND_CONTEXT);
});
test('abort before open, between reads and after close does not leak a record',async()=>{
 const fake=new FakeExecutionEnv('/fixture');fake.putText('file','first\nsecond');const env=new PiclawExecutionEnv(fake,()=>({}));
 const abort=new AbortController();abort.abort();const denied=await env.openTextLineReader('file',withAbortSignal(abort.signal,BACKGROUND_CONTEXT));expect(!denied.ok&&denied.error.code).toBe('aborted');
 const open=await env.openTextLineReader('file',BACKGROUND_CONTEXT);expect(open.ok).toBe(true);if(!open.ok)return;
 expect((await open.value.readLine(BACKGROUND_CONTEXT)).value).toEqual({text:'first',terminated:true});
 const another=new AbortController();another.abort();const result=await open.value.readLine(withAbortSignal(another.signal,BACKGROUND_CONTEXT));expect(!result.ok&&result.error.code).toBe('aborted');
 expect((await open.value.readLine(BACKGROUND_CONTEXT)).value).toEqual({text:'second',terminated:false});
 await env.cleanup(BACKGROUND_CONTEXT);expect(fake.cleanupCalls).toBe(1);expect(!((await open.value.readLine(BACKGROUND_CONTEXT)).ok)).toBe(true);await open.value.close(BACKGROUND_CONTEXT);await env.cleanup(BACKGROUND_CONTEXT);expect(fake.cleanupCalls).toBe(1);
});
test('backend reader faults and malformed records normalize to FileError',async()=>{
 const fake=new FakeExecutionEnv('/remote');fake.putText('file','hello\n');const env=new PiclawExecutionEnv(fake,()=>({}));const absent=await env.openTextLineReader('missing',BACKGROUND_CONTEXT);expect(!absent.ok&&absent.error.code).toBe('not_found');const open=await env.openTextLineReader('file',BACKGROUND_CONTEXT);expect(open.ok).toBe(true);if(!open.ok)return;
 fake.rejectAllFiles=true;const fault=await open.value.readLine(BACKGROUND_CONTEXT);expect(!fault.ok&&fault.error.code).toBe('unknown');fake.rejectAllFilesWithThrow=true;const thrown=await open.value.readLine(BACKGROUND_CONTEXT);expect(!thrown.ok&&thrown.error.code).toBe('unknown');await open.value.close(BACKGROUND_CONTEXT);await env.cleanup(BACKGROUND_CONTEXT);
 const missing=await env.openTextLineReader('missing',BACKGROUND_CONTEXT);expect(!missing.ok&&missing.error.code).toBe('aborted');
});
test('local Node 0.85 compatibility reads real file, while injected missing method fails closed',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'piclaw-line-reader-'));
 try{
  await writeFile(join(cwd,'records.jsonl'),'a\nb\r\nlast');
  const local=new CurrentPiclawLocalExecutionEnvFactory({cwd,prepareShellEnvironment:()=>({})}).createLocalEnv();expect(local.ok).toBe(true);if(local.ok){const open=await (local.value as any).openTextLineReader('records.jsonl',BACKGROUND_CONTEXT);expect(open.ok).toBe(true);if(open.ok){expect(await readAll(open.value)).toEqual([{text:'a',terminated:true},{text:'b\r',terminated:true},{text:'last',terminated:false}]);await open.value.close(BACKGROUND_CONTEXT);}await local.value.cleanup(BACKGROUND_CONTEXT);}
  const injected=new CurrentPiclawLocalExecutionEnvFactory({cwd,prepareShellEnvironment:()=>({}),createNodeEnv:()=>{const fake=new FakeExecutionEnv(cwd);(fake as any).openTextLineReader=undefined;return fake;}});
  const missing=await injected.createLocalEnv();expect(missing.ok).toBe(false);
 }finally{await rm(cwd,{recursive:true,force:true});}
});
test('current and fake resolver inventories reject a missing or unstable reader before returning context',async()=>{
  const request={chatJid:'web:default',operationId:'op',expectedOperationVersion:1,requestedRoute:'local' as const};
  for(const Resolver of [CurrentPiclawExecutionContextResolver,FakeExecutionContextResolver]) {
    for(const unstable of [false,true]) {
      const env=new FakeExecutionEnv('/fixture');let calls=0;
      if(unstable)Object.defineProperty(env,'openTextLineReader',{get(){calls++;return () => Promise.resolve(Result.ok(undefined));}});
      else (env as any).openTextLineReader=undefined;
      const resolver=new Resolver({getOperationSnapshot:()=>({chatJid:'web:default',operationId:'op',version:1})},{getCurrentRoute:()=>({kind:'local'})},{getSshProfile:()=>null},{createLocalEnv:()=>Result.ok(env as any)},{createSshEnv:()=>Result.err({_tag:'environment_unavailable',certainty:'not_applied',retryable:false})} as any);
      const result=await resolver.resolve(request);
      expect(result.ok).toBe(false);expect(!result.ok&&result.error._tag).toBe('environment_unavailable');
      expect(env.cleanupCalls).toBe(1);if(unstable)expect(calls).toBe(2);
    }
  }
});
test('SSH factory preserves captured remote reader and rejects missing or unstable method',async()=>{
 const profile={profileId:'ssh-1',transportRef:'keychain/fixture',cwd:'/remote'};
 const fake=new FakeExecutionEnv('/remote','ssh-1');fake.putText('file','remote\n');
 const factory=new CurrentPiclawSshExecutionEnvFactory(()=>Result.ok(fake),()=>({}));const ready=await factory.createSshEnv(profile);expect(ready.ok).toBe(true);if(ready.ok){const open=await (ready.value as any).openTextLineReader('file',BACKGROUND_CONTEXT);expect(open.ok).toBe(true);if(open.ok){expect((await open.value.readLine(BACKGROUND_CONTEXT)).value).toEqual({text:'remote',terminated:true});await open.value.close(BACKGROUND_CONTEXT);}await ready.value.cleanup(BACKGROUND_CONTEXT);}
 const absent=new FakeExecutionEnv('/remote');(absent as any).openTextLineReader=undefined;expect((await new CurrentPiclawSshExecutionEnvFactory(()=>Result.ok(absent),()=>({})).createSshEnv(profile)).ok).toBe(false);expect(absent.cleanupCalls).toBe(1);
 const unstable=new FakeExecutionEnv('/remote');let reads=0;Object.defineProperty(unstable,'openTextLineReader',{get(){reads++;return () => Promise.resolve(Result.ok(undefined));}});expect((await new CurrentPiclawSshExecutionEnvFactory(()=>Result.ok(unstable),()=>({})).createSshEnv(profile)).ok).toBe(false);expect(reads).toBe(2);
});
