import { getAddonRegistrationOwner, retainAddonRegistrationRollback } from './registration-owner';
import type { AuthenticatedAddonSocketRegistration } from './authenticated-socket';
import { AuthenticatedAddonSocketSession } from './authenticated-socket';
interface Entry { path:string; registration: Readonly<AuthenticatedAddonSocketRegistration>; sessions: Set<AuthenticatedAddonSocketSession>; removed: boolean }
const entries = new Map<string, Entry>();
const retired = new Set<Entry>();
/** Owner identity comes from core's validated runtime import, never the registration payload. */
export function registerAuthenticatedWebSocket(registration: AuthenticatedAddonSocketRegistration): () => void {
  const owner=getAddonRegistrationOwner();
  if(!owner)throw Error('Authenticated socket registration requires an installed add-on runtime entry.');
  if(!/^[a-z0-9][a-z0-9-]{0,63}(?:\/[a-z0-9][a-z0-9-]{0,63})*$/.test(registration.path))throw Error('Invalid authenticated socket path.');
  if(['api','web','config'].includes(registration.path.split('/')[0]))throw Error('Reserved authenticated socket path.');
  for(const [field,max]of [['maxMessageBytes',1024*1024],['maxQueuedBytes',4*1024*1024],['maxSessionMs',300000],['maxConnections',16]] as const){const value=registration[field];if(!Number.isSafeInteger(value)||value<=0||value>max)throw Error('Invalid authenticated socket limit: '+field);}
  if(registration.maxQueuedBytes<registration.maxMessageBytes||typeof registration.authorize!=='function'||typeof registration.open!=='function')throw Error('Invalid authenticated socket registration.');
  const path=`/agent/addons/${owner.addonId}/${registration.path}`;
  if(entries.has(path)||[...retired].some(entry=>entry.path===path))throw Error('Duplicate authenticated socket path.');
  const entry:Entry={path,registration:Object.freeze({...registration}),sessions:new Set(),removed:false};entries.set(path,entry);
  const dispose=()=>{if(entry.removed)return;entry.removed=true;entries.delete(path);if(entry.sessions.size)retired.add(entry);for(const session of entry.sessions)void session.close().catch(error=>{recordCleanupFailure(error);});};
  retainAddonRegistrationRollback(dispose);return dispose;
}
const cleanupFailures:unknown[]=[];
function recordCleanupFailure(error:unknown){cleanupFailures.push(error);}
export function reserveAuthenticatedAddonSocket(path:string): {registration:Readonly<AuthenticatedAddonSocketRegistration>;session:AuthenticatedAddonSocketSession}|undefined {
  const entry=entries.get(path);if(!entry||entry.removed)return;
  if(entry.sessions.size>=entry.registration.maxConnections)throw Error('Authenticated socket connection limit reached.');
  const session=new AuthenticatedAddonSocketSession(entry.registration,()=>{entry.sessions.delete(session);if(entry.removed&&!entry.sessions.size)retired.delete(entry);});entry.sessions.add(session);return{registration:entry.registration,session};
}
export function hasAuthenticatedAddonSocket(path:string):boolean{return entries.has(path);}
export function resetAuthenticatedAddonSocketsForTests():void {entries.clear();retired.clear();cleanupFailures.length=0;}
export async function shutdownAuthenticatedAddonSockets():Promise<void>{
 const sessions=[...new Set([...entries.values(),...retired])].flatMap(entry=>{entry.removed=true;if(entry.sessions.size)retired.add(entry);return[...entry.sessions];});entries.clear();
 const results=await Promise.allSettled(sessions.map(session=>session.close()));
 const failure=results.find((r):r is PromiseRejectedResult=>r.status==='rejected');if(failure)throw failure.reason;if(cleanupFailures.length)throw cleanupFailures[0];
}
