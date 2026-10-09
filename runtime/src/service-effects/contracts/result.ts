/* eslint-disable no-redeclare -- TypeScript has separate type and value namespaces. */
/** Piclaw service-effect outcome. Independent of the selected agent runtime. */
export type Result<TValue, TError> =
  | { ok: true; value: TValue }
  | { ok: false; error: TError };

export const Result = {
  ok<TValue>(value: TValue): Result<TValue, never> {
    return { ok: true, value };
  },
  err<TError>(error: TError): Result<never, TError> {
    return { ok: false, error };
  },
};
