import{expect,test}from'bun:test';
import{waitForRuntimeStartup}from'../../src/agent-pool/startup-wait';
test('timeout leaves shared creation available to another waiter and late success',async()=>{
 let release!:(value:string)=>void;const pending=new Promise<string>(resolve=>{release=resolve;});
 const first=waitForRuntimeStartup(pending,5);const second=waitForRuntimeStartup(pending,1000);
 await expect(first).rejects.toThrow('timed out');release('ready');expect(await second).toBe('ready');expect(await pending).toBe('ready');
});
test('caller abort cancels only its wait; late rejection stays observed',async()=>{
 let reject!:(error:Error)=>void;const pending=new Promise<string>((_,r)=>{reject=r;});const caller=new AbortController();
 const waiting=waitForRuntimeStartup(pending,1000,caller.signal);caller.abort();await expect(waiting).rejects.toThrow('cancelled');reject(Error('late creation failure'));await expect(pending).rejects.toThrow('late creation failure');
});
