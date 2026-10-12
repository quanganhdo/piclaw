import type { AuthenticatedPrincipal } from '../core/access-types';
import {createLogger} from '../utils/logger';
import {getWorkspaceDir} from '../core/config';
import {getChatBranchByChatJid} from '../db/chat-branches';
import {realpathSync} from 'node:fs';
const log=createLogger('addons.authenticated-socket-upgrade');
import { readAccessConfig } from '../core/config-access';
import { isAuthenticatedSocketOrigin } from './authenticated-socket-origin';
import { reserveAuthenticatedAddonSocket } from './authenticated-socket-registry';
import { admitAddonLocalRequest, withAddonLocalRequest } from './local-context';
import type { AuthenticatedAddonSocketSession } from './authenticated-socket';
export interface AuthenticatedAddonSocketData { kind: 'authenticated-addon'; session: AuthenticatedAddonSocketSession; principal: Readonly<AuthenticatedPrincipal>; scope: Readonly<{chatJid:string;workspaceId?:string}> }
export async function prepareAuthenticatedAddonSocket(request:Request,path:string,auth:{isAuthEnabled():boolean;getPrincipal(request:Request,refresh?:boolean):Readonly<AuthenticatedPrincipal>|null}):Promise<AuthenticatedAddonSocketData>{
 if(request.method!=='GET'||request.headers.get('upgrade')?.toLowerCase()!=='websocket'||!auth.isAuthEnabled()||!isAuthenticatedSocketOrigin(request))throw Error('Authenticated socket access denied.');
 if(readAccessConfig().mode!=='single-user')throw Error('Authenticated add-on sockets do not support this access mode yet.');
 const principal=auth.getPrincipal(request,true);if(!principal||principal.kind!=='user')throw Error('Authenticated socket login required.');
 const reserved=reserveAuthenticatedAddonSocket(path);if(!reserved)throw Error('Authenticated socket route unavailable.');
 const {session,registration}=reserved;
 const onDisconnect=()=>{void session.close().catch(()=>log.warn('Socket disconnected preparation cleanup failed.',{operation:'addon_socket.request_abort'}));};
 request.signal.addEventListener('abort',onDisconnect,{once:true});
 session.signal.addEventListener('abort',()=>request.signal.removeEventListener('abort',onDisconnect),{once:true});
 if(request.signal.aborted)onDisconnect();
 let scopedTarget: {chatJid:string;incarnation:string;workspaceRoot:string}|undefined;
 const stillValid=()=>{
  const fresh=auth.getPrincipal(request,true);
  if(!fresh||fresh.kind!=='user'||fresh.mode!=='single-user'||readAccessConfig().mode!=='single-user'||fresh.userId!==principal.userId||fresh.authentication.sessionId!==principal.authentication.sessionId||session.signal.aborted)return false;
  if(scopedTarget){const branch=getChatBranchByChatJid(scopedTarget.chatJid);if(!branch||branch.archived_at||branch.branch_id!==scopedTarget.incarnation)return false;try{if(realpathSync(getWorkspaceDir())!==scopedTarget.workspaceRoot)return false;}catch(error){log.warn('Socket workspace identity unavailable.',{operation:'addon_socket.workspace_check'});return false;}}
  return true;
 };
 try{
  admitAddonLocalRequest(request,principal,stillValid);
  const preparing=withAddonLocalRequest(request,async context=>{
    if(!context)throw Error('Authenticated socket request scope unavailable.');
    const requested=await registration.authorize({principal,request,signal:session.signal});
    const target=await context.resolveTarget({chatJid:requested.chatJid});
    if(!target||target.chatJid!==requested.chatJid||(requested.workspaceId!==undefined&&requested.workspaceId!==context.workspaceId))throw Error('Authenticated socket scope denied.');
    scopedTarget={chatJid:target.chatJid,incarnation:target.incarnation,workspaceRoot:context.workspaceRoot};
    return Object.freeze({chatJid:target.chatJid,workspaceId:context.workspaceId});
  });
  session.retainPreparation(preparing);
  let rejectAbort!: (reason:unknown)=>void;
  const aborted=new Promise<never>((_,reject)=>{rejectAbort=reject;});
  const onAbort=()=>rejectAbort(Error('Authenticated socket preparation cancelled.'));
  session.signal.addEventListener('abort',onAbort,{once:true});
  let scope:Readonly<{chatJid:string;workspaceId:string}>;
  try{if(session.signal.aborted)onAbort();scope=await Promise.race([preparing,aborted]);}
  finally{session.signal.removeEventListener('abort',onAbort);}
  session.signal.throwIfAborted();if(!stillValid())throw Error('Authenticated socket identity changed.');
  session.monitorAuthorization(stillValid);
  return{kind:'authenticated-addon',session,principal,scope};
 }catch{void session.close().catch(error=>log.warn('Socket preparation cleanup failed.',{operation:'addon_socket.preparation_cleanup'}));throw Error('Authenticated socket preparation failed.');}
}

