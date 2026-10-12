import{expect,test}from'bun:test';
import{runProcessChatPreflight}from'../../../src/channels/web/runtime/process-chat-preflight-runtime';
test('web preflight hydration timeout cannot resume an abandoned message',async()=>{
 let release!:(session:any)=>void;const hydration=new Promise<any>(resolve=>{release=resolve;});let compactions=0;
 const channel:any={agentPool:{getSessionForIntrospection:()=>hydration}};
 const pending=runProcessChatPreflight({channel,chatJid:'web:slow',message:{id:'synthetic'} as any,prevCursor:'',runStartedAt:Date.now(),streamingHandler:async()=>{},compactionState:{lastCompactionErrorMessage:null,lastCompactionSuppressed:false},log:{info:()=>{},warn:()=>{}},enqueueResume:()=>{throw Error('must not resume');},startupTimeoutMs:5});
 await expect(pending).rejects.toThrow('startup timed out');release({compact:async()=>{compactions++;}});await new Promise(resolve=>setTimeout(resolve,0));expect(compactions).toBe(0);
});
