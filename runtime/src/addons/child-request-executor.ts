import type { Api, AssistantMessageEvent, Context, FetchFunction, Model, ModelsSimpleStreamOptions } from '@earendil-works/pi-ai';
import type { ChildRequestOptionsV1 } from './child-request-contracts.js';
import { ChildRequestError, type PreparedChildExecution } from './child-request-scope.js';
import { createChildRequestHttp } from './child-request-http.js';
import { createLogger } from '../utils/logger.js';
const log = createLogger('addons.child-request-executor');
const observeTailFailure = () => { log.debug('Child request raw tail failed.', { operation: 'child_request.raw_tail' }); };

export interface ChildRequestExecutorDependencies {
  model: Model<Api>;
  endpoint: string;
  fetch: FetchFunction;
  authorise(): void;
  /** One captured public auth/provider preparation; must track its raw tail.
   * The returned start must not perform a second auth lookup. No credential data
   * is exposed here or on IPC. Real provider preparation is qualified separately. */
  prepare(context: Context, options: ChildRequestOptionsV1): Promise<{
    start(options: Pick<ModelsSimpleStreamOptions, 'fetch' | 'signal' | 'maxRetries' | 'onProviderStreamEvent'>): {
      events: AsyncIterable<AssistantMessageEvent>;
      /** Executor-owned raw provider task, distinct from a public terminal or result(). */
      settled: Promise<void>;
    };
  }>;
}
/** HTTP-only executor around a trusted composed-provider starter. Public SDK
 * streams use eager queues. Response byte and parsed-event limits bound that
 * producer; the scope separately bounds child delivery. These limits do not
 * turn the public SDK queue into a demand-driven provider stream. */
export function childRequestExecutor(deps: ChildRequestExecutorDependencies) {
  const model = structuredClone(deps.model);
  const endpoint = deps.endpoint, upstream = deps.fetch, authorise = deps.authorise, prepare = deps.prepare;
  return async (context: Context, options: ChildRequestOptionsV1, signal: AbortSignal): Promise<PreparedChildExecution> => {
    const prepared = await prepare(context, options);
    signal.throwIfAborted(); authorise();
    return {
      start(beforeSend) {
        let resolveTail!: () => void, rejectTail!: (error: ChildRequestError) => void;
        const settled = new Promise<void>((resolve, reject) => { resolveTail = resolve; rejectTail = reject; });
        const aborter = new AbortController();
        const executionSignal = AbortSignal.any([signal, aborter.signal]);
        const http = createChildRequestHttp({ fetch: upstream, signal: executionSignal, authorise, beforeSend, endpoint, maxResponseBytes: 16 * 1024 * 1024 });
        let completed = false;
        let rawTail: Promise<void> | undefined, rawFailed = false;
        let providerEvents = 0, providerBytes = 0;
        const events = (async function* () {
          try {
            const source = prepared.start({ signal: executionSignal, fetch: http.fetch, maxRetries: 0,
              onProviderStreamEvent: async event => {
                if (++providerEvents > 8192 || (providerBytes += Buffer.byteLength(JSON.stringify(event))) > 16 * 1024 * 1024) throw new ChildRequestError('execution_failed');
              },
            });
            rawTail = source.settled.catch(() => { rawFailed = true; });
            let count = 0;
            for await (const event of source.events) {
              if (++count > 8192) throw new ChildRequestError('execution_failed');
              if (event.type === 'done' || event.type === 'error') {
                const response = event.type === 'done' ? event.message : event.error;
                if (response.provider !== model.provider || response.model !== model.id) throw new ChildRequestError('execution_failed');
              }
              yield event;
            }
            const httpTail = http.finish();
            void httpTail.catch(observeTailFailure);
            if (rawTail) await rawTail;
            await httpTail;
            if (rawFailed) throw new ChildRequestError('settlement_failed');
            completed = true; resolveTail();
          } catch {
            aborter.abort();
            const httpTail = http.finish().catch(observeTailFailure);
            if (rawTail) await rawTail;
            await httpTail;
            rejectTail(new ChildRequestError('settlement_failed'));
            throw new ChildRequestError(signal.aborted ? 'cancelled' : 'execution_failed');
          } finally {
            if (!completed) {
              aborter.abort();
              const httpTail = http.finish().catch(observeTailFailure);
              if (rawTail) await rawTail;
              await httpTail;
              rejectTail(new ChildRequestError('settlement_failed'));
            }
          }
        })();
        void settled.catch(observeTailFailure);
        return { events, settled };
      },
    };
  };
}
