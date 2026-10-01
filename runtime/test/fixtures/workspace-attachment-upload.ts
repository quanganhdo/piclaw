import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, statSync, symlinkSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getWorkspaceDir } from '../../src/core/config.js';
import * as config from '../../src/core/config.js';
import { handleWorkspaceAttachmentChunk as handler, readAttachmentChunk } from '../../src/channels/web/media/workspace-attachment-upload.js';
import { DATABASE_ATTACHMENT_MAX_BYTES, UPLOAD_CHUNK_BYTES } from '../../src/core/upload-limits.js';
const ws={workspace:getWorkspaceDir(),base:getWorkspaceDir()};
const cases=new Map<string,()=>Promise<void>|void>();
function test(name:string,run:()=>Promise<void>|void){cases.set(name,run);}
function expect(value:any){return {toBe:(expected:any)=>assert.equal(value,expected),toMatchObject:(expected:any)=>{for(const[k,v]of Object.entries(expected))assert.deepEqual(value[k],v);}};}
const channel = { json: (body: unknown, status = 200) => Response.json(body, {status}) };
const id = 'upload-12345678-1234-1234-1234-123456789012';
const size = DATABASE_ATTACHMENT_MAX_BYTES + 1;

function request(index:number, options:{uploadId?:string;filename?:string;fileSize?:number;data?:Uint8Array}={}) {
  const fileSize=options.fileSize??size;
  const length=Math.min(UPLOAD_CHUNK_BYTES,fileSize-index*UPLOAD_CHUNK_BYTES);
  const data=options.data??new Uint8Array(Math.max(0,length)).fill(index+1);
  return new Request('http://localhost/media/upload-chunk',{method:'POST',headers:{'X-Upload-Id':options.uploadId??id,'X-Chunk-Index':String(index),'X-Chunk-Total':String(Math.ceil(fileSize/UPLOAD_CHUNK_BYTES)),'X-File-Size':String(fileSize),'X-File-Name':encodeURIComponent(options.filename??'large.bin')},body:data});
}

test('large chat attachment completes outside DB and never publishes a partial target', async () => {
  const destination=join(ws.workspace,'uploads',id,'large.bin');
  for(let i=0;i<5;i++){
    const response=await handler(channel,request(i));expect(response.status).toBe(200);
    const body=await response.json();
    if(i<4){expect(body.complete).toBe(false);expect(existsSync(destination)).toBe(false);}
    else expect(body).toMatchObject({complete:true,storage:'workspace',path:`uploads/${id}/large.bin`,size});
  }
  expect(statSync(destination).size).toBe(size);
  const { WorkspaceFileService }=await import('../../src/channels/web/workspace/file-service.js');
  const raw=new WorkspaceFileService().getRaw(`uploads/${id}/large.bin`,true);
  expect(raw.status).toBe(200);expect(raw.size).toBe(size);expect(raw.download).toBe(true);
  const bytes=readFileSync(destination);expect(bytes[0]).toBe(1);expect(bytes[UPLOAD_CHUNK_BYTES]).toBe(2);expect(bytes.at(-1)).toBe(5);
  // Same ID cannot replace the finished attachment; a different ID can use the same filename.
  expect((await handler(channel,request(0))).status).toBe(409);
  expect((await handler(channel,request(0,{uploadId:id+'-other'}))).status).toBe(200);
});

test('full configured 512 MiB boundary succeeds in bounded chunks with no multipart overhead', async () => {
  const fileSize=512*1024*1024;
  const data=new Uint8Array(UPLOAD_CHUNK_BYTES);
  let result:any;
  for(let i=0;i<fileSize/UPLOAD_CHUNK_BYTES;i++){
    const response=await handler(channel,request(i,{fileSize,data}));expect(response.status).toBe(200);result=await response.json();
  }
  expect(result).toMatchObject({storage:'workspace',size:fileSize,complete:true});
  expect(statSync(join(ws.workspace,result.path)).size).toBe(fileSize);
});

