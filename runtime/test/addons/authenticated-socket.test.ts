import{expect,test}from'bun:test';
import{AuthenticatedAddonSocketSession,type AuthenticatedAddonSocketRegistration}from'../../src/addons/authenticated-socket';
const principal:any={kind:'user',userId:'fixture',role:'admin',mode:'single-user'};
const transport={send:async()=>{},close(){}};
test('socket retains frame boundaries, ordering and capacity through cleanup',async()=>{
 const frames:(string|Uint8Array)[]=[];let release!:()=>void,disposed=0,capacity=0;const hold=new Promise<void>(r=>release=r);
 const registration:AuthenticatedAddonSocketRegistration={path:'realtime',maxMessageBytes:8,maxQueuedBytes:16,maxConnections:1,maxSessionMs:1000,authorize:async()=>({chatJid:'web:test'}),open:async()=>({message:async m=>{frames.push(m);if(frames.length===1)await hold;},dispose:async()=>{disposed++;}})};
 const session=new AuthenticatedAddonSocketSession(registration,()=>capacity++);await session.open(principal,{chatJid:'web:test'},transport);
 const a=session.message(new Uint8Array([1,2])),b=session.message('json');await Promise.resolve();expect(frames).toHaveLength(1);release();await Promise.all([a,b]);expect(frames).toEqual([new Uint8Array([1,2]),'json']);await session.close();await session.close();expect(disposed).toBe(1);expect(capacity).toBe(1);
});
test('late open after disconnect disposes once and keeps capacity until disposal',async()=>{
 let open!:any,dispose!:()=>void,releases=0;const opening=new Promise<any>(r=>open=r),cleanup=new Promise<void>(r=>dispose=r);
 const session=new AuthenticatedAddonSocketSession({path:'x',maxMessageBytes:8,maxQueuedBytes:8,maxConnections:1,maxSessionMs:1000,authorize:async()=>({chatJid:'web:test'}),open:()=>opening},()=>releases++);
 const started=session.open(principal,{chatJid:'web:test'},transport);const closing=session.close();expect(releases).toBe(0);open({message:async()=>{},dispose:()=>cleanup});await Promise.resolve();expect(releases).toBe(0);dispose();await closing;await started;expect(releases).toBe(1);
});

test('outbound frames are copied and FIFO; empty frames consume finite queue capacity',async()=>{
 let send!:(message:string|Uint8Array)=>Promise<void>;
 let releaseSend!:()=>void;
 const held=new Promise<void>(resolve=>{releaseSend=resolve;});
 const seen:Array<string|number[]>=[];
 const registration={path:'stream',maxMessageBytes:8,maxQueuedBytes:8,maxSessionMs:1000,maxConnections:1,authorize:async()=>({chatJid:'web:a'}),open:async(context:any)=>{send=context.send;return{message:async()=>{},dispose:async()=>{}};}};
 const session=new AuthenticatedAddonSocketSession(registration,()=>{});
 await session.open(principal,{chatJid:'web:a'},{send:async frame=>{seen.push(typeof frame==='string'?frame:[...frame]);await held;},close:()=>{}});
 const binary=new Uint8Array([1,2]);const first=send(binary);binary[0]=9;const second=send('next');
 await Promise.resolve();expect(seen).toEqual([[1,2]]);releaseSend();await Promise.all([first,second]);expect(seen).toEqual([[1,2],'next']);await session.close();
 let finish!:()=>void;const blocked=new Promise<void>(resolve=>{finish=resolve;});
 const empty=new AuthenticatedAddonSocketSession({...registration,maxQueuedBytes:8,open:async()=>({message:async()=>{await blocked;},dispose:async()=>{}})},()=>{});
 await empty.open(principal,{chatJid:'web:a'},{send:async()=>{},close:()=>{}});
 const frames=Array.from({length:8},()=>empty.message(''));const rejected=empty.message('');
 await expect(rejected).rejects.toThrow('limits');finish();await Promise.allSettled(frames);await empty.close();
});

