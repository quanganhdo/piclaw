import type { AgentSessionRuntime } from '@earendil-works/pi-coding-agent';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getWorkspaceDir } from '../core/config-context.js';
import { requireOwnedSessionExecution } from './owned-session-access.js';
import { inspectAdoptedSession, type AdoptedSessionSeed } from './adopted-session.js';

/** Import the captured tree rather than reconstructing messages or trusting a later source file. */
export async function importAdoptedSession(runtime:AgentSessionRuntime,chatJid:string,seed:AdoptedSessionSeed):Promise<void> {
  if(!requireOwnedSessionExecution(chatJid)) throw new Error('Owned adoption identity required.');
  inspectAdoptedSession(seed.jsonl,seed.sha256);
  const temp=mkdtempSync(join(runtime.session.sessionManager.getSessionDir(),'.adoption-'));
  try {
    const path=join(temp,`adopted-${seed.sha256}.jsonl`);
    writeFileSync(path,seed.jsonl,{flag:'wx',mode:0o600});
    const result=await runtime.importFromJsonl(path,getWorkspaceDir());
    if(!requireOwnedSessionExecution(chatJid)) throw new Error('Owned adoption identity required.');
    if(result.cancelled) throw new Error('Adopted session import cancelled.');
  } finally {rmSync(temp,{recursive:true,force:true});}
}
