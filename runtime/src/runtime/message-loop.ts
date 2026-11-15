/** Read-only pending-input polling. Execution requires host input admission. */
import { readAccessConfig } from '../core/config-access.js';
import { getExecutionIdentity } from '../core/execution-context.js';
import { getNewMessages } from '../db.js';
import { createLogger } from '../utils/logger.js';
import type { RuntimeState } from './state.js';
const log=createLogger('runtime.message-loop');
export interface MessageLoopDeps {
  state:RuntimeState;
  assistantName:string;
  pollIntervalMs:number;
}
function requireSingleUserMessageLoop():void {
  const mode=readAccessConfig().mode,identity=getExecutionIdentity();
  if(mode!=='single-user'||(identity&&identity.mode!=='single-user'))throw Error('Owner-bound non-web message processing is not available.');
}
/** Sleep without leaving a timer or abort listener behind after stop. */
function waitForPoll(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });
  });
}


/** Stop joins only the readonly poller. Accepted native work has a separate owner. */
export async function runMessageLoop(deps:MessageLoopDeps,signal?:AbortSignal):Promise<void>{
  requireSingleUserMessageLoop();
  while(!signal?.aborted){
    requireSingleUserMessageLoop();
    try {
      const jids=[...deps.state.chatJids];
      if(signal?.aborted)return;
      const {messages}=getNewMessages(jids,deps.state.lastTimestamp,deps.assistantName);
      if(messages.length)throw Error('Native non-web message processing requires host input admission');
    }catch(error){log.error('Message loop iteration failed',{operation:'run_message_loop.iteration',err:error});}
    await waitForPoll(deps.pollIntervalMs,signal);
  }
}
