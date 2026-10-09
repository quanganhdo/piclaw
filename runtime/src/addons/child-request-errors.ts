export class ChildRequestError extends Error {
  constructor(readonly code: 'invalid_request' | 'unavailable' | 'cancelled' | 'execution_failed' | 'settlement_failed') {
    super(`Child model request ${code}.`);
  }
}
