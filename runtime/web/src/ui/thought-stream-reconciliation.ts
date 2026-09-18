export interface ThoughtStreamUpdate {
  delta?: unknown;
  text?: unknown;
  reset?: unknown;
}

/**
 * Reconcile a Thought stream update without assuming every upstream event is
 * a novel suffix. New servers include the authoritative text-so-far on delta
 * events; older servers still work through the delta fallback.
 */
export function reconcileThoughtStreamText(
  currentBuffer: string | null | undefined,
  update: ThoughtStreamUpdate | null | undefined,
): string {
  if (typeof update?.text === 'string') return update.text;
  let next = update?.reset ? '' : (currentBuffer || '');
  if (typeof update?.delta === 'string') next += update.delta;
  return next;
}
