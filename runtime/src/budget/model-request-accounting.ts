import type Database from 'bun:sqlite';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { BudgetProviderEvidence } from './types.js';
import { admitBudgetRequest, admitBudgetRequestDispatch } from './request-reservation-admission.js';
import { abandonBudgetRequest, settleBudgetRequest, type BudgetRequestBinding } from '../db/budget-request-reservations.js';
import { getDb } from '../db/connection.js';
import { valueApiEquivalentCost } from './valuation.js';

/** Shared request accounting for parent, side and Delegate callers. Each caller
 * must bind one host-generated request to its current work before asynchronous
 * auth/provider work starts, and dispatch immediately before its actual send.
 * Settlement uses that captured database/work even when callback ALS differs. */
export function modelRequestAccounting(input: {
  authorise(): void;
  providerEvidence?: BudgetProviderEvidence[];
  documentedFree: boolean;
}, database: Database = getDb()) {
  const authorise = input.authorise;
  const evidence = input.providerEvidence ? structuredClone(input.providerEvidence) : undefined;
  const documentedFree = input.documentedFree;
  const accountedAt = new Map<string, string>();
  const current = () => { if (getDb() !== database) throw Error('Model request database binding changed.'); authorise(); };
  const options = (signal: AbortSignal) => ({ signal, authorise: current, providerEvidence: evidence });
  return Object.freeze({
    async reserve(binding: BudgetRequestBinding, signal: AbortSignal) { await admitBudgetRequest(binding, options(signal)); },
    async dispatch(binding: BudgetRequestBinding, signal: AbortSignal) { await admitBudgetRequestDispatch(binding, options(signal)); },
    async abandon(binding: BudgetRequestBinding) { return abandonBudgetRequest(binding, database); },
    async settle(binding: BudgetRequestBinding, message: AssistantMessage) {
      const usage = message.usage;
      const valued = valueApiEquivalentCost({
        tokens: { input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite },
        costs: usage.cost, documentedFree,
      });
      const successful = ['stop','length','toolUse'].includes(message.stopReason);
      // Error/abort zero telemetry never proves that a dispatched request was free.
      const known = valued.known && (successful || valued.amountMicros !== 0);
      const responseModel = message.responseModel ?? message.model;
      if (message.provider !== binding.providerId || message.model !== binding.modelId
        || responseModel !== binding.modelId && responseModel !== `${binding.providerId}/${binding.modelId}`) throw Error('Model request response identity changed.');
      // Provider timestamps cannot move charges outside a capped calendar
      // window. Capture the host time once and preserve it for payload replay.
      if (!accountedAt.has(binding.id)) accountedAt.set(binding.id, new Date().toISOString());
      return settleBudgetRequest(binding, {
        chat_jid: binding.chatJid, run_at: accountedAt.get(binding.id)!,
        input_tokens: usage.input, output_tokens: usage.output, cache_read_tokens: usage.cacheRead, cache_write_tokens: usage.cacheWrite,
        total_tokens: usage.totalTokens, cost_input: usage.cost.input, cost_output: usage.cost.output,
        cost_cache_read: usage.cost.cacheRead, cost_cache_write: usage.cost.cacheWrite, cost_total: usage.cost.total,
        model: binding.modelId, response_model: binding.modelId, provider: binding.providerId, api: message.api, usage_source: 'assistant',
        api_equivalent_cost_known: known, api_equivalent_cost_microusd: known ? valued.amountMicros : null,
        valuation_provenance: known ? valued.provenance : 'unavailable',
      }, database);
    },
  });
}
