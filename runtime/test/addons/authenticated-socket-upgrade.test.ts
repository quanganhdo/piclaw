import {expect,test} from 'bun:test';
import {withAddonRegistrationOwner} from '../../src/addons/registration-owner';
import {registerAuthenticatedWebSocket} from '../../src/addons/authenticated-socket-registry';
import {prepareAuthenticatedAddonSocket} from '../../src/addons/authenticated-socket-upgrade';
import type {AuthenticatedPrincipal} from '../../src/core/access-types';
import {initDatabase,storeChatMetadata} from '../../src/db';
import {ensureChatBranch,archiveChatBranch} from '../../src/db/chat-branches';
initDatabase();
const principal:AuthenticatedPrincipal={kind:'user',userId:'default',username:'test',displayName:'Test',role:'admin',mode:'single-user',homeChatJid:'web:default',authentication:{method:'session',sessionId:'test-session',expiresAt:null}};
const path='/agent/addons/test-upgrade/stream';
function request(origin='https://test.example'){return new Request('https://test.example'+path,{headers:{origin,upgrade:'websocket'}});}
test('authenticated upgrade validates Origin, principal and host-resolved chat before reserving an open session',async()=>{
 storeChatMetadata('web:socket','2026-01-01','socket','web',false);ensureChatBranch({chat_jid:'web:socket',agent_name:'socket'});
 let dispose!:()=>void;await withAddonRegistrationOwner({addonId:'test-upgrade',packageName:'test-upgrade',entryPath:'test'},async()=>{dispose=registerAuthenticatedWebSocket({path:'stream',maxMessageBytes:8,maxQueuedBytes:8,maxSessionMs:1000,maxConnections:1,authorize:async()=>({chatJid:'web:socket'}),open:async()=>({message:async()=>{},dispose:async()=>{}})});});
 const auth={isAuthEnabled:()=>true,getPrincipal:()=>principal};
 await expect(prepareAuthenticatedAddonSocket(request('https://foreign.example'),path,auth)).rejects.toThrow('denied');
 await expect(prepareAuthenticatedAddonSocket(request(),path,{...auth,getPrincipal:()=>null})).rejects.toThrow('login');
 const data=await prepareAuthenticatedAddonSocket(request(),path,auth);expect(data.scope.chatJid).toBe('web:socket');expect(data.scope.workspaceId).toHaveLength(64);
 await data.session.open(principal,data.scope,{send:async()=>{},close:()=>{}});
 archiveChatBranch('web:socket');
 await expect(data.session.message('revoked')).rejects.toThrow('unauthorized');await data.session.close();dispose();
});

test('disconnect during held authorization aborts promptly but retains capacity until preparation settles',async()=>{
 let remove!:()=>void,release!:()=>void,signal!:AbortSignal;const held=new Promise<void>(resolve=>{release=resolve;});
 await withAddonRegistrationOwner({addonId:'test-disconnect',packageName:'test-disconnect',entryPath:'test'},async()=>{remove=registerAuthenticatedWebSocket({path:'stream',maxMessageBytes:8,maxQueuedBytes:8,maxSessionMs:1000,maxConnections:1,authorize:async context=>{signal=context.signal;await held;return{chatJid:'web:missing'};},open:async()=>({message:async()=>{},dispose:async()=>{}})});});
 const route='/agent/addons/test-disconnect/stream';const controller=new AbortController();const req=new Request('https://test.example'+route,{headers:{origin:'https://test.example',upgrade:'websocket'},signal:controller.signal});
 const pending=prepareAuthenticatedAddonSocket(req,route,{isAuthEnabled:()=>true,getPrincipal:()=>principal});await Promise.resolve();controller.abort();
 await expect(pending).rejects.toThrow('preparation');expect(signal.aborted).toBe(true);
 const {reserveAuthenticatedAddonSocket}=await import('../../src/addons/authenticated-socket-registry');expect(()=>reserveAuthenticatedAddonSocket(route)).toThrow('limit');release();await new Promise(resolve=>setTimeout(resolve,0));
 const reservation=reserveAuthenticatedAddonSocket(route)!;expect(reservation).toBeDefined();await reservation.session.close();remove();
});

test('socket rejects auth-disabled, internal-style principal, unknown chat and workspace mismatch',async()=>{
 const auth={isAuthEnabled:()=>true,getPrincipal:()=>principal};
 await expect(prepareAuthenticatedAddonSocket(request(),path,{...auth,isAuthEnabled:()=>false})).rejects.toThrow('denied');
 await expect(prepareAuthenticatedAddonSocket(request(),path,{...auth,getPrincipal:()=>({...principal,kind:'local' as const})})).rejects.toThrow('login');
 for(const target of [{chatJid:'web:unknown'},{chatJid:'web:socket',workspaceId:'client-supplied'}]){
  storeChatMetadata('web:socket','2026-01-01','socket','web',false);const {getDb}=await import('../../src/db');getDb().run("UPDATE chat_branches SET archived_at=NULL WHERE chat_jid='web:socket'");
  let remove!:()=>void;await withAddonRegistrationOwner({addonId:'denied',packageName:'denied',entryPath:'test'},async()=>{remove=registerAuthenticatedWebSocket({path:'stream',maxMessageBytes:8,maxQueuedBytes:8,maxSessionMs:1000,maxConnections:1,authorize:async()=>target,open:async()=>({message:async()=>{},dispose:async()=>{}})});});
  const route='/agent/addons/denied/stream';await expect(prepareAuthenticatedAddonSocket(new Request('https://test.example'+route,{headers:{origin:'https://test.example',upgrade:'websocket'}}),route,auth)).rejects.toThrow('preparation');remove();await new Promise(resolve=>setTimeout(resolve,0));
 }
});
