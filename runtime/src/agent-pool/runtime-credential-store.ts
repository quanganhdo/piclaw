import type { CredentialStore } from "@earendil-works/pi-ai";
import { isTransientOAuthRefreshError } from "./credential-store.js";

/** Keep credential/store diagnostics out of public runtime auth error events. */
function publicCredentialError(error: unknown, signal?: AbortSignal): Error {
  // Provider-controlled diagnostic getters can throw. A secondary exception
  // must never bypass this boundary and expose its own message or cause.
  try {
    const abortException = error !== null && typeof error === "object" && "name" in error && error.name === "AbortError";
    if (signal?.aborted || abortException) {
      const aborted = new Error("Credential operation aborted.");
      aborted.name = "AbortError";
      return aborted;
    }
    // Classify privately once, without retaining raw diagnostic properties.
    if (isTransientOAuthRefreshError(error)) return new Error("Model credential service temporarily unavailable (503).");
  } catch {
    return new Error("Provider login required. Model credentials could not be resolved.");
  }
  return new Error("Provider login required. Model credentials could not be resolved.");
}

/**
 * Public CredentialStore facade for ModelRuntime. The backing store completes
 * locking/retries first, so sanitization does not change its transaction logic.
 */
export function createRuntimeCredentialStore(store: CredentialStore): CredentialStore {
  const protect = async <T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
    try { return await operation(); }
    catch (error) { throw publicCredentialError(error, signal); }
  };
  return {
    read: (provider, options) => protect(() => store.read(provider, options), options?.signal),
    list: options => protect(() => store.list(options), options?.signal),
    modify: (provider, fn, options) => protect(() => store.modify(provider, fn, options), options?.signal),
    delete: (provider, options) => protect(() => store.delete(provider, options), options?.signal),
  };
}