test('revocation fences queued input and output immediately',async()=>{
 let allowed=true;let send!:(message:string)=>Promise<void>;let count=0;
 const registration={path:'stream',maxMessageBytes:8,maxQueuedBytes:8,maxSessionMs:1000,maxConnections:1,authorize:async()=>({chatJid:'web:a'}),open:async(context:any)=>{send=context.send;return{message:async()=>{count++;},dispose:async()=>{}};}};
 const session=new AuthenticatedAddonSocketSession(registration,()=>{});session.monitorAuthorization(()=>allowed);
 await session.open(principal,{chatJid:'web:a'},{send:async()=>{},close:()=>{}});
 const pending=session.message('a');allowed=false;
 await expect(pending).rejects.toThrow('unauthorized');await expect(send('a')).rejects.toThrow('unauthorized');expect(count).toBe(0);await session.close();
});

test('failed disposal retains reserved capacity and close rejection is idempotent',async()=>{
 let released=0,disposed=0;
 const registration={path:'stream',maxMessageBytes:8,maxQueuedBytes:8,maxSessionMs:1000,maxConnections:1,authorize:async()=>({chatJid:'web:a'}),open:async()=>({message:async()=>{},dispose:async()=>{disposed++;throw Error('cleanup failed');}})};
 const session=new AuthenticatedAddonSocketSession(registration,()=>{released++;});await session.open(principal,{chatJid:'web:a'},{send:async()=>{},close:()=>{}});
 await expect(session.close()).rejects.toThrow('cleanup failed');await expect(session.close()).rejects.toThrow('cleanup failed');expect(disposed).toBe(1);expect(released).toBe(0);
});

test('transport close failure preserves a single failed cleanup owner',async()=>{
 let closes=0,releases=0;
 const registration={path:'stream',maxMessageBytes:8,maxQueuedBytes:8,maxSessionMs:1000,maxConnections:1,authorize:async()=>({chatJid:'web:a'}),open:async()=>({message:async()=>{},dispose:async()=>{}})};
 const session=new AuthenticatedAddonSocketSession(registration,()=>{releases++;});await session.open(principal,{chatJid:'web:a'},{send:async()=>{},close:()=>{closes++;throw Error('transport failed');}});
 await expect(session.close()).rejects.toThrow('Authenticated socket cleanup failed.');await expect(session.close()).rejects.toThrow('Authenticated socket cleanup failed.');expect(closes).toBe(1);expect(releases).toBe(0);
});

test('queued frame awaiting opening is fenced after close or revocation',async()=>{
 for(const reason of ['close','revoked']){
  let release!:(value:any)=>void;const held=new Promise<any>(resolve=>{release=resolve;});let calls=0,allowed=true;
  const registration={path:'stream',maxMessageBytes:8,maxQueuedBytes:8,maxSessionMs:1000,maxConnections:1,authorize:async()=>({chatJid:'web:a'}),open:()=>held};
  const session=new AuthenticatedAddonSocketSession(registration,()=>{});session.monitorAuthorization(()=>allowed);const opening=session.open(principal,{chatJid:'web:a'},{send:async()=>{},close:()=>{}});const frame=session.message('early');await Promise.resolve();
  const closing=reason==='close'?session.close():undefined;if(reason==='revoked')allowed=false;
  release({message:async()=>{calls++;},dispose:async()=>{}});await expect(frame).rejects.toThrow('unauthorized');await opening;await closing;expect(calls).toBe(0);await session.close();
 }
});

test('opening deadline aborts immediately but disposes a late handler exactly once',async()=>{
 let release!:(handler:any)=>void;const held=new Promise<any>(resolve=>{release=resolve;});let disposed=0,released=0;
 const registration={path:'expiry',maxMessageBytes:8,maxQueuedBytes:8,maxSessionMs:5,maxConnections:1,authorize:async()=>({chatJid:'web:a'}),open:()=>held};const session=new AuthenticatedAddonSocketSession(registration,()=>{released++;});const opening=session.open(principal,{chatJid:'web:a'},{send:async()=>{},close:()=>{}});
 await new Promise(resolve=>setTimeout(resolve,15));expect(session.signal.aborted).toBe(true);expect(released).toBe(0);release({message:async()=>{},dispose:async()=>{disposed++;}});await opening;await session.close();expect(disposed).toBe(1);expect(released).toBe(1);
});
