import{expect,test}from'bun:test';
import{join}from'node:path';

test('trusted external HTTPS controls cookies and router HSTS; untrusted headers do not',()=>{
 const root=join(import.meta.dir,'../../..');
 for(const trust of ['0','1']){
  const script=`
   const {isSecureWebRequest}=await import('./src/utils/request-client.ts');
   const {buildSessionCookieHeader}=await import('./src/channels/web/auth/session-auth.ts');
   const {RequestRouterService}=await import('./src/channels/web/request-router-service.ts');
   const router=new RequestRouterService({json:(body,status=200)=>Response.json(body,{status})},'single-user');
   router.route=async()=>new Response('test');
   const rows=[];
   for(const [url,headers]of [['http://internal/',{'x-forwarded-proto':'https'}],['http://internal/',{forwarded:'proto=https;host=public.example'}],['http://internal/',{'x-forwarded-proto':'http'}],['https://public.example/',{'x-forwarded-proto':'http'}],['http://internal/',{}],['http://internal/',{'x-forwarded-proto':'HTTPS'}],['http://internal/',{forwarded:'proto="HTTPS";host=public.example'}],['http://internal/',{'x-forwarded-proto':'http',forwarded:'proto=https'}],['http://internal/',{'x-forwarded-proto':'https, http'}],['http://internal/',{origin:'https://public.example','x-forwarded-host':'public.example'}]]){
    const req=new Request(url,{headers});const response=await router.handle(req);rows.push({secure:isSecureWebRequest(req),cookie:buildSessionCookieHeader('synthetic',req,600,false).includes('; Secure'),hsts:response.headers.has('Strict-Transport-Security'),hstsValue:response.headers.get('Strict-Transport-Security')});
   }
   router.route=async()=>new Response('test',{headers:{'Strict-Transport-Security':'max-age=123'}});
   const preserved=(await router.handle(new Request('https://public.example/'))).headers.get('Strict-Transport-Security');
   console.log('RESULT'+JSON.stringify({rows,preserved,tlsCookie:buildSessionCookieHeader('synthetic',new Request('http://internal/'),600,true).includes('; Secure')}));
  `;
  const run=Bun.spawnSync(['bun','--no-env-file','-e',script],{cwd:root,env:{...process.env,PICLAW_TRUST_PROXY:trust},stdout:'pipe',stderr:'pipe'});
  if(run.exitCode!==0)throw Error(run.stderr.toString());expect(run.exitCode).toBe(0);const line=run.stdout.toString().split('\n').find(line=>line.startsWith('RESULT'))!;const data=JSON.parse(line.slice(6));
  expect(data.rows.map((row:any)=>row.secure)).toEqual([trust==='1',trust==='1',false,true,false,trust==='1',trust==='1',false,trust==='1',false]);
  expect(data.rows.every((row:any)=>row.cookie===row.secure&&row.hsts===row.secure)).toBe(true);expect(data.rows.filter((row:any)=>row.hsts).every((row:any)=>row.hstsValue==='max-age=31536000; includeSubDomains')).toBe(true);expect(data.preserved).toBe('max-age=123');expect(data.tlsCookie).toBe(true);
 }
});
