import type { AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai';
import { ChildRequestError } from './child-request-errors.js';

function message(raw: AssistantMessage): AssistantMessage {
  const result: Record<string, unknown> = {};
  for (const key of ['role','api','provider','model','usage','stopReason','timestamp','responseId','responseModel','thinkingLevel','providerThinkingLevel','endTurn'] as const) {
    if (raw[key] !== undefined) result[key] = structuredClone(raw[key]);
  }
  if (!Array.isArray(raw.content)) throw new ChildRequestError('execution_failed');
  result.content = raw.content.map(block => {
    const output: Record<string, unknown> = {};
    const allowed = block.type === 'text' ? ['type','text','textSignature']
      : block.type === 'thinking' ? ['type','thinking','thinkingSignature','redacted']
      : block.type === 'toolCall' ? ['type','id','name','arguments','thoughtSignature','namespace'] : [];
    if (!allowed.length) throw new ChildRequestError('execution_failed');
    for (const key of allowed) if ((block as unknown as Record<string,unknown>)[key] !== undefined) output[key] = structuredClone((block as unknown as Record<string,unknown>)[key]);
    return output;
  });
  const usage = raw.usage;
  const publicUsage: Record<string, unknown> = {};
  for (const key of ['input','output','cacheRead','cacheWrite','cacheWrite1h','reasoning','totalTokens'] as const) if (usage[key] !== undefined) publicUsage[key] = usage[key];
  publicUsage.cost = Object.fromEntries(['input','output','cacheRead','cacheWrite','cacheWrite1h','reasoning','total'].filter(key=>(usage.cost as unknown as Record<string,unknown>)[key]!==undefined).map(key=>[key,(usage.cost as unknown as Record<string,unknown>)[key]]));
  result.usage = publicUsage;
  return result as unknown as AssistantMessage;
}
/** Strip provider exception/diagnostic properties from every public event,
 * including successful/partial messages. Raw terminal usage stays in the host. */
export function projectChildEvent(raw: AssistantMessageEvent): AssistantMessageEvent {
  if (raw.type === 'error') return {
    type: 'error', reason: raw.reason,
    error: { role: 'assistant', content: [], api: 'proxy', provider: raw.error.provider, model: raw.error.model,
      usage: message({ ...raw.error, content: [] }).usage, stopReason: raw.reason, timestamp: raw.error.timestamp,
      errorMessage: raw.reason === 'aborted' ? 'Model request cancelled.' : 'Model request failed.' },
  };
  if (raw.type === 'done') return { type: 'done', reason: raw.reason, message: message(raw.message) };
  const result: Record<string,unknown> = { type: raw.type, partial: message(raw.partial) };
  for (const key of ['contentIndex','delta','content']) if ((raw as unknown as Record<string,unknown>)[key] !== undefined) result[key] = structuredClone((raw as unknown as Record<string,unknown>)[key]);
  if (raw.type === 'toolcall_end') result.toolCall = message({ ...raw.partial, content: [raw.toolCall] }).content[0];
  return result as unknown as AssistantMessageEvent;
}
