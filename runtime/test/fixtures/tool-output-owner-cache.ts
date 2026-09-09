import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {closeDatabase,getDb,initDatabase} from '../../src/db.js';
import {getUser} from '../../src/db/users.js';
import {createWebSession} from '../../src/db/web-sessions.js';
import {provisionFamilyAccount,updateManagedAccount} from '../../src/db/account-administration.js';
import {resolveRequestPrincipal} from '../../src/channels/web/auth/principal.js';
import {authoriseExecutionIdentity} from '../../src/agent-pool/execution-identity.js';
import {withExecutionIdentity,type ExecutionIdentity} from '../../src/core/execution-context.js';
import {withChatContext} from '../../src/core/chat-context.js';
import {createFakeExtensionApi} from '../extensions/fake-extension-api.js';

function invariant(value:unknown,message:string):asserts value {if(!value)throw new Error(message);}
function actor(id:string){const login=createWebSession(`cache-${id}`,id,3600,'passkey');return resolveRequestPrincipal(new Request('https://family.local',{headers:{cookie:'piclaw_session=x'}}),{mode:'family-shared',authEnabled:true},{getSession:()=>login,getUser:()=>getUser(getDb(),id),getLocalDisplayName:()=>''})!;}
function identity(who:any){return authoriseExecutionIdentity(getDb(),'family-shared',who.homeChatJid!,{actorUserId:who.userId,ownerUserId:who.userId,chatJid:who.homeChatJid!,kind:'interactive',authenticationSessionId:who.authentication.sessionId!})!;}
function run<T>(snapshot:ExecutionIdentity,call:()=>T|Promise<T>){return withExecutionIdentity(snapshot,()=>withChatContext(snapshot.provenance.chatJid,'web',async()=>call()));}

export async function runOwnerCacheScenario():Promise<void>{
  mkdirSync(join(process.env.PICLAW_WORKSPACE!,'.piclaw'),{recursive:true});writeFileSync(join(process.env.PICLAW_WORKSPACE!,'.piclaw/config.json'),JSON.stringify({domains:{access:{mode:'family-shared'}}}));
  closeDatabase();initDatabase();const admin=actor('default');const users=['alice','bob'].map(name=>{const user=provisionFamilyAccount(getDb(),admin,{username:name,displayName:name});getDb().query("INSERT INTO webauthn_credentials(user_id,rp_id,credential_id,public_key) VALUES (?,'family.local',?,'key')").run(user.id,name);updateManagedAccount(getDb(),admin,user.id,{enabled:true},{totp:false,passkey:true,rpId:'family.local'});return actor(user.id);});
  const mod=await import('../../extensions/integrations/context-mode.js'),fake=createFakeExtensionApi();mod.default(fake.api);mod.__setSemanticToolResultSummarizerForTests(async()=>null);
  const handler=fake.handlers.find(value=>value.event==='tool_result')?.handler;invariant(handler,'missing tool_result handler');const event={toolName:'bash',content:[{type:'text',text:'shared marker\n'.repeat(500)}],details:{},input:{command:'echo'},isError:false};
  const first=await run(identity(users[0]),()=>handler(event,{})),second=await run(identity(users[1]),()=>handler(event,{}));invariant(first?.details?.storedOutputId&&second?.details?.storedOutputId,'missing stored output');invariant(first.details.storedOutputId!==second.details.storedOutputId,'cross-owner cache reuse');invariant(first.details.storedOutputPath===undefined,'family path exposed');invariant(!JSON.stringify(first).includes(process.env.PICLAW_DATA!),'family data path exposed');
  const rows=getDb().query('SELECT owner_user_id,count(*) n FROM tool_outputs GROUP BY owner_user_id').all() as {owner_user_id:string;n:number}[];invariant(rows.length===2&&rows.every(row=>row.n===1),'unexpected owner rows');mod.__setSemanticToolResultSummarizerForTests(null);closeDatabase();console.log('OWNER_CACHE_OK');
}
