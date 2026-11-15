/** Process-local NEW admission fence, not persisted restart authority. */
const guards = new Set<{ assert: () => void }>();

/** Each registration owns only its own entry, even for the same callback. */
export function registerProcessAdmissionGuard(assert: () => void): () => void {
  const entry = { assert };
  guards.add(entry);
  return () => { guards.delete(entry); };
}

export function assertProcessAdmission(): void {
  for (const guard of guards) guard.assert();
}
