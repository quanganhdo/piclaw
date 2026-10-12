import{expect,test}from'bun:test';
import{isAuthenticatedSocketOrigin}from'../../src/addons/authenticated-socket-origin';
test('authenticated socket Origin requires exact scheme/host/port and rejects absent/foreign origins',()=>{
 const make=(origin?:string)=>new Request('https://piclaw.example:8443/agent/addons/test/realtime',{headers:origin?{origin}:{}});
 expect(isAuthenticatedSocketOrigin(make('https://piclaw.example:8443'))).toBe(true);
 for(const origin of[undefined,'null','https://evil.example','http://piclaw.example:8443','https://piclaw.example','https://piclaw.example:8443/path'])expect(isAuthenticatedSocketOrigin(make(origin))).toBe(false);
});
