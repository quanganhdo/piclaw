import {describe,expect,test} from 'bun:test';
import {createWebChannelEndpointContexts} from '../../../../src/channels/web/endpoints/channel-endpoint-context-factory.js';

describe('native context binding generations',()=>{
  test('a binding change during the actual SDK read discards old counts without persisting or falling back',async()=>{
    let generation='old',resolve!:(value:any)=>void,storedReads=0;
    const pendingRead=new Promise<any>(done=>{resolve=done;});
    const channel:any={getContextUsage(){storedReads++;throw Error('Retired host estimate');},agentPool:{getSessionGenerationForChat:()=>generation,getContextUsageForChat:()=>pendingRead}};
    const contexts=createWebChannelEndpointContexts(channel,{defaultChatJid:'chat',defaultAgentId:'default',getIdentitySnapshot:()=>({}as any)});
    const pending=contexts.agentStatus().getContextUsageForChat('chat');generation='new';
    resolve({tokens:95000,contextWindow:100000,percent:95,sessionGeneration:'old',tokensAreAuthoritative:true});
    expect(await pending).toEqual({tokens:null,contextWindow:null,percent:null,sessionGeneration:'new',tokensAreAuthoritative:true});
    expect(storedReads).toBe(0);
  });
  test('each bound chat reads its own SDK context; no cross-chat host cache exists',async()=>{
    const channel:any={getContextUsage(){throw Error('No host cache');},agentPool:{getSessionGenerationForChat:(chat:string)=>chat+':session',getContextUsageForChat:async(chat:string)=>({tokens:chat==='alpha'?10:80,contextWindow:100,percent:chat==='alpha'?10:80,sessionGeneration:chat+':session',tokensAreAuthoritative:true})}};
    const contexts=createWebChannelEndpointContexts(channel,{defaultChatJid:'alpha',defaultAgentId:'default',getIdentitySnapshot:()=>({}as any)});
    expect(await contexts.agentStatus().getContextUsageForChat('alpha')).toMatchObject({tokens:10,sessionGeneration:'alpha:session'});
    expect(await contexts.agentStatus().getContextUsageForChat('beta')).toMatchObject({tokens:80,sessionGeneration:'beta:session'});
    expect(await contexts.agentStatus().getContextUsageForChat('alpha')).toMatchObject({tokens:10,sessionGeneration:'alpha:session'});
  });
});
