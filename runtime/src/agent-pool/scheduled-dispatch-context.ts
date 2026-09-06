import { AsyncLocalStorage } from "node:async_hooks";
import type { ExecutionIdentity, ExecutionProvenance } from "../core/execution-context.js";
import { ChatAccessDenied } from "../db/session-ownership.js";

interface Scope { identity: ExecutionIdentity; prompt: string; validate: () => void; active: boolean; entered: boolean; prompted: boolean }
const storage=new AsyncLocalStorage<Scope>();
function deny(scope:Scope|undefined):never {if(scope)scope.active=false;throw new ChatAccessDenied();}

/** Only the internal dispatcher installs this scope; never derive it from request/model JSON. */
export async function withScheduledDispatch<T>(identity:ExecutionIdentity,prompt:string,validate:()=>void,run:()=>Promise<T>):Promise<T> {
  if(storage.getStore())throw new ChatAccessDenied();
  const scope:Scope={identity,prompt,validate,active:true,entered:false,prompted:false};
  try {return await storage.run(scope,async()=>{const output=await run();
    if(!scope.active||!scope.entered||!scope.prompted)throw new ChatAccessDenied();
    return output;
  });} finally {scope.active=false;}
}
export function hasScheduledDispatch():boolean {return storage.getStore()!==undefined;}
export function authoriseScheduledDispatch(chatJid:string,provenance:ExecutionProvenance|undefined):ExecutionIdentity {
  const scope=storage.getStore(),expected=scope?.identity.provenance;
  if(!scope?.active||!provenance||!expected||provenance.kind!=="scheduled"||provenance.executionId!==expected.executionId
    ||provenance.actorUserId!==expected.actorUserId||provenance.ownerUserId!==expected.ownerUserId
    ||provenance.chatJid!==expected.chatJid||chatJid!==expected.chatJid||provenance.authenticationSessionId!==undefined)deny(scope);
  try {scope.validate();}catch(error){scope.active=false;throw error;}
  return scope.identity;
}
export function enterScheduledDispatch(prompt:string,chatJid:string,provenance:ExecutionProvenance|undefined):void {
  const scope=storage.getStore();authoriseScheduledDispatch(chatJid,provenance);
  if(!scope||scope.entered||prompt!==scope.prompt)deny(scope);
  scope.entered=true;
}
export function beforeScheduledPrompt(prompt:string,chatJid:string,provenance:ExecutionProvenance|undefined):void {
  const scope=storage.getStore();authoriseScheduledDispatch(chatJid,provenance);
  if(!scope?.entered||scope.prompted||prompt!==scope.prompt)deny(scope);
  scope.prompted=true;
}
