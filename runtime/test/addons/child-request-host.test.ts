import {expect,test} from 'bun:test';
import {createChildRequestsApi} from '../../src/addons/child-request-host.js';
import type {ChildRequestScopeV1} from '../../src/addons/child-request-contracts.js';
const scope:ChildRequestScopeV1={plan:{version:1,execution:'parent-provider-proxy',model:{provider:'fixture',id:'fixture'},mcp:'none'},stream(){throw Error('unused');},async close(){}};
const input=()=>({model:{provider:'fixture',id:'fixture'},signal:new AbortController().signal,deadlineAt:Date.now()+5000});
test('public host factory captures owning addon once and never accepts wire owner IDs',()=>{
 let owner:string|null='delegate';let captured='';const api=createChildRequestsApi({createScope(addonId){captured=addonId;return scope;}},()=>owner);const registered=api.register();owner='other';expect(registered.createScope(input())).toBe(scope);expect(captured).toBe('delegate');expect(api.version).toBe(1);
});
test('uninstalled provider host and missing startup owner fail closed',()=>{
 expect(()=>createChildRequestsApi(null,()=> 'delegate').register()).toThrow('unavailable');expect(()=>createChildRequestsApi({createScope(){return scope;}},()=>null).register()).toThrow('unavailable');
});
test('required MCP and expired/cancelled invocation reject before trusted host starts',()=>{
 let calls=0;const api=createChildRequestsApi({createScope(){calls++;return scope;}},()=> 'delegate').register();
 expect(()=>api.createScope({...input(),requireMcp:true})).toThrow('unavailable');expect(()=>api.createScope({...input(),deadlineAt:0})).toThrow('unavailable');const abort=new AbortController();abort.abort(Error('cancelled'));expect(()=>api.createScope({...input(),signal:abort.signal})).toThrow('cancelled');expect(calls).toBe(0);
});
