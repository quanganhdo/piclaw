import {expect,test}from'bun:test';
import {createNativeHttp}from'../../src/agent-pool/mcp-native-http';
test('Native HTTP close joins a held response body',async()=>{
 let entered!:()=>void;const arrived=new Promise<void>(r=>entered=r);
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){entered();return new Response(new ReadableStream({start(){},cancel(){}}),{headers:{'content-type':'application/json'}});}});
 const transport=createNativeHttp(server.url.href,{Authorization:'Bearer synthetic'});
 try{await transport.start();const send=transport.send({jsonrpc:'2.0',id:1,method:'initialize',params:{}});void send.catch(error=>{expect(error).toBeDefined();});await arrived;await transport.close();await Promise.allSettled([send]);}
 finally{await transport.close();server.stop(true);}
},10000);
test('Native HTTP bounds JSON response before unrestricted decode',async()=>{
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){return new Response(' '.repeat(1024*1024+1),{headers:{'content-type':'application/json'}});}});
 const transport=createNativeHttp(server.url.href,{Authorization:'Bearer synthetic'});
 try{await transport.start();await expect(transport.send({jsonrpc:'2.0',id:1,method:'initialize',params:{}})).rejects.toThrow('1 MiB');}
 finally{await transport.close();server.stop(true);}
},10000);
test('RPC cancellation aborts a held HTTP body without closing the whole transport',async()=>{
 let entered!:()=>void;const arrived=new Promise<void>(r=>entered=r);
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){entered();return new Response(new ReadableStream({start(){}}),{headers:{'content-type':'application/json'}});}});
 const transport=createNativeHttp(server.url.href,{Authorization:'Bearer synthetic'});
 try{await transport.start();const send=transport.send({jsonrpc:'2.0',id:9,method:'tools/call',params:{}});void send.catch(error=>{expect(error).toBeDefined();});await arrived;await transport.send({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:9}});await expect(send).rejects.toBeDefined();}
 finally{await transport.close();server.stop(true);}
},10000);
