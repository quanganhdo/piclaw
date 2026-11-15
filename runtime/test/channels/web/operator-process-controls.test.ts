import { expect, test } from 'bun:test';
import '../../helpers.ts';
import { initDatabase } from '../../../src/db.js';
import { handleAgentMessage } from '../../../src/channels/web/handlers/agent.ts';

for (const name of ['exit','restart']) test(`/${name} dispatches before Goal, queue and harness inspection`, async () => {
  initDatabase(); const calls:string[]=[];
  const forbidden=()=>{throw Error('Harness and queue are permanently stuck');};
  const channel={
    agentPool:{applyControlCommand:async(_chat:string,command:any)=>{calls.push(command.type);return {status:'success',message:'host requested'};},isStreaming:forbidden,isActive:forbidden},
    prepareInputText:forbidden,prepareInputSourceAdmission:forbidden,getAcceptedQueuedSteering:forbidden,
    getQueuedFollowupCount:forbidden,acceptInputSource:forbidden,
    json:(body:unknown,status=200)=>Response.json(body,{status}),
  } as any;
  const response=await handleAgentMessage(channel,new Request('https://fixture/agent/default/message',{method:'POST',body:JSON.stringify({content:`/${name}`})}),'/agent/default/message','web:test','default');
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({command:{status:'success'},ui_only:true,immediate:true});
  expect(calls).toEqual([name]);
});
