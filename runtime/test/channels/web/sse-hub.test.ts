import { expect, test } from "bun:test";

import { SseHub } from "../../../src/channels/web/sse/sse-hub.js";

test("SseHub.closeAll clears clients even when a controller throws on close", () => {
  const hub = new SseHub();
  const heartbeatA = setInterval(() => {}, 1000);
  const heartbeatB = setInterval(() => {}, 1000);

  hub.clients.add({ controller: { close: () => { throw new Error("already closed"); } }, heartbeat: heartbeatA } as any);
  hub.clients.add({ controller: { close: () => undefined }, heartbeat: heartbeatB } as any);

  expect(() => hub.closeAll()).not.toThrow();
  expect(hub.clients.size).toBe(0);
});

test('pin invalidation reaches only the matching account or operator, independent of chat',()=>{
 const hub=new SseHub();const received:Record<string,string[]>={a:[],a2:[],b:[],operator:[],revoked:[]};
 for(const key of Object.keys(received))hub.clients.add({controller:{enqueue:(bytes:Uint8Array)=>received[key].push(new TextDecoder().decode(bytes)),close:()=>{}} as any,heartbeat:setInterval(()=>{},60000),chatJid:'web:'+key,...(key==='operator'?{}:{authorisation:{chatJid:'web:'+key,userId:key==='a2'?'a':key,isAuthorised:()=>key!=='revoked'}})});
 try{
  hub.broadcast('picker_pins_changed',{user_id:'a'});expect(received.a).toHaveLength(1);expect(received.a2).toHaveLength(1);expect(received.b).toEqual([]);expect(received.operator).toEqual([]);expect(received.revoked).toEqual([]);expect(received.a[0]).toBe('event: picker_pins_changed\ndata: {}\n\n');
  hub.broadcast('picker_pins_changed',{operator:true});expect(received.operator).toHaveLength(1);expect(received.a).toHaveLength(1);
  hub.broadcast('unknown_global',{operator:true});expect(received.a).toHaveLength(1);
 }finally{hub.closeAll();}
});
