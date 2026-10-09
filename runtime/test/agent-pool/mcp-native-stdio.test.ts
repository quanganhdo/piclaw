import { expect, test } from 'bun:test';
import { createNativeStdio } from '../../src/agent-pool/mcp-native-stdio';
test('Native stdio excludes ambient credential variables', async () => {
  const previous = process.env.NATIVE_UNRELATED_SECRET;
  process.env.NATIVE_UNRELATED_SECRET = 'synthetic-do-not-inherit';
  const transport = createNativeStdio({command:process.execPath,args:['--no-env-file','-e',`process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:1,result:{ambient:process.env.NATIVE_UNRELATED_SECRET??null,literal:process.env.NATIVE_LITERAL}})+'\\n');setInterval(()=>{},1000);`],env:{NATIVE_LITERAL:'allowed'}});
  let ready!: (value: unknown) => void;
  const message = new Promise(resolve => ready = resolve);
  transport.onMessage(m => ready(m));
  try {
    await transport.start();
    expect(await message).toEqual({jsonrpc:'2.0',id:1,result:{ambient:null,literal:'allowed'}});
    await transport.close();
  } finally { await transport.close(); if(previous===undefined)delete process.env.NATIVE_UNRELATED_SECRET;else process.env.NATIVE_UNRELATED_SECRET=previous; }
},10000);

test('parent exits before descendant: Native never acknowledges a live process group', async () => {
  const transport=createNativeStdio({command:process.execPath,args:['--no-env-file','-e',`const {spawn}=require('node:child_process');const c=spawn(process.execPath,['--no-env-file','-e','setInterval(()=>{},1000)'],{stdio:['ignore',process.stdout,process.stderr]});process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:1,result:{pid:c.pid}})+'\\n');process.exit(0);`]});
  let ready!:(m:any)=>void;const message=new Promise<any>(r=>ready=r);transport.onMessage(ready);
  await transport.start();const m=await message;await Bun.sleep(30);
  try{await transport.close();expect(()=>process.kill(m.result.pid,0)).toThrow();}
  catch(error){expect(String(error)).toMatch(/cleanup is uncertain|pipes did not close/);}
},10000);

test('closed server input rejects sends without an unhandled pipe error',async()=>{
 const transport=createNativeStdio({command:'/bin/sh',args:['-c',`exec 0<&-; printf '%s\\n' '{"jsonrpc":"2.0","id":1,"result":{"ready":true}}'; sleep 20`]});
 let ready!:(m:any)=>void;const arrived=new Promise<any>(r=>ready=r);transport.onMessage(ready);const errors:Error[]=[];transport.onError(e=>errors.push(e));
 await transport.start();await arrived;await Bun.sleep(30);
 try{await expect(transport.send({jsonrpc:'2.0',id:2,method:'tools/list',params:{padding:'x'.repeat(512*1024)}})).rejects.toBeDefined();await Bun.sleep(10);expect(errors.length).toBeGreaterThan(0);}
 finally{try{await transport.close();}catch(error){expect(error).toBeDefined();}}
},10000);
