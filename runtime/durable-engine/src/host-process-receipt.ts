import type { EntryRecord, Tx, ToolTaskInput, ToolTaskResult } from "@earendil-works/pi-durable";
import type { AcceptedInput } from "./host-runtime.js";

export type NativeExitReceipt = {
  kind: "native_process_exit";
  version: 1;
  nonce: string;
  reason: string;
  taskId: number;
  assistantId: number;
  input: AcceptedInput;
};
export const nativeExitNotice = (reason: string) => `Restart requested — ${reason}\nGraceful shutdown requires committed completion and a final idle/cleanup check. No work will be replayed.`;

/** Public SDK terminate completes at the original tool-calling assistant. Only
 * this exact successful control receipt can supply its host-visible notice.
 * Never mutate/synthesise the SDK assistant or accept arbitrary tool-only answers.
 */
export async function readNativeExitReceipt(tx: Tx, assistant: EntryRecord, input: AcceptedInput,
  requireFinishedGeneration = true): Promise<NativeExitReceipt | undefined> {
  const messages = assistant.model;
  if (assistant.kind !== "pi.assistant" || assistant.conversationId !== input.conversationId ||
      assistant.byTaskId === undefined || messages?.length !== 1 || messages[0]?.role !== "assistant") return;
  const message = messages[0];
  const calls = message.content.filter(part => part.type === "toolCall");
  if (message.stopReason !== "toolUse" || calls.length !== 1 || calls[0]!.name !== "exit_process" ||
      message.content.some(part => !["text", "thinking", "toolCall"].includes(part.type))) return;
  const call = calls[0]!;
  if (typeof call.arguments.reason !== "string" || !call.arguments.reason.trim() ||
      call.arguments.reason.trim().length > 512 || call.arguments.resume_message !== undefined) return;
  // No other work is admitted around an accepted singleton exit. Bound the
  // scan and refuse ambiguous/changed histories instead of guessing a receipt.
  const entries = await tx.scanEntries({ conversationId: input.conversationId,
    minEntryId: (assistant.id + 1) as typeof assistant.id, order: "ascending" }, 32);
  const candidates = entries.items.filter(entry => entry.kind === "pi.tool-result" && entry.model?.length === 1 &&
    entry.model[0]?.role === "toolResult" && entry.model[0].toolCallId === call.id);
  if (candidates.length !== 1) return;
  const result = candidates[0]!;
  if (result.byTaskId === undefined || result.model?.[0]?.role !== "toolResult") return;
  const tool = await tx.task(result.byTaskId);
  const source = tool?.input as ToolTaskInput | undefined;
  const outcome = tool?.state.status === "terminal" && tool.state.outcome.status === "completed"
    ? tool.state.outcome.result as ToolTaskResult : undefined;
  if (tool?.kind !== "pi.tool" || tool.conversationId !== input.conversationId || tool.background || tool.abortRequested ||
      tool.owner !== assistant.byTaskId || source?.kind !== "model" || source.assistant !== assistant.id || source.callId !== call.id ||
      outcome?.kind !== "model" || outcome.entryId !== result.id || outcome.control?.terminate !== true ||
      Object.keys(outcome.control).some(key => key !== "terminate")) return;
  const model = result.model[0];
  const details = model.details as NativeExitReceipt | undefined;
  if (model.toolName !== "exit_process" || model.isError || !details || details.kind !== "native_process_exit" || details.version !== 1 ||
      !/^[0-9a-f-]{36}$/.test(details.nonce) || details.taskId !== tool.id || details.assistantId !== assistant.id ||
      details.reason !== call.arguments.reason.trim() || !details.input ||
      Object.keys(input).some(key => details.input[key as keyof AcceptedInput] !== input[key as keyof AcceptedInput]) ||
      Object.keys(details.input).length !== Object.keys(input).length ||
      model.content.length !== 1 || model.content[0]?.type !== "text" || model.content[0].text !== nativeExitNotice(details.reason) ||
      (result.data as { diagnostics?: unknown[] } | undefined)?.diagnostics?.length !== 0) return;
  if (requireFinishedGeneration) {
    const generation = await tx.task(assistant.byTaskId);
    const finished = generation?.state.status === "terminal" && generation.state.outcome.status === "completed"
      ? generation.state.outcome.result as { entryId?: number } : undefined;
    if (generation?.kind !== "pi.generation" || generation.conversationId !== input.conversationId || generation.abortRequested ||
        generation.background || finished?.entryId !== assistant.id) return;
  }
  return Object.freeze({ ...details, input: Object.freeze({ ...details.input }) });
}
