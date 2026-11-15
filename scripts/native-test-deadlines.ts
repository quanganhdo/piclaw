/** Wall-clock file budgets; scenario-level Bun deadlines remain unchanged. */
export const DEFAULT_NATIVE_FILE_TIMEOUT_MS = 300_000;
export function nativeFileTimeout(file: string, overrides: Record<string, number>, inventory: readonly string[]): number {
  if (!inventory.includes(file)) throw Error(`Unknown native timeout candidate: ${file}`);
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw Error('Native file-timeout contract is missing');
  for (const [name, ms] of Object.entries(overrides)) {
    if (!inventory.includes(name) || !Number.isSafeInteger(ms) || ms <= 0 || ms > 900_000) {
      throw Error(`Invalid bounded native file timeout: ${name}`);
    }
  }
  return overrides[file] ?? DEFAULT_NATIVE_FILE_TIMEOUT_MS;
}
