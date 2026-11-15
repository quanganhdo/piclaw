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

test('malformed frame seals buffered replies and further send admission', async () => {
  const transport = createNativeStdio({ command: process.execPath, args: ['--no-env-file', '-e', `process.stdout.write('not-json\\n'+JSON.stringify({jsonrpc:'2.0',id:1,result:{forbidden:true}})+'\\n');setInterval(()=>{},1000);`] });
  const received: unknown[] = [];
  const errors: Error[] = [];
  let closed!: () => void;
  const ended = new Promise<void>(resolve => closed = resolve);
  transport.onMessage(message => received.push(message));
  transport.onError(error => errors.push(error));
  transport.onClose(closed);
  try {
    await transport.start();
    await ended;
    expect(received).toEqual([]);
    expect(errors.map(error => error.message)).toEqual(['Native MCP server returned malformed JSON.']);
    await expect(transport.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).rejects.toThrow('Native stdio is closed.');
  } finally { await transport.close(); }
}, 10000);

test('Native stdio checks ownership before spawning', async () => {
  const denied = Error('spawn authority revoked');
  let checks = 0;
  const transport = createNativeStdio({ command: '/definitely-not-an-executable', assertStart() { checks++; throw denied; } });
  const errors: Error[] = [];
  transport.onError(error => errors.push(error));
  await expect(transport.start()).rejects.toBe(denied);
  expect(checks).toBe(1);
  expect(errors).toEqual([]); // No spawn error: the process was never attempted.
  await transport.close();
});

test('Native stdio rechecks authority before writing without sending denied bytes', async () => {
  let allowed = true;
  const denied = Error('send authority revoked');
  const checked: unknown[] = [];
  const transport = createNativeStdio({ command: process.execPath, args: ['--no-env-file', '-e', `let data='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{data+=chunk;let i;while((i=data.indexOf('\\n'))>=0){const m=JSON.parse(data.slice(0,i));data=data.slice(i+1);process.stdout.write(JSON.stringify(m)+'\\n');}});`], assertSend(message) { checked.push(message); if (!allowed) throw denied; } });
  const received: unknown[] = [];
  let acknowledge!: () => void;
  const response = new Promise<void>(resolve => acknowledge = resolve);
  transport.onMessage(message => { received.push(message); acknowledge(); });
  try {
    await transport.start();
    allowed = false;
    const forbidden = { jsonrpc: '2.0' as const, id: 1, method: 'forbidden' };
    await expect(transport.send(forbidden)).rejects.toBe(denied);
    allowed = true;
    const admitted = { jsonrpc: '2.0' as const, id: 2, method: 'tools/list' };
    await transport.send(admitted);
    await response;
    expect(received).toEqual([admitted]); // Pipe order proves denied bytes did not precede this frame.
    expect(checked).toEqual([forbidden, admitted]);
  } finally { await transport.close(); }
}, 10000);
