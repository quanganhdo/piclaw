import type { Api, Context, Model, ModelsSimpleStreamOptions, Provider } from '@earendil-works/pi-ai';
import { normalizeContext } from '@earendil-works/pi-ai';
import { ChildRequestError } from './child-request-scope.js';
import type { ChildRequestOptionsV1 } from './child-request-contracts.js';
import { createLogger } from '../utils/logger.js';
const log = createLogger('addons.child-request-captured-provider');

/** Host-retained request preparation. Auth options never leave this closure.
 * Capturing a public composed provider avoids the second auth lookup performed
 * by ModelRuntime.streamSimple. Caller must prove exact physical-model/provider
 * policy and supply raw authentication settlement separately from cancellation. */
export function captureChildProvider(input: {
  model: Model<Api>;
  provider: Provider;
  options: Pick<ModelsSimpleStreamOptions, 'apiKey' | 'headers' | 'env'>;
  context: Context;
  request: ChildRequestOptionsV1;
  authorise(): void;
  /** The public provider stream does not expose its executing task. A reviewed
   * host adapter must supply authoritative raw settlement; result() is not it. */
  rawSettlement(): Promise<void>;
}) {
  if (input.provider.id !== input.model.provider) throw new ChildRequestError('unavailable');
  const model = structuredClone(input.model);
  const transcript = normalizeContext(structuredClone(input.context));
  const request = structuredClone(input.request);
  const options = structuredClone(input.options);
  const provider = input.provider, authorise = input.authorise, rawSettlement = input.rawSettlement;
  return {
    start(execution: Pick<ModelsSimpleStreamOptions, 'fetch' | 'signal' | 'maxRetries' | 'onProviderStreamEvent'>) {
      execution.signal?.throwIfAborted(); authorise();
      // Use only the captured exact composed provider. Never providerFallback,
      // route a virtual model or put authentication into the child's process.
      const settled = rawSettlement();
      void settled.catch(() => { log.debug('Captured provider raw tail failed.', { operation: 'child_request.provider_tail' }); });
      try {
        const events = provider.streamSimple(model, transcript, { ...options, ...request, ...execution });
        return { events, settled };
      } catch {
        // Preserve already-started raw task tracking even when public provider
        // setup throws synchronously instead of returning an error stream.
        return { settled, events: {
          [Symbol.asyncIterator]() { return { async next() { throw new ChildRequestError('execution_failed'); } }; },
        } };
      }
    },
  };
}
