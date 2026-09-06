import {createHash} from 'node:crypto';
export function adoptedJsonl(cwd:string,parentSession:string) {
  const now='2026-09-06T00:00:00.000Z';
  const message={role:'assistant',content:[{type:'text',text:'ADOPTED_PRIVATE'}],api:'anthropic-messages',provider:'test',model:'fixture',usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:1};
  const rows:any[]=[{type:'session',version:3,id:'original-child',timestamp:now,cwd,parentSession},
    {type:'model_change',id:'model',parentId:null,timestamp:now,provider:'test',modelId:'fixture'},
    {type:'thinking_level_change',id:'thinking',parentId:'model',timestamp:now,thinkingLevel:'high'},
    {type:'message',id:'user',parentId:'thinking',timestamp:now,message:{role:'user',content:'original question',timestamp:1}},
    {type:'message',id:'assistant',parentId:'user',timestamp:now,message},
    {type:'custom',id:'custom',parentId:'assistant',timestamp:now,customType:'state',data:{original:true}},
    {type:'label',id:'label',parentId:'custom',timestamp:now,targetId:'assistant',label:'retained label'},
    {type:'session_info',id:'name',parentId:'label',timestamp:now,name:'old name'}];
  const jsonl=rows.map(row=>JSON.stringify(row)).join('\n')+'\n';
  return {rows,jsonl,sha256:createHash('sha256').update(jsonl).digest('hex')};
}
