import { expect,test } from 'bun:test';
import { startRuntimeLoop } from '../../src/runtime/coordinator.js';
import type { MessageLoopDeps } from '../../src/runtime/message-loop.js';

test('coordinator passes only readonly polling state and lifetime, never a worker or pool',async()=>{
  const state={} as MessageLoopDeps['state'],controller=new AbortController();
  let received:MessageLoopDeps|undefined,signal:AbortSignal|undefined;
  await startRuntimeLoop({state,assistantName:'Pi',pollIntervalMs:1234,signal:controller.signal,
    runMessageLoopFn:async(deps,current)=>{received=deps;signal=current;}});
  expect(signal).toBe(controller.signal);
  expect(received).toEqual({state,assistantName:'Pi',pollIntervalMs:1234});
  for(const key of ['agentPool','queue','processMessages'])expect(received).not.toHaveProperty(key);
});
