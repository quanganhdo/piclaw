import type Database from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { getDb } from './connection.js';
import { getBudgetWork, getBudgetCap } from './budget-limits.js';
import { storeTokenUsage, type TokenUsageRecord } from './token-usage.js';
import { evaluateBudget } from '../budget/evaluator.js';
import { valueApiEquivalentCost } from '../budget/valuation.js';
import type { BudgetProviderEvidence } from '../budget/types.js';

export type BudgetRequestState = 'reserved' | 'dispatched' | 'unresolved' | 'settled' | 'released';
/** Trusted host binding, not a tool or wire request shape. */
export interface BudgetRequestBinding {
  id: string;
  workId: string;
  chatJid: string;
  providerId: string;
  modelId: string;
  accountRef: string;
  amountMicros: number | null;
}
export interface BudgetRequestReservation {
  id: string;
  work_id: string;
  chat_jid: string;
  provider_id: string;
  model_id: string;
  account_ref: string;
  binding_sha256: string;
  amount_microusd: number | null;
  state: BudgetRequestState;
  created_at: string;
  updated_at: string;
  settlement_sha256: string | null;
  usage_event_id: string | null;
}
export class BudgetRequestError extends Error {
  constructor(readonly code: 'invalid_binding' | 'conflict' | 'unavailable' | 'budget_denied' | 'invalid_state') {
    super(`Model request ${code}.`);
  }
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().filter(key => object[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
}
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
function validate(binding: BudgetRequestBinding): void {
  for (const key of ['id','workId','chatJid','providerId','modelId','accountRef'] as const) {
    const value = binding[key];
    if (typeof value !== 'string' || !value.trim() || value.length > 256 || /\p{Cc}/u.test(value)) throw new BudgetRequestError('invalid_binding');
  }
  if (binding.amountMicros !== null && (!Number.isSafeInteger(binding.amountMicros) || binding.amountMicros < 0)) throw new BudgetRequestError('invalid_binding');
}
export function getBudgetRequest(id: string, database: Database = getDb()): BudgetRequestReservation | null {
  return database.query('SELECT * FROM budget_request_reservations WHERE id=?').get(id) as BudgetRequestReservation | null;
}
function boundRequest(binding: BudgetRequestBinding, database: Database): BudgetRequestReservation {
  validate(binding);
  const row = getBudgetRequest(binding.id, database);
  if (!row) throw new BudgetRequestError('unavailable');
  if (row.binding_sha256 !== digest(binding)) throw new BudgetRequestError('conflict');
  return row;
}
function activeWork(binding: BudgetRequestBinding, database: Database): void {
  let work = getBudgetWork(binding.workId, database);
  if (!work || work.chat_jid !== binding.chatJid) throw new BudgetRequestError('unavailable');
  const seen = new Set<string>();
  while (work) {
    if (work.status !== 'active' || seen.has(work.id)) throw new BudgetRequestError('unavailable');
    seen.add(work.id);
    if (!work.parent_work_id) return;
    work = getBudgetWork(work.parent_work_id, database);
    if (!work) throw new BudgetRequestError('unavailable');
  }
}
function admission(binding: BudgetRequestBinding, input: { now?: Date; providerEvidence?: BudgetProviderEvidence[]; excludeReservationId?: string }, database: Database): void {
  activeWork(binding, database);
  const now = input.now ?? new Date();
  const evidence = input.providerEvidence?.filter(item => {
    const cap = getBudgetCap(item.capId, database);
    const age = now.getTime() - Date.parse(item.fetchedAt);
    return cap?.provider_id === binding.providerId && cap.account_ref === binding.accountRef
      && item.providerId === binding.providerId && item.accountRef === binding.accountRef
      && item.quotaDimension === cap.quota_dimension && Number.isFinite(age) && age >= 0 && age <= 120_000
      && (item.resetsAt == null || Number.isFinite(Date.parse(item.resetsAt)) && Date.parse(item.resetsAt) > now.getTime())
      && item.windowId.length > 0 && item.valueMicros !== null && Number.isSafeInteger(item.valueMicros) && item.valueMicros >= 0;
  });
  const decision = evaluateBudget({ workId: binding.workId, providerId: binding.providerId, now,
    providerEvidence: evidence, excludeReservationId: input.excludeReservationId,
    pendingRequest: { amountMicros: binding.amountMicros } }, database);
  if (decision.action !== 'allow' && decision.action !== 'warn') throw new BudgetRequestError('budget_denied');
}
/** Evaluate and hold in one write transaction. No provider or credential I/O. */
export function reserveBudgetRequest(binding: BudgetRequestBinding, input: { now?: Date; providerEvidence?: BudgetProviderEvidence[] } = {}, database: Database = getDb()): BudgetRequestReservation {
  validate(binding);
  return database.transaction(() => {
    const existing = getBudgetRequest(binding.id, database);
    if (existing) return boundRequest(binding, database);
    admission(binding, input, database);
    const now = (input.now ?? new Date()).toISOString();
    database.query(`INSERT INTO budget_request_reservations
      (id,work_id,chat_jid,provider_id,model_id,account_ref,binding_sha256,amount_microusd,state,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,'reserved',?,?)`).run(binding.id,binding.workId,binding.chatJid,binding.providerId,binding.modelId,binding.accountRef,digest(binding),binding.amountMicros,now,now);
    return getBudgetRequest(binding.id, database)!;
  }).immediate();
}
/** One dispatch only. Recheck caps/ancestors and host authority after any awaits. */
export function dispatchBudgetRequest(binding: BudgetRequestBinding, input: { now?: Date; providerEvidence?: BudgetProviderEvidence[]; authorise: () => void; signal: AbortSignal }, database: Database = getDb()): BudgetRequestReservation {
  return database.transaction(() => {
    const row = boundRequest(binding, database);
    if (row.state !== 'reserved') throw new BudgetRequestError('invalid_state');
    input.signal.throwIfAborted(); input.authorise();
    admission(binding, { ...input, excludeReservationId: binding.id }, database);
    input.authorise(); input.signal.throwIfAborted();
    database.query("UPDATE budget_request_reservations SET state='dispatched',updated_at=? WHERE id=? AND state='reserved'").run((input.now ?? new Date()).toISOString(),binding.id);
    return getBudgetRequest(binding.id, database)!;
  }).immediate();
}
/** Only definitely-unsent work releases capacity; ambiguous sends remain held. */
export function abandonBudgetRequest(binding: BudgetRequestBinding, database: Database = getDb(), now = new Date()): BudgetRequestReservation {
  return database.transaction(() => {
    const row = boundRequest(binding, database);
    if (row.state === 'settled' || row.state === 'released' || row.state === 'unresolved') return row;
    database.query('UPDATE budget_request_reservations SET state=?,updated_at=? WHERE id=?').run(row.state === 'reserved' ? 'released' : 'unresolved',now.toISOString(),binding.id);
    return getBudgetRequest(binding.id,database)!;
  }).immediate();
}
/** Parent-owned actual usage. Late settlement survives cancellation of the work. */
export function settleBudgetRequest(binding: BudgetRequestBinding, usage: Omit<TokenUsageRecord,'work_id' | 'invocation_id' | 'usage_event_id' | 'execution_kind'>, database: Database = getDb()): BudgetRequestReservation {
  return database.transaction(() => {
    const row = boundRequest(binding,database);
    if (usage.chat_jid !== binding.chatJid || usage.provider !== binding.providerId || usage.model !== binding.modelId
      || usage.response_model && usage.response_model !== binding.modelId) throw new BudgetRequestError('conflict');
    for (const key of ['input_tokens','output_tokens','cache_read_tokens','cache_write_tokens','total_tokens'] as const) {
      if (!Number.isSafeInteger(usage[key]) || usage[key] < 0) throw new BudgetRequestError('invalid_binding');
    }
    for (const key of ['cost_input','cost_output','cost_cache_read','cost_cache_write','cost_total'] as const) {
      if (!Number.isFinite(usage[key]) || usage[key] < 0) throw new BudgetRequestError('invalid_binding');
    }
    if (!Number.isFinite(Date.parse(usage.run_at)) || usage.api_equivalent_cost_known === true
      && (!Number.isSafeInteger(usage.api_equivalent_cost_microusd) || usage.api_equivalent_cost_microusd! < 0)) throw new BudgetRequestError('invalid_binding');
    const hash = digest(usage), eventId = `usage:invocation:${binding.id}`;
    if (row.state === 'settled') {
      if (row.settlement_sha256 !== hash || row.usage_event_id !== eventId) throw new BudgetRequestError('conflict');
      return row;
    }
    if (row.state !== 'dispatched' && row.state !== 'unresolved') throw new BudgetRequestError('invalid_state');
    if (usage.api_equivalent_cost_known !== true) {
      if (usage.api_equivalent_cost_microusd != null || usage.valuation_provenance && usage.valuation_provenance !== 'unavailable') throw new BudgetRequestError('invalid_binding');
      // Zero telemetry is not proof of no charge. Keep this invocation unresolved
      // until the host obtains a complete valuation or explicit free outcome.
      database.query("UPDATE budget_request_reservations SET state='unresolved',updated_at=? WHERE id=?").run(new Date().toISOString(),binding.id);
      return getBudgetRequest(binding.id,database)!;
    }
    const amount = usage.api_equivalent_cost_microusd!;
    const valued = valueApiEquivalentCost({
      tokens: { input: usage.input_tokens, output: usage.output_tokens, cacheRead: usage.cache_read_tokens, cacheWrite: usage.cache_write_tokens },
      costs: { input: usage.cost_input, output: usage.cost_output, cacheRead: usage.cost_cache_read, cacheWrite: usage.cost_cache_write, total: usage.cost_total },
      documentedFree: usage.valuation_provenance === 'documented_free',
    });
    if (!valued.known || valued.amountMicros !== amount || valued.provenance !== usage.valuation_provenance) throw new BudgetRequestError('invalid_binding');
    if (usage.valuation_provenance !== 'catalogue_estimate' && usage.valuation_provenance !== 'documented_free'
      || amount === 0 && usage.valuation_provenance !== 'documented_free'
      || usage.valuation_provenance === 'documented_free' && (amount !== 0
        || [usage.cost_total,usage.cost_input,usage.cost_output,usage.cost_cache_read,usage.cost_cache_write].some(cost => cost !== 0))) throw new BudgetRequestError('invalid_binding');
    // A charge with this host identity must never pre-exist under another owner.
    if (database.query('SELECT 1 FROM token_usage WHERE usage_event_id=?').get(eventId)) throw new BudgetRequestError('conflict');
    storeTokenUsage({ ...usage, work_id: binding.workId, invocation_id: binding.id, usage_event_id: eventId,
      execution_kind: getBudgetWork(binding.workId, database)!.execution_kind },database);
    database.query("UPDATE budget_request_reservations SET state='settled',settlement_sha256=?,usage_event_id=?,updated_at=? WHERE id=?").run(hash,eventId,new Date().toISOString(),binding.id);
    return getBudgetRequest(binding.id,database)!;
  }).immediate();
}
