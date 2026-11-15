/**
 * utils/model-utils.ts – Helpers for parsing and resolving LLM model identifiers.
 *
 * Model references can be specified as "modelId" or "provider/modelId". These
 * helpers parse that input, look up the matching Model from the pi-ai registry,
 * and handle ambiguous or missing matches with descriptive error messages.
 *
 * Consumers:
 *   - extensions/model-control.ts uses resolveModelLabel() for the model-switch
 *     tool exposed to the agent.
 *   - agent-pool.ts uses resolveModelLabel() when overriding the model for a run.
 */

import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

/** Result of splitting a raw model input string into provider + modelId. */
export interface ParsedModelInput {
  /** Optional provider prefix (e.g. "anthropic"). */
  provider?: string;
  /** The model identifier (e.g. "claude-sonnet-4-20250514"). */
  modelId: string;
}

/**
 * Split a raw model input string at the first `/`.
 * "anthropic/claude-sonnet-4-20250514" → { provider: "anthropic", modelId: "claude-sonnet-4-20250514" }
 * "claude-sonnet-4-20250514" → { modelId: "claude-sonnet-4-20250514" }
 */
export function parseModelInput(input: string): ParsedModelInput {
  const trimmed = input.trim();
  if (!trimmed) return { modelId: "" };
  const slash = trimmed.indexOf("/");
  return slash > 0
    ? { provider: trimmed.slice(0, slash), modelId: trimmed.slice(slash + 1) }
    : { modelId: trimmed };
}

/**
 * Find a single Model in the registry matching the given provider and modelId.
 * Returns an error string if no match is found or if the modelId is ambiguous
 * across multiple providers.
 */
export function findModel(
  models: Model<Api>[],
  provider: string | undefined,
  modelId: string
): { model?: Model<Api>; error?: string } {
  if (provider) {
    const match = models.find(
      (m) =>
        m.provider.toLowerCase() === provider.toLowerCase() &&
        m.id.toLowerCase() === modelId.toLowerCase(),
    );
    return match
      ? { model: match }
      : { error: `Model not found: ${provider}/${modelId}.` };
  }

  const matches = models.filter((m) => m.id.toLowerCase() === modelId.toLowerCase());
  if (matches.length === 0) return { error: `Model not found: ${modelId}.` };
  if (matches.length > 1) {
    const list = matches.map((m) => `${m.provider}/${m.id}`).join(", ");
    return { error: `Model "${modelId}" matches multiple providers: ${list}. Use provider/modelId.` };
  }
  return { model: matches[0] };
}

/**
 * High-level convenience: resolve from the coherent cached registry snapshot
 * and return the canonical "provider/modelId" label or an error message.
 *
 * Used by extensions/model-control.ts and agent-pool.ts.
 */
export function resolveModelLabel(
  modelRegistry: ModelRegistry,
  input: string
): { model?: string; error?: string } {
  const { provider, modelId } = parseModelInput(input);
  if (!modelId) return { error: "Model identifier is required." };
  const { model, error } = findModel(modelRegistry.getAll(), provider, modelId);
  if (!model || error) return { error: error ?? "Model not found." };
  return { model: `${model.provider}/${model.id}` };
}
