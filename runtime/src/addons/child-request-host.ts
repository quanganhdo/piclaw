import type { ChildRequestsApiV1, ChildRequestScopeV1 } from './child-request-contracts.js';
import { ChildRequestError } from './child-request-scope.js';

/** Startup host installation supplies trusted policy/work/executor binding.
 * No child-provided addon/work/account IDs. The default runtime has no provider
 * adapter until its raw auth/provider settlement contract is qualified. */
export interface ChildRequestsHost {
  createScope(addonId: string, input: Parameters<ReturnType<ChildRequestsApiV1['register']>['createScope']>[0]): ChildRequestScopeV1;
}
export function createChildRequestsApi(host: ChildRequestsHost | null, owner: () => string | null): ChildRequestsApiV1 {
  return Object.freeze({
    version: 1 as const,
    register() {
      const addonId = owner();
      if (!addonId || !host) throw new ChildRequestError('unavailable');
      return Object.freeze({
        createScope(input: Parameters<ReturnType<ChildRequestsApiV1['register']>['createScope']>[0]) {
          input.signal.throwIfAborted();
          if (input.requireMcp || !Number.isSafeInteger(input.deadlineAt) || input.deadlineAt <= Date.now()) throw new ChildRequestError('unavailable');
          return host.createScope(addonId, { ...input, model: { ...input.model } });
        },
      });
    },
  });
}
