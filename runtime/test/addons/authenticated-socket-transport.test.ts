import {expect,test} from 'bun:test';
import {WebAuthGateway} from '../../src/channels/web/auth/auth-gateway';
import {initDatabase,createWebSession,deleteAllWebSessions} from '../../src/db';
import {withAddonRegistrationOwner} from '../../src/addons/registration-owner';
import {registerAuthenticatedWebSocket,shutdownAuthenticatedAddonSockets} from '../../src/addons/authenticated-socket-registry';
import {prepareAuthenticatedAddonSocket} from '../../src/addons/authenticated-socket-upgrade';
import {storeChatMetadata} from '../../src/db';
import {ensureChatBranch} from '../../src/db/chat-branches';
initDatabase();
test('real cookie-authenticated Bun socket preserves binary frames and revokes logout',async()=>{
 storeChatMetadata('web:transport','2026-01-01','transport','web',false);ensureChatBranch({chat_jid:'web:transport',agent_name:'transport'});
 const token='disposable-socket-token';createWebSession(token,'default',600,'totp');
 const gateway=new WebAuthGateway({totpSecret:'disposable',sessionTtlSeconds:600,internalSecret:'test-only',passkeyMode:'totp-only',rpName:'Test',enableTotp:true,accessMode:'single-user'},{json:(body,status=200)=>Response.json(body,{status}),getClientKey:()=> 'test',checkCsrfOrigin:()=>true});
 let remove!:()=>void;const frames:Array<string|number[]>=[];
 await withAddonRegistrationOwner({addonId:'transport',packageName:'transport',entryPath:'test'},async()=>{remove=registerAuthenticatedWebSocket({path:'stream',maxMessageBytes:8,maxQueuedBytes:32,maxSessionMs:5000,maxConnections:1,authorize:async()=>({chatJid:'web:transport'}),open:async context=>({message:async frame=>{frames.push(typeof frame==='string'?frame:[...frame]);await context.send(frame);},dispose:async()=>{}})});});
 const server=Bun.serve<any>({hostname:'127.0.0.1',port:0,async fetch(req,server){try{const data=await prepareAuthenticatedAddonSocket(req,new URL(req.url).pathname,gateway);if(server.upgrade(req,{data}))return;}catch{return new Response('denied',{status:403});}return new Response('failed',{status:400});},websocket:{maxPayloadLength:1024*1024,open:ws=>{void ws.data.session.open(ws.data.principal,ws.data.scope,{send:async frame=>{if(ws.send(frame)<=0)throw Error('send rejected');},close:code=>ws.close(code)});},message:(ws,frame)=>{void ws.data.session.message(typeof frame==='string'?frame:new Uint8Array(frame)).catch(()=>ws.close(1008));},close:ws=>{void ws.data.session.close();}}});
 const origin=server.url.origin;
 expect(gateway.getPrincipal(new Request(server.url,{headers:{cookie:'piclaw_session='+token}}),true)?.kind).toBe('user');
 const path='/agent/addons/transport/stream';let socket:WebSocket|undefined;
 try{
  const denied=await fetch(new URL(path,server.url),{headers:{origin,upgrade:'websocket'}});expect(denied.status).toBe(403);
  socket=new WebSocket(new URL(path,server.url).href.replace('http:','ws:'),{headers:{origin,cookie:'piclaw_session='+token}});socket.binaryType='arraybuffer';
  await new Promise<void>((resolve,reject)=>{socket!.onopen=()=>resolve();socket!.onerror=reject;});
  const echoed=new Promise<ArrayBuffer>(resolve=>{socket!.onmessage=event=>resolve(event.data);});socket.send(new Uint8Array([1,2,3]));expect([...new Uint8Array(await echoed)]).toEqual([1,2,3]);expect(frames).toEqual([[1,2,3]]);
  deleteAllWebSessions();const closed=new Promise<void>(resolve=>{socket!.onclose=()=>resolve();});socket.send('revoked');await closed;expect(frames).toEqual([[1,2,3]]);
  await new Promise(resolve=>setTimeout(resolve,0));createWebSession(token,'default',600,'totp');
  socket=new WebSocket(new URL(path,server.url).href.replace('http:','ws:'),{headers:{origin,cookie:'piclaw_session='+token}});
  await new Promise<void>((resolve,reject)=>{socket!.onopen=()=>resolve();socket!.onerror=reject;});
  const oversizedClosed=new Promise<void>(resolve=>{socket!.onclose=()=>resolve();});socket.send(new Uint8Array(9));await oversizedClosed;expect(frames).toEqual([[1,2,3]]);
 }finally{socket?.close();remove();await shutdownAuthenticatedAddonSockets();server.stop(true);deleteAllWebSessions();}
},15000);
