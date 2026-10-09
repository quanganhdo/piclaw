import type { AssistantMessageEvent, Context } from '@earendil-works/pi-ai';
import type { BudgetRequestBinding } from '../db/budget-request-reservations.js';
import type { ChildRequestOptionsV1, ChildRequestPlanV1, ChildRequestScopeV1, ChildRequestStreamV1 } from './child-request-contracts.js';
import { projectChildEvent } from './child-request-output.js';

import { ChildRequestError } from './child-request-errors.js';
export { ChildRequestError } from './child-request-errors.js';
/** Host-owned executor contract. Public terminal delivery alone cannot fulfil
 * settled: auth operations, provider/HTTP bodies and usage tails must finish.
 * Actual network execution MUST await beforeSend exactly once immediately before
 * its only send. Unsupported retries/transports/compositions cannot use this. */
export interface PreparedChildExecution {
  start(beforeSend: () => Promise<void>): {
    events: AsyncIterable<AssistantMessageEvent>;
    settled: Promise<void>;
  };
}
export interface ChildRequestHostDependencies {
  plan: ChildRequestPlanV1;
  signal: AbortSignal;
  deadlineAt: number;
  authorise(): void;
  validate(context: Context, options: ChildRequestOptionsV1): { context: Context; options: ChildRequestOptionsV1 };
  binding(context: Context, options: ChildRequestOptionsV1): BudgetRequestBinding;
  reserve(binding: BudgetRequestBinding, signal: AbortSignal): Promise<void>;
  dispatch(binding: BudgetRequestBinding, signal: AbortSignal): Promise<void>;
  abandon(binding: BudgetRequestBinding): Promise<void>;
  settle(binding: BudgetRequestBinding, terminal: Extract<AssistantMessageEvent, { type: 'done' | 'error' }>): Promise<void>;
  /** Includes tracked raw auth tail: cancellation may stop delivery but cannot
   * drop this promise or equate a late discarded resolution with settlement. */
  prepare(context: Context, options: ChildRequestOptionsV1, signal: AbortSignal): Promise<PreparedChildExecution>;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
/** One-slot rendezvous: no eager draining into an unbounded response array. */
class Delivery {
  private slot?: { event: AssistantMessageEvent; consumed: ReturnType<typeof deferred<void>> };
  private changed = deferred<void>();
  private finished = false;
  private error?: ChildRequestError;
  private notify() { this.changed.resolve(); this.changed = deferred<void>(); }
  async push(event: AssistantMessageEvent): Promise<void> {
    if (this.finished) return;
    const slot = { event, consumed: deferred<void>() };
    this.slot = slot; this.notify();
    await slot.consumed.promise;
  }
  end(error?: ChildRequestError) {
    this.finished = true; this.error ??= error;
    this.slot?.consumed.resolve(); this.slot = undefined; this.notify();
  }
  async next(): Promise<IteratorResult<AssistantMessageEvent>> {
    while (!this.slot && !this.finished) await this.changed.promise;
    if (this.slot) {
      const slot = this.slot; this.slot = undefined; slot.consumed.resolve();
      return { done: false, value: slot.event };
    }
    if (this.error) throw this.error;
    return { done: true, value: undefined };
  }
}
/** Injected host state machine; no credentials/provider/runtime registration.
 * Captured dependencies must be bound by the trusted host, not supplied by IPC. */
export function createChildRequestScope(deps: ChildRequestHostDependencies): ChildRequestScopeV1 {
  if (deps.plan.version !== 1 || deps.plan.execution !== 'parent-provider-proxy' || deps.plan.mcp !== 'none'
    || !deps.plan.model.provider || !deps.plan.model.id || !Number.isSafeInteger(deps.deadlineAt) || deps.deadlineAt <= Date.now()) throw new ChildRequestError('unavailable');
  const plan = Object.freeze({ ...deps.plan, model: Object.freeze({ ...deps.plan.model }) });
  deps = Object.freeze({ ...deps, plan });
  const lifetime = new AbortController();
  const signal = AbortSignal.any([deps.signal, lifetime.signal]);
  const timer = setTimeout(() => lifetime.abort(), Math.min(2_147_483_647, deps.deadlineAt - Date.now()));
  const used = new Set<string>();
  const tasks = new Set<Promise<void>>();
  let active = false, closed = false, failed = false;
  let closeTask: Promise<void> | undefined;
  function check(requestSignal: AbortSignal) {
    if (closed || signal.aborted || requestSignal.aborted || Date.now() >= deps.deadlineAt) throw new ChildRequestError('cancelled');
    try { deps.authorise(); }
    catch { throw new ChildRequestError('unavailable'); }
  }
  const scope: ChildRequestScopeV1 = {
    plan,
    stream(context, options, request) {
      check(request.signal ?? signal);
      if (active || failed || used.size >= 64 || typeof request.requestId !== 'string'
        || !/^[A-Za-z0-9._:-]{1,128}$/.test(request.requestId) || used.has(request.requestId)) throw new ChildRequestError('invalid_request');
      active = true; used.add(request.requestId);
      let input: { context: Context; options: ChildRequestOptionsV1 }, binding: BudgetRequestBinding;
      try {
        input = structuredClone(deps.validate(structuredClone(context), structuredClone(options)));
        // Validation and binding happen before admitting async work; no caller
        // mutation or another request can change its authority while it waits.
        binding = structuredClone(deps.binding(input.context, input.options));
        check(request.signal ?? signal);
      } catch { active = false; throw new ChildRequestError('invalid_request'); }
      if (binding.providerId !== plan.model.provider || binding.modelId !== plan.model.id) { active = false; throw new ChildRequestError('unavailable'); }
      const aborter = new AbortController();
      const requestSignal = AbortSignal.any([signal, aborter.signal, ...(request.signal ? [request.signal] : [])]);
      const delivery = new Delivery();
      const cancel = () => { aborter.abort(); delivery.end(new ChildRequestError('cancelled')); };
      const stopDelivery = () => delivery.end(new ChildRequestError('cancelled'));
      requestSignal.addEventListener('abort', stopDelivery, { once: true });
      let iteratorUsed = false;
      const run = async () => {
        let reserved = false, dispatchStarted = false, dispatched = false, settling = false;
        let terminal: Extract<AssistantMessageEvent, { type: 'done' | 'error' }> | undefined;
        let rawTail: Promise<void> | undefined;
        let rawTailFailed = false;
        try {
          check(requestSignal); await deps.reserve(binding, requestSignal); reserved = true; check(requestSignal);
          const prepared = await deps.prepare(input.context, input.options, requestSignal); check(requestSignal);
          const execution = prepared.start(async () => {
            check(requestSignal);
            if (dispatchStarted) throw new ChildRequestError('invalid_request');
            dispatchStarted = true;
            await deps.dispatch(binding, requestSignal); dispatched = true;
            // Revocation after the durable dispatch marker is conservatively
            // unresolved even when this adapter has not actually sent yet.
            check(requestSignal);
          });
          rawTail = execution.settled.catch(() => { rawTailFailed = true; });
          let count = 0, bytes = 0, started = false;
          for await (const event of execution.events) {
            if (terminal || !dispatched && event.type !== 'error') throw new ChildRequestError('execution_failed');
            if (++count > 8192 || (bytes += Buffer.byteLength(JSON.stringify(event))) > 16 * 1024 * 1024) throw new ChildRequestError('execution_failed');
            if (event.type === 'start') { if (started) throw new ChildRequestError('execution_failed'); started = true; }
            else if (event.type !== 'error' && !started) throw new ChildRequestError('execution_failed');
            if (event.type === 'done' || event.type === 'error') {
              terminal = structuredClone(event);
              const message = event.type === 'done' ? event.message : event.error;
              if (message.provider !== plan.model.provider || message.model !== plan.model.id
                || message.responseModel !== undefined && message.responseModel !== plan.model.id && message.responseModel !== `${plan.model.provider}/${plan.model.id}`
                || message.stopReason !== event.reason) throw new ChildRequestError('execution_failed');
            }
            if (event.type !== 'done' && event.type !== 'error'
              && (event.partial.provider !== plan.model.provider || event.partial.model !== plan.model.id)) throw new ChildRequestError('execution_failed');
            // Cancellation still drains owned provider output/raw tails for
            // reconciliation, but never publishes late events to the child.
            if (!requestSignal.aborted) {
              check(requestSignal);
              await delivery.push(projectChildEvent(event));
            }
          }
          await rawTail;
          if (rawTailFailed || !terminal || !dispatched) throw new ChildRequestError('execution_failed');
          settling = true;
          await deps.settle(binding, terminal);
          reserved = false;
          delivery.end(requestSignal.aborted ? new ChildRequestError('cancelled') : undefined);
        } catch {
          const cancelled = requestSignal.aborted;
          delivery.end(new ChildRequestError(cancelled ? 'cancelled' : 'execution_failed')); aborter.abort();
          if (rawTail) await rawTail;
          if (reserved) {
            try { await deps.abandon(binding); }
            catch { failed = true; throw new ChildRequestError('settlement_failed'); }
          }
          if (rawTailFailed || settling || dispatched) { failed = true; throw new ChildRequestError('settlement_failed'); }
        } finally {
          requestSignal.removeEventListener('abort', stopDelivery); active = false;
        }
      };
      // Publish tracking before user executor code is entered.
      const settled = Promise.resolve().then(run);
      tasks.add(settled);
      void settled.then(() => tasks.delete(settled), () => { failed = true; tasks.delete(settled); });
      return {
        settled, cancel,
        [Symbol.asyncIterator]() {
          if (iteratorUsed) throw new ChildRequestError('invalid_request'); iteratorUsed = true;
          return { next: () => delivery.next(), return: async () => { cancel(); return { done: true, value: undefined }; } };
        },
      } as ChildRequestStreamV1;
    },
    close() {
      if (closeTask) return closeTask;
      closed = true;
      // Publish the shared promise before synchronous abort listeners reenter.
      closeTask = Promise.resolve().then(async () => {
        lifetime.abort(); clearTimeout(timer);
        const results = await Promise.allSettled([...tasks]);
        if (failed || results.some(result => result.status === 'rejected')) throw new ChildRequestError('settlement_failed');
      });
      return closeTask;
    },
  };
  return Object.freeze(scope);
}
