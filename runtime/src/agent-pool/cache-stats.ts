import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";

const NOISE_FLOOR_TOKENS = 1024;

export type ModelLookup = {
  find?(provider: string, modelId: string): Model<Api> | undefined;
  getModel?(provider: string, modelId: string): Model<Api> | undefined;
};

function findModel(models: ModelLookup, provider: string, modelId: string): Model<Api> | undefined {
  return models.getModel?.(provider, modelId) ?? models.find?.(provider, modelId);
}

type PreviousRequest = {
  promptTokens: number;
  modelKey: string;
  timestamp: number;
  reportedCache: boolean;
};

export interface PromptCacheMiss {
  missedTokens: number;
  missedCost: number;
  idleMs: number;
  modelChanged: boolean;
}

export interface PromptCacheWaste {
  missedTokens: number;
  missedCost: number;
  missCount: number;
}

function detectMiss(
  previous: PreviousRequest | undefined,
  message: AssistantMessage,
  models: ModelLookup,
): PromptCacheMiss | undefined {
  const usage = message.usage;
  const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
  if (!previous || promptTokens <= 0 || (usage.cacheRead + usage.cacheWrite === 0 && !previous.reportedCache)) {
    return undefined;
  }

  const missedTokens = Math.min(previous.promptTokens, promptTokens) - usage.cacheRead;
  if (missedTokens <= NOISE_FLOOR_TOKENS) return undefined;

  const paidTokens = usage.input + usage.cacheWrite;
  const paidPerToken = paidTokens > 0
    ? (usage.cost.input + usage.cost.cacheWrite) / paidTokens
    : 0;
  const readPerToken = usage.cacheRead > 0
    ? usage.cost.cacheRead / usage.cacheRead
    : (findModel(models, message.provider, message.model)?.cost.cacheRead ?? 0) / 1_000_000;

  return {
    missedTokens,
    missedCost: missedTokens * Math.max(0, paidPerToken - readPerToken),
    idleMs: Math.max(0, message.timestamp - previous.timestamp),
    modelChanged: `${message.provider}/${message.model}` !== previous.modelKey,
  };
}

function asPreviousRequest(message: AssistantMessage, reportedCache: boolean): PreviousRequest | undefined {
  const usage = message.usage;
  const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
  if (promptTokens <= 0) return undefined;
  return {
    promptTokens,
    modelKey: `${message.provider}/${message.model}`,
    timestamp: message.timestamp,
    reportedCache: reportedCache || usage.cacheRead + usage.cacheWrite > 0,
  };
}

/** Derive cumulative prompt-cache misses from persisted session entries. */
export function computePromptCacheWaste(entries: SessionEntry[], models: ModelLookup): PromptCacheWaste {
  let previous: PreviousRequest | undefined;
  const totals: PromptCacheWaste = { missedTokens: 0, missedCost: 0, missCount: 0 };

  for (const entry of entries) {
    if (entry.type === "compaction" || entry.type === "branch_summary" || (entry as { type: string }).type === "context_edit") {
      // The context legitimately changed, so the next prompt is new content.
      // Model switches are intentionally counted because they re-bill the same
      // persisted prompt even though cross-model cache reuse is impossible.
      previous = undefined;
      continue;
    }
    // Explicit 0.87.1 usage entries (e.g. cache warming) are not assistant
    // requests. Counting them here would attribute the same prompt twice.
    if (entry.type !== "message" || entry.message.role !== "assistant") continue;

    const message = entry.message as AssistantMessage;
    const miss = detectMiss(previous, message, models);
    if (miss) {
      totals.missedTokens += miss.missedTokens;
      totals.missedCost += miss.missedCost;
      totals.missCount += 1;
    }
    previous = asPreviousRequest(message, previous?.reportedCache ?? false) ?? previous;
  }

  return totals;
}
