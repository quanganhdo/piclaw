import {expect,test} from 'bun:test';
import {Database} from 'bun:sqlite';
import {createNativeTurnView} from '../../../src/channels/web/agent/native-turn-view.js';

test('reattachment reconstructs an exact late intent-only SDK run from bound source identity',()=>{
 const db=new Database(':memory:');try{
  db.exec(`CREATE TABLE piclaw_durable_bindings_v1(operation_id,source_seq,source_id,chat_jid,conversation_id,submission_id);
   CREATE TABLE piclaw_durable_intent_bindings_v1(operation_id,chat_jid,conversation_id,submission_id);
   CREATE TABLE service_effect_s01_operations(operation_id,primary_source_seq);CREATE TABLE messages(id,chat_jid,thread_id);
   INSERT INTO service_effect_s01_operations VALUES('operation',1);INSERT INTO messages VALUES('primary','chat',NULL);
   INSERT INTO piclaw_durable_bindings_v1 VALUES('operation',1,'primary','chat',2,3);
   INSERT INTO piclaw_durable_intent_bindings_v1 VALUES('operation','chat',2,9);`);
  const events:any[]=[];const render=createNativeTurnView(db,{broadcastEvent(event,data){events.push({event,data});}},'chat');
  render({conversation:{id:2},entries:[],docs:{'pi.live':{run:{taskId:44,inputs:[9]},generation:{message:{role:'assistant',content:[{type:'text',text:'resumed intent'}]}},tools:[{callId:'tool',name:'read',status:'running',arguments:{path:'owned'}}]}}});
  expect(events.some(e=>e.event==='agent_draft'&&e.data.text==='resumed intent')).toBe(true);
  expect(events.some(e=>e.event==='agent_status'&&e.data.tool_name==='read')).toBe(true);
  expect(events.every(e=>e.data.operation_id==='operation'&&e.data.turn_id==='durable:1')).toBe(true);
  const before=events.length;
  const foreign=createNativeTurnView(db,{broadcastEvent(){throw Error('Foreign scope must not publish');}},'chat');
  foreign({conversation:{id:99},entries:[],docs:{'pi.live':{run:{taskId:45,inputs:[9]}}}});
  expect(events).toHaveLength(before);
 }finally{db.close();}
});