test('rejects excess size, malformed names and incorrect chunk bodies/sequences', async () => {
  expect((await handler(channel,request(0,{fileSize:512*1024*1024+1,data:new Uint8Array(0)}))).status).toBe(413);
  expect((await handler(channel,request(0,{fileSize:DATABASE_ATTACHMENT_MAX_BYTES,data:new Uint8Array(0)}))).status).toBe(413);
  for(const filename of ['../escape','nested/file','..','CON','file\nname','..\\escape','trailing.', ' leading', 'line\u2028separator', 'bidi\u202Ename'])expect((await handler(channel,request(0,{filename,data:new Uint8Array(0)}))).status).toBe(400);
  expect((await handler(channel,request(0,{data:new Uint8Array(12)}))).status).toBe(400);
  expect((await handler(channel,request(0,{data:new Uint8Array(UPLOAD_CHUNK_BYTES+1)}))).status).toBe(413);
  expect((await handler(channel,request(1))).status).toBe(409);
  expect((await handler(channel,request(0))).status).toBe(200);
  expect((await handler(channel,request(0))).status).toBe(409);
  expect((await handler(channel,request(1,{filename:'changed.bin'}))).status).toBe(409);
  expect(existsSync(join(ws.workspace,'uploads',id,'large.bin'))).toBe(false);
});

test('rejects symlink upload destinations and does not write outside workspace', async () => {
  const other=join(ws.base,'outside');mkdirSync(other);
  symlinkSync(other,join(ws.workspace,'uploads'),'dir');
  expect((await handler(channel,request(0))).status).toBe(400);
  expect(existsSync(join(other,id))).toBe(false);
});

test('rejects family workspace spillover, staging symlinks and unauthorised routes', async () => {
  // API contract: the shared workspace is never used for family-owned uploads.
  const configPath=config.getConfigPath();mkdirSync(join(ws.workspace,'.piclaw'),{recursive:true});
  writeFileSync(configPath,JSON.stringify({domains:{access:{mode:'family-shared'}}}));
  try { expect((await handler(channel,request(0,{data:new Uint8Array(0)}))).status).toBe(403); }
  finally { writeFileSync(configPath,'{}'); }
  const staging=join(process.env.PICLAW_DATA!,'workspace-upload-chunks');mkdirSync(staging,{recursive:true});
  const outside=join(ws.workspace,'outside-staging');mkdirSync(outside);
  symlinkSync(outside,join(staging,'attachment-'+id),'dir');
  expect((await handler(channel,request(0))).status).toBe(400);
  expect(existsSync(join(outside,'upload.part'))).toBe(false);
});

test('same upload cannot receive concurrent chunks while a body is pending', async () => {
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  const base=request(0);const pendingReq=new Request(base.url,{method:'POST',headers:base.headers,body:new ReadableStream({async start(controller){await gate;controller.enqueue(new Uint8Array(UPLOAD_CHUNK_BYTES));controller.close();}})});
  const pending=handler(channel,pendingReq);
  expect((await handler(channel,request(0))).status).toBe(409);
  release();expect((await pending).status).toBe(200);
});


test('stalled or oversized bodies are cancelled and slots remain bounded', async () => {
  let cancelled=false;
  const stalled=new Request('http://localhost/media/upload-chunk',{method:'POST',body:new ReadableStream({cancel(){cancelled=true;}})});
  await assert.rejects(readAttachmentChunk(stalled,8,10),/timed out/);
  expect(cancelled).toBe(true);
  const releases:Array<()=>void>=[];
  const pending:Promise<Response>[]=[];
  for(let i=0;i<4;i++){
    const base=request(0,{uploadId:id+'-'+i});
    const body=new ReadableStream({start(controller){releases.push(()=>controller.close());}});
    pending.push(handler(channel,new Request(base.url,{method:'POST',headers:base.headers,body})));
  }
  expect((await handler(channel,request(0,{uploadId:id+'-overflow'}))).status).toBe(429);
  // Invalid identifiers are rejected without consuming a fifth slot or reading a body.
  expect((await handler(channel,request(0,{uploadId:'bad'}))).status).toBe(400);
  releases.forEach(release=>release());
  for(const result of await Promise.all(pending))expect(result.status).toBe(400);
  expect((await handler(channel,request(0))).status).toBe(200);
});

test('legacy compose setting is an alias of the common upload limit', () => {
  expect(config.getWebRuntimeConfig().composeUploadLimitMb).toBe(512);
  // Config env override has priority over settings writes, on both aliases.
  expect(config.getWebRuntimeConfig().workspaceUploadLimitMb).toBe(512);
});

const name=process.argv[2];const run=cases.get(name);if(!run)throw Error('Unknown case: '+name);await run();console.log('PASS '+name);
