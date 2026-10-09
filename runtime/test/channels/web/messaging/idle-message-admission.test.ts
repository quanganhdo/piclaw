import {afterEach,expect,test} from 'bun:test';
import {createTempWorkspace,setEnv} from '../../../helpers.js';
import {initDatabase,getDb,closeDatabase} from '../../../../src/db/connection.js';
import {admitWebUserMessage,storeWebMessage} from '../../../../src/channels/web/messaging/message-store.js';
import {createMedia,getMediaById} from '../../../../src/db/media.js';
import {setDeferredQueuedFollowups,getDeferredQueuedFollowups} from '../../../../src/db/chat-cursors.js';
let cleanup:()=>void=()=>{};
afterEach(()=>{closeDatabase();cleanup();});
function fixture(){const ws=createTempWorkspace('idle-admission-');const restore=setEnv({PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data});cleanup=()=>{restore();ws.cleanup();};initDatabase();return getDb();}
const params=(content='ordinary input',mediaIds:number[]=[])=>({chatJid:'web:idle',content,isBot:false,mediaIds,agentId:'default',agentName:'Fixture'});
const channel={broadcastEvent(){}};
const count=(table:string)=>(getDb().query(`SELECT count(*) AS n FROM ${table}`).get() as {n:number}).n;
test('async incoming storage commits media, spill, self-thread and chat metadata once',async()=>{
  fixture();const existing=createMedia('original.txt','text/plain',new TextEncoder().encode('original'));
  const content='long message '.repeat(10000);
  const row=await admitWebUserMessage(channel,params(content,[existing]),{},()=>{},new AbortController().signal);
  expect(row!.id).toBeGreaterThan(0);expect(count('messages')).toBe(1);expect(count('media')).toBe(2);expect(count('message_media')).toBe(2);expect(count('chats')).toBe(1);
  expect(row!.data.thread_id).toBe(row!.id);const media=getDb().query('SELECT id,filename FROM media WHERE id<>?').get(existing) as {id:number;filename:string};expect(media.filename).toMatch(/^message-web-/);expect(new TextDecoder().decode(getMediaById(media.id)!.data)).toBe(content);
});
test('post-mutation authority failure rolls back generated spill, message, links, FTS and metadata',async()=>{
  fixture();let checks=0;
  await expect(admitWebUserMessage(channel,params('spill me '.repeat(15000)),{},()=>{if(++checks===2)throw Error('revoked');},new AbortController().signal)).rejects.toThrow('revoked');
  for(const table of ['messages','media','message_media','chats'])expect(count(table)).toBe(0);
  expect(getDb().query("SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'spill'").all()).toEqual([]);
});
test('before-commit routing failure rolls back storage and is never mistaken for committed input',async()=>{
  fixture();await expect(admitWebUserMessage(channel,params('before commit'),{},()=>{},new AbortController().signal,()=>{throw Error('route changed');})).rejects.toThrow('route changed');expect(count('messages')).toBe(0);expect(count('chats')).toBe(0);
});
test('cancelled or missing incoming media has no durable side effects',async()=>{
  fixture();const abort=new AbortController();abort.abort(Error('cancelled'));
  await expect(admitWebUserMessage(channel,params(),{},()=>{},abort.signal)).rejects.toThrow('cancelled');
  await expect(admitWebUserMessage(channel,params('missing',[99999]),{},()=>{},new AbortController().signal)).rejects.toThrow('unavailable');expect(count('messages')).toBe(0);expect(count('media')).toBe(0);
});
test('synchronous internal storage also rolls back spill media when its transaction fails',()=>{
  fixture();getDb().exec("CREATE TRIGGER deny_message BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT,'denied');END");
  expect(storeWebMessage(channel,params('spill fail '.repeat(14000)))).toBeNull();expect(count('messages')).toBe(0);expect(count('media')).toBe(0);
});
test('confirmed contention rollback retries one stable ID and never leaks generated spill rows',async()=>{
  const db=fixture(),insert=db.prepare.bind(db);let attempts=0;const ids:string[]=[];
  db.prepare=((sql:string)=>{
    if(sql.includes('INSERT INTO messages')){
      const statement=insert(sql);
      return new Proxy(statement,{get(target,key){if(key==='run')return(...args:any[])=>{ids.push(args[0]);if(++attempts===1)throw Object.assign(Error('synthetic contention'),{code:'SQLITE_BUSY'});return target.run(...args);};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
    }
    return insert(sql);
  }) as typeof db.prepare;
  try{const result=await admitWebUserMessage(channel,params('retry-spill '.repeat(15000)),{},()=>{},new AbortController().signal);expect(result.id).toBeGreaterThan(0);}finally{db.prepare=insert;}
  expect(attempts).toBe(2);expect(new Set(ids).size).toBe(1);expect(count('messages')).toBe(1);expect(count('media')).toBe(1);expect(count('message_media')).toBe(1);
});
test('atomic incoming spill and deferred consume share one rollback and commit',async()=>{
  fixture();setDeferredQueuedFollowups('web:idle',[{rowId:-7,queuedContent:'queued',queuedAt:new Date().toISOString()}]);
  const content='consumed-spill '.repeat(15000);
  await expect(admitWebUserMessage(channel,params(content),{consumeDeferredFollowupRowId:-7,beforeDeferredFollowupConsume:()=>{throw Error('fault before consume');}},()=>{},new AbortController().signal)).rejects.toThrow('fault before consume');
  expect(getDeferredQueuedFollowups('web:idle').map(item=>item.rowId)).toEqual([-7]);expect(count('media')).toBe(0);expect(count('messages')).toBe(0);
  const row=await admitWebUserMessage(channel,params(content),{consumeDeferredFollowupRowId:-7,threadId:77},()=>{},new AbortController().signal);
  expect(row.data.thread_id).toBe(77);expect(getDeferredQueuedFollowups('web:idle')).toEqual([]);expect(count('messages')).toBe(1);expect(count('media')).toBe(1);
});
test('postcommit preview failure never retries or prevents committed acknowledgement',async()=>{
  fixture();let publications=0;const broken={get pendingLinkPreviews(){publications++;throw Error('postcommit preview failure');},broadcastEvent(){}};
  const row = await admitWebUserMessage(broken,params('https://example.invalid/fixture'),{},()=>{},new AbortController().signal);
  expect(row!.id).toBeGreaterThan(0);
  expect(count('messages')).toBe(1);expect(count('chats')).toBe(1);expect(publications).toBe(1);
});
test('postcommit SQLITE_BUSY preview and cancellation still return the durable row',async()=>{
  fixture();const abort=new AbortController();let publications=0;
  const broken={get pendingLinkPreviews(){publications++;abort.abort(Error('cancel after commit'));throw Object.assign(Error('postcommit busy'),{code:'SQLITE_BUSY'});},broadcastEvent(){}};
  const row=await admitWebUserMessage(broken,params('https://example.invalid/committed'),{},()=>{},abort.signal);
  expect(row!.id).toBeGreaterThan(0);expect(abort.signal.aborted).toBe(true);expect(count('messages')).toBe(1);expect(publications).toBe(1);
});
