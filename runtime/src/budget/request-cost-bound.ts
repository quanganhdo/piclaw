import type { Api, Model, ModelCostRates } from '@earendil-works/pi-ai';

export interface HostRequestCostBound {
  amountMicros: number | null;
  reason: 'catalogue_ceiling' | 'documented_free' | 'invalid_limits' | 'unknown_pricing';
}

/** Convert a catalogue USD-per-million-token rate to an exact integer-micro ceiling.
 * One token at a rate of $1/million costs one micro. Decimal arithmetic avoids
 * rounding a fractional upper bound down through binary floating point. */
function categoryCeiling(tokens: number, rate: number): bigint {
  const [mantissa, exponentText = '0'] = String(rate).split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  const coefficient = BigInt(whole + fraction) * BigInt(tokens);
  const scale = fraction.length - Number(exponentText);
  if (scale <= 0) return coefficient * 10n ** BigInt(-scale);
  const divisor = 10n ** BigInt(scale);
  return (coefficient + divisor - 1n) / divisor;
}

/** Trusted host metadata only; no wire/tool cost ceiling or token estimate.
 * Supported executors must enforce the model's input and output token ceilings.
 * Charge every overlapping input/cache category at its highest listed rate,
 * including request-wide tiers. Provider compositions with unlisted prices,
 * unbounded category multipliers or unenforced token limits must not use this
 * bound. Unknown pricing remains null and the ledger applies current cap policy. */
export function boundHostRequestCost(model: Pick<Model<Api>, 'contextWindow' | 'maxTokens' | 'cost'>,
  outputTokens: number, documentedFree = false): HostRequestCostBound {
  if (!Number.isSafeInteger(model.contextWindow) || model.contextWindow <= 0
    || !Number.isSafeInteger(model.maxTokens) || model.maxTokens <= 0
    || !Number.isSafeInteger(outputTokens) || outputTokens <= 0 || outputTokens > model.maxTokens) {
    return { amountMicros: null, reason: 'invalid_limits' };
  }
  const keys = ['input', 'output', 'cacheRead', 'cacheWrite'] as const;
  const costs = model.cost;
  if (!costs || costs.tiers !== undefined && !Array.isArray(costs.tiers)) return { amountMicros: null, reason: 'unknown_pricing' };
  const rates: ModelCostRates = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const thresholds = new Set<number>();
  for (const entry of [costs, ...(costs.tiers ?? [])]) {
    if (entry !== costs) {
      const threshold = (entry as { inputTokensAbove: number }).inputTokensAbove;
      if (!Number.isSafeInteger(threshold) || threshold < 0 || thresholds.has(threshold)) return { amountMicros: null, reason: 'unknown_pricing' };
      thresholds.add(threshold);
    }
    for (const key of keys) {
      const value = entry?.[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return { amountMicros: null, reason: 'unknown_pricing' };
      rates[key] = Math.max(rates[key], value);
    }
  }
  const allFree = keys.every(key => rates[key] === 0);
  if (documentedFree) return allFree ? { amountMicros: 0, reason: 'documented_free' } : { amountMicros: null, reason: 'unknown_pricing' };
  if (allFree) return { amountMicros: null, reason: 'unknown_pricing' };
  const amount = categoryCeiling(model.contextWindow, rates.input)
    + categoryCeiling(model.contextWindow, rates.cacheRead)
    + categoryCeiling(model.contextWindow, rates.cacheWrite)
    + categoryCeiling(outputTokens, rates.output);
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) return { amountMicros: null, reason: 'unknown_pricing' };
  return { amountMicros: Number(amount), reason: 'catalogue_ceiling' };
}
