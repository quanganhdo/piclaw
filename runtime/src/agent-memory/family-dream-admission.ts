import type Database from 'bun:sqlite';
import { closeSync, constants, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import { clampThinkingLevel, getSupportedThinkingLevels, type Api, type Model } from '@earendil-works/pi-ai';
import type { ModelRuntime, SettingsManager } from '@earendil-works/pi-coding-agent';
import type { AuthenticatedPrincipal } from '../core/access-types.js';
import { readAccessConfig } from '../core/config-access.js';
import { getDataDir,getStoreDir,getWorkspaceDir } from '../core/config-context.js';
import { getExecutionIdentity } from '../core/execution-context.js';
import { requireAccountActor } from '../db/account-administration.js';
import { readAccountModelDefaults } from '../db/account-model-defaults.js';
import { getDb } from '../db/connection.js';
import { ChatAccessDenied } from '../db/session-ownership.js';
import { resolveModelScope } from '../utils/scoped-models.js';
import { runOwnFamilyDreamProposal } from './family-dream-runner.js';

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const safe=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value);
const iso=(value:unknown):value is string=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
function durableDir(path:string){const fd=openSync(path,constants.O_RDONLY|constants.O_DIRECTORY);try{fsyncSync(fd);}finally{closeSync(fd);}}
function atomic(path:string,text:string){mkdirSync(dirname(path),{recursive:true,mode:0o700});const temp=`${path}.tmp-${randomUUID()}`;let fd:number|undefined;try{fd=openSync(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);writeFileSync(fd,text);fsyncSync(fd);closeSync(fd);fd=undefined;renameSync(temp,path);durableDir(dirname(path));}finally{if(fd!==undefined)closeSync(fd);rmSync(temp,{force:true});}}
function claim(path:string,text:string){let fd:number|undefined;try{fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);writeFileSync(fd,text);fsyncSync(fd);closeSync(fd);fd=undefined;durableDir(dirname(path));}catch{throw new ChatAccessDenied();}finally{if(fd!==undefined)closeSync(fd);}}
function parse(path:string,keys:string[]){let value:unknown;try{value=JSON.parse(readFileSync(path,'utf8'));}catch{throw new ChatAccessDenied();}if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||Object.keys(value).some(k=>!keys.includes(k)))throw new ChatAccessDenied();return value as Record<string,unknown>;}
function ownerRoot(workspace:string,owner:string){if(!safe(owner))throw new ChatAccessDenied();const value=resolve(workspace,'notes','users',owner,'dream');if(!value.startsWith(resolve(workspace,'notes','users')+sep))throw new ChatAccessDenied();return value;}
function modelLabel(model:Model<Api>){return `${model.provider}/${model.id}`;}
function text(response:any){if(response?.stopReason==='error'||response?.stopReason==='aborted')throw new ChatAccessDenied();const value=Array.isArray(response?.content)?response.content.filter((v:any)=>v?.type==='text').map((v:any)=>String(v.text??'')).join('\n').trim():'';if(!value)throw new ChatAccessDenied();return value;}
export interface FamilyDreamDispatchCapability {admission_id:string;request_id:string;token:string}
const activeDreamProviders=new Map<string,number>();let activeDreamProvidersGlobal=0;
function acquireProvider(owner:string){if((activeDreamProviders.get(owner)??0)>=1||activeDreamProvidersGlobal>=2)throw new ChatAccessDenied();activeDreamProviders.set(owner,1);activeDreamProvidersGlobal++;let released=false;return ()=>{if(released)return;released=true;activeDreamProviders.delete(owner);activeDreamProvidersGlobal--;};}
export function __resetFamilyDreamProviderCapacityForTests(){if(process.env.NODE_ENV!=='test')throw new Error('test-only');activeDreamProviders.clear();activeDreamProvidersGlobal=0;}

