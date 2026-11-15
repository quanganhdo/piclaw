import { readAccessConfig } from "./config-access.js";
import { getExecutionIdentity } from "./execution-context.js";

export class ToolOutputAccessDenied extends Error {
  constructor() { super("Tool output access denied."); }
}

export interface ToolOutputScope {ownerUserId:string;rootBranchId:string;sourceBranchId:string;chatJid:string;executionKind:string}
export interface ToolOutputAccessGuard {():void;readonly scope:ToolOutputScope|null;readonly cacheKey:string}

function resolveScope():{identity:ReturnType<typeof getExecutionIdentity>;scope:ToolOutputScope|null;cacheKey:string} {
  let mode;const identity=getExecutionIdentity();try{mode=readAccessConfig().mode;}catch{throw new ToolOutputAccessDenied();}
  if(mode==='single-user'&&(!identity||identity.mode==='single-user'))return {identity,scope:null,cacheKey:'legacy'};
  throw new ToolOutputAccessDenied();
}

export function canUseToolOutput(): boolean {
  try { resolveScope(); return true; } catch { return false; }
}

/** Compatibility predicate retained for callers that specifically require unowned legacy rows. */
export function canUseLegacyToolOutput(): boolean {
  try {
    const identity = getExecutionIdentity();
    return readAccessConfig().mode === "single-user" && (!identity || identity.mode === "single-user");
  } catch {
    return false;
  }
}

export function createToolOutputAccessGuard(): ToolOutputAccessGuard {
  const initial=resolveScope();let allowed=true;
  const check = () => {
    try {const current=resolveScope();allowed=allowed&&current.identity===initial.identity&&current.cacheKey===initial.cacheKey;}catch{allowed=false;}
    if (!allowed) throw new ToolOutputAccessDenied();
  };
  Object.defineProperties(check,{scope:{value:initial.scope},cacheKey:{value:initial.cacheKey}});check();return check as ToolOutputAccessGuard;
}
