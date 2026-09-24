import * as piAi from "@earendil-works/pi-ai";
import type { Context, Tool } from "@earendil-works/pi-ai";
import { convertResponsesMessages } from "@earendil-works/pi-ai/api/openai-responses-shared";

type ProviderContext = Parameters<typeof convertResponsesMessages>[1];
type TranscriptApi = {
  normalizeContext?: (context: Context) => ProviderContext;
  getCurrentTools?: (messages: readonly { role: string }[]) => Tool[];
};
const transcriptApi = piAi as TranscriptApi;

/** Use public transcript replay; older providers can still pass Context.tools. */
export function currentContextTools(context: Context): Tool[] {
  if (transcriptApi.getCurrentTools) return transcriptApi.getCurrentTools(providerTranscriptContext(context).messages);
  const tools = new Map<string, Tool>((context.tools ?? []).map((tool) => [tool.name, tool]));
  for (const message of context.messages as { role: string; toolsRemoved?: { name: string }[]; toolsAdded?: Tool[] }[]) {
    if (message.role !== "system") continue;
    const delta = message;
    for (const tool of delta.toolsRemoved ?? []) tools.delete(tool.name);
    for (const tool of delta.toolsAdded ?? []) tools.set(tool.name, tool);
  }
  return [...tools.values()];
}

/** Only the published helper can construct branded TranscriptContext on 0.87.1. */
export function providerTranscriptContext(context: Context): ProviderContext {
  return transcriptApi.normalizeContext?.(context) ?? context as ProviderContext;
}

export function hasTranscriptContextApi(): boolean {
  return typeof transcriptApi.normalizeContext === "function";
}
