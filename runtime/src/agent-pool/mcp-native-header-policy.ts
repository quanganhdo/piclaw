const REFERENCE = /\$\{|\$env:|\{env:|^!/;
export function nativeHeadersCompatible(headers: Record<string, unknown> | undefined): boolean {
  if (!nativeAuthorizationHeader(headers, true)) return false;
  return Object.entries(headers ?? {}).every(([key, value]) => typeof value === 'string'
    && (!REFERENCE.test(value) || (key.toLowerCase() === 'authorization' && /^Bearer \$\{[A-Z_][A-Z0-9_]*\}$/.test(value))));
}

/** Explicit static auth only; resolve references through the captured bridge elsewhere. */
export function nativeAuthorizationHeader(headers: Record<string, unknown> | undefined, allowEnvironmentReference = false): string | undefined {
  const authorization = Object.entries(headers ?? {}).filter(([key]) => key.toLowerCase() === 'authorization');
  if (authorization.length !== 1) return;
  const value = authorization[0][1];
  if (typeof value !== 'string' || !value.trim()) return;
  if (!REFERENCE.test(value)) return value;
  return allowEnvironmentReference && /^Bearer \$\{[A-Z_][A-Z0-9_]*\}$/.test(value) ? value : undefined;
}
