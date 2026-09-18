import { getBudgetWorkContext } from '../budget/context.js';
import { evaluateBudget } from '../budget/evaluator.js';
import { getBudgetWork, persistBudgetDecision } from '../db/budget-limits.js';
import { readAccessConfig } from '../core/config-access.js';
import { getExecutionIdentity } from '../core/execution-context.js';
import { OperationAccessError } from './operation-contracts.js';

/** Add-on-owned outbound tool work uses current runtime lineage, never a supplied work ID. */
export function admitAddonOutboundWork(addonId:string):{workId:string;chatJid:string;allowed:boolean} {
  const identity=getExecutionIdentity();
  if(readAccessConfig().mode!=='single-user'||identity&&identity.mode!=='single-user')throw new OperationAccessError();
  const context=getBudgetWorkContext();if(!context)throw new OperationAccessError();
  const work=getBudgetWork(context.workId);if(!work||work.chat_jid!==context.chatJid||work.status!=='active')throw new OperationAccessError();
  const decision=evaluateBudget({workId:work.id});
  if(decision.action!=='allow')persistBudgetDecision({decision,boundary:`addon:${addonId}:outbound`});
  if(decision.action==='pause'||decision.action==='stop')throw new OperationAccessError();
  return {workId:work.id,chatJid:work.chat_jid,allowed:true};
}