/** Durable admission with one private dispatch capability returned only on first creation. */
export function admitOwnFamilyDreamRun(database:Database,actor:AuthenticatedPrincipal,input:{request_id:string;generation:string;confirm:true},runtime:ModelRuntime,settings:SettingsManager){
  if(!input||Object.keys(input).length!==3||!safe(input.request_id)||!safe(input.generation)||input.confirm!==true||getExecutionIdentity()||readAccessConfig().mode!=='family-shared'||database!==getDb())throw new ChatAccessDenied();const user=requireAccountActor(database,actor,{recent:true}),workspace=getWorkspaceDir(),root=ownerRoot(workspace,user.id);
  const defaults=readAccountModelDefaults(database,user.id);if(defaults.model===null)throw new ChatAccessDenied();const available=resolveModelScope([...runtime.getAvailableSnapshot()],settings).models,matches=available.filter(m=>modelLabel(m)===defaults.model);if(matches.length!==1)throw new ChatAccessDenied();const selected=matches[0]!,levels=getSupportedThinkingLevels(selected),thinking=defaults.thinking_level??clampThinkingLevel(selected,settings.getModelThinkingLevel(selected.provider,selected.id)??settings.getDefaultThinkingLevel()??'medium');if(!levels.includes(thinking))throw new ChatAccessDenied();
  const current=parse(resolve(root,'current.json'),['version','generation','owner_user_id','manifest_sha256','generated_at']);if(current.version!==1||current.owner_user_id!==user.id||current.generation!==input.generation)throw new ChatAccessDenied();const admissions=resolve(root,'admissions'),admissionRoot=resolve(admissions,input.request_id),recordPath=resolve(admissionRoot,'admission.json');
  if(existsSync(recordPath)){const record=parse(recordPath,['version','admission_id','request_id','owner_user_id','generation','model_revision','model','thinking_level','token_hash','created_at']);if(record.request_id!==input.request_id||record.owner_user_id!==user.id||record.generation!==input.generation||record.model_revision!==defaults.revision||record.model!==defaults.model||record.thinking_level!==thinking)throw new ChatAccessDenied();return {receipt:{admission_id:record.admission_id,request_id:input.request_id,generation:input.generation,model:record.model,thinking_level:record.thinking_level,created:false},capability:null};}
  if(!existsSync(admissions)){try{mkdirSync(admissions,{mode:0o700});durableDir(root);}catch{if(!existsSync(admissions))throw new ChatAccessDenied();}}
  const stageRoot=resolve(admissions,`.stage-${input.request_id}-${randomUUID()}`);mkdirSync(stageRoot,{mode:0o700});
  const admissionId=randomUUID(),token=randomBytes(32).toString('base64url'),record={version:1,admission_id:admissionId,request_id:input.request_id,owner_user_id:user.id,generation:input.generation,model_revision:defaults.revision,model:defaults.model,thinking_level:thinking,token_hash:hash(token),created_at:new Date().toISOString()};
  let published=false;try{atomic(resolve(stageRoot,'admission.json'),`${JSON.stringify(record,null,2)}\n`);renameSync(stageRoot,admissionRoot);published=true;durableDir(admissions);}catch(error){rmSync(stageRoot,{recursive:true,force:true});if(!published&&existsSync(recordPath))return admitOwnFamilyDreamRun(database,actor,input,runtime,settings);throw error;}
  return {receipt:{admission_id:admissionId,request_id:input.request_id,generation:input.generation,model:defaults.model,thinking_level:thinking,created:true},capability:Object.freeze({admission_id:admissionId,request_id:input.request_id,token}) as FamilyDreamDispatchCapability};
}

/** Consume admission before provider call; never replay consumed or failed dispatches. */
export async function dispatchOwnFamilyDreamRun(database:Database,actor:AuthenticatedPrincipal,capability:FamilyDreamDispatchCapability,runtime:ModelRuntime,settings:SettingsManager){
  if(!capability||Object.keys(capability).length!==3||!safe(capability.request_id)||typeof capability.admission_id!=='string'||typeof capability.token!=='string'||getExecutionIdentity()||readAccessConfig().mode!=='family-shared'||database!==getDb())throw new ChatAccessDenied();const user=requireAccountActor(database,actor,{recent:true}),root=ownerRoot(getWorkspaceDir(),user.id),admissionRoot=resolve(root,'admissions',capability.request_id),record=parse(resolve(admissionRoot,'admission.json'),['version','admission_id','request_id','owner_user_id','generation','model_revision','model','thinking_level','token_hash','created_at']);
  if(record.version!==1||record.admission_id!==capability.admission_id||record.request_id!==capability.request_id||record.owner_user_id!==user.id||typeof record.token_hash!=='string')throw new ChatAccessDenied();const actual=Buffer.from(hash(capability.token),'hex'),expected=Buffer.from(record.token_hash as string,'hex');if(actual.length!==expected.length||!timingSafeEqual(actual,expected)||existsSync(resolve(admissionRoot,'consumed.json')))throw new ChatAccessDenied();
  const defaults=readAccountModelDefaults(database,user.id);if(defaults.revision!==record.model_revision||defaults.model!==record.model)throw new ChatAccessDenied();const models=resolveModelScope([...runtime.getAvailableSnapshot()],settings).models.filter(m=>modelLabel(m)===record.model);if(models.length!==1)throw new ChatAccessDenied();const expectedThinking=defaults.thinking_level??clampThinkingLevel(models[0]!,settings.getModelThinkingLevel(models[0]!.provider,models[0]!.id)??settings.getDefaultThinkingLevel()??'medium');if(expectedThinking!==record.thinking_level||!getSupportedThinkingLevels(models[0]!).includes(expectedThinking))throw new ChatAccessDenied();
  const release=acquireProvider(user.id);let providerStarted=false;
  try{
    claim(resolve(admissionRoot,'consumed.json'),`${JSON.stringify({version:1,admission_id:record.admission_id,request_id:record.request_id,owner_user_id:user.id,generation:record.generation,consumed_at:new Date().toISOString()},null,2)}\n`);
    const runnerRequest=`admit-${String(record.admission_id).replaceAll('-','')}`;const result=await runOwnFamilyDreamProposal(database,actor,{request_id:runnerRequest,generation:record.generation as string},async request=>{providerStarted=true;try{const pending=runtime.completeSimple(models[0]!,{systemPrompt:request.system,messages:[{role:'user',content:[{type:'text',text:request.user}],timestamp:Date.now()}]},{signal:request.signal,reasoning:record.thinking_level as any,cacheRetention:'none',maxTokens:4096});return text(await pending);}finally{release();}});
    return {...result,admission_id:record.admission_id};
  }catch(error){if(!providerStarted)release();throw error;}
}
