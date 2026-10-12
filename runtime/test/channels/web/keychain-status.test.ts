import{expect,test}from'bun:test';
import{withTempWorkspaceEnv}from'../../helpers';
import{initDatabase}from'../../../src/db';
import{handleAgentRoutes}from'../../../src/channels/web/http/dispatch-agent';
import{addLogSink,removeLogSink}from'../../../src/utils/logger';
test('disabled keychain API reports availability and writes log no payload or secrets',async()=>{
 await withTempWorkspaceEnv('keychain-status-',{PICLAW_KEYCHAIN_KEY:'',PICLAW_KEYCHAIN_KEY_FILE:''},async()=>{
  initDatabase();const logs:any[]=[];const sink=(entry:any)=>{logs.push(entry);};addLogSink(sink);
  const channel:any={json:(body:any,status=200)=>Response.json(body,{status})};
  try{
   const url=new URL('http://test/agent/keychain');const get=await handleAgentRoutes(channel,new Request(url),url.pathname,url);expect((await get!.json()).status).toEqual({enabled:false,reason:'not_configured'});
   const request=new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'sentinel-name',secret:'sentinel-secret',userNote:'sentinel-note'})});
   const response=await handleAgentRoutes(channel,request,url.pathname,url);expect(response!.status).toBe(400);
   const logged=logs.filter(row=>row.operation==='keychain.write_failed');expect(logged).toHaveLength(1);expect(logged[0].reason).toBe('not_configured');expect(JSON.stringify(logged)).not.toContain('sentinel');
  }finally{removeLogSink(sink);}
 });
});
