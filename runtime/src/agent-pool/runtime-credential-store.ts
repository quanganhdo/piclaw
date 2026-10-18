import type { CredentialStore } from "@earendil-works/pi-ai";
import { isTransientOAuthRefreshError } from "./credential-store.js";

import { createLogger } from "../utils/logger.js";

const log = createLogger("agent-pool.runtime-credential-store");
type Operation = "read" | "list" | "modify" | "delete";
type Category = "aborted" | "storage_lock" | "storage_permissions" | "storage_io" | "storage_parse" | "transient_oauth" | "auth_rejected" | "unknown";
type Failure = { category: Category; code?: string; status?: number };
const storageCodes: Record<string, Category> = {
  EACCES: "storage_permissions", EPERM: "storage_permissions",
  ELOCKED: "storage_lock", ECOMPROMISED: "storage_lock",
  ENOSPC: "storage_io", EIO: "storage_io", EROFS: "storage_io",
  ENOENT: "storage_io", ENOTDIR: "storage_io", EISDIR: "storage_io", ELOOP: "storage_io", EMFILE: "storage_io", ENFILE: "storage_io",
};
const networkCodes = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH"]);
const authCodes = new Set(["invalid_grant", "invalid_client", "unauthorized_client", "access_denied"]);
const statuses = new Set([400, 401, 403, 408, 425, 429, 500, 502, 503, 504]);

// Read data properties only: diagnostic accessors (including cause/toString)
// are neither invoked for classification nor handed to the structured logger.
function dataProperty(object: object, key: string): unknown {
  let current: object | null = object;
  for (let depth = 0; current && depth < 4; depth++, current = Object.getPrototypeOf(current)) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
  }
  return undefined;
}

function classifyFailure(error: unknown, signal?: AbortSignal): Failure {
  try {
    if (signal?.aborted) return { category: "aborted" };
    const text: string[] = [];
    const seen = new Set<unknown>();
    let current = error;
    let code: string | undefined;
    let status: number | undefined;
    for (let depth = 0; current != null && !seen.has(current) && depth < 8; depth++) {
      seen.add(current);
      if (typeof current === "string") { text.push(current); break; }
      if (typeof current !== "object") break;
      // Use the native DOMException accessor, never an overridden getter.
      const name = current instanceof DOMException
        ? Object.getOwnPropertyDescriptor(DOMException.prototype, "name")?.get?.call(current)
        : dataProperty(current, "name");
      if (name === "AbortError") return { category: "aborted" };
      if (current instanceof SyntaxError || name === "SyntaxError") return { category: "storage_parse" };
      const rawCode = dataProperty(current, "code");
      if (typeof rawCode === "string") {
        if (Object.hasOwn(storageCodes, rawCode)) return { category: storageCodes[rawCode]!, code: rawCode };
        if (networkCodes.has(rawCode) || authCodes.has(rawCode)) code = rawCode;
      }
      for (const key of ["status", "statusCode"]) {
        const value = dataProperty(current, key);
        if (typeof value === "number" && statuses.has(value)) status = value;
      }
      for (const key of ["message", "error", "error_description"]) {
        const value = dataProperty(current, key);
        if (typeof value === "string") text.push(value);
      }
      current = dataProperty(current, "cause");
    }
    const detail = text.join(" | ");
    if ((code && authCodes.has(code)) || status === 401 || /invalid[_ -]?grant|invalid[_ -]?client|unauthorized[_ -]?client|access[_ -]?denied|refresh token[^|]*(?:expired|revoked|invalid)|\b401\b/i.test(detail)) {
      return { category: "auth_rejected", ...(code ? { code } : {}), ...(status ? { status } : {}) };
    }
    // The existing helper can inspect throwing properties; pass only our private
    // primitive snapshot, and keep its failure inside this sanitizing boundary.
    if (status !== 400 && status !== 403 && ((code && networkCodes.has(code)) || isTransientOAuthRefreshError([detail, code, status].filter(value => value !== undefined).join(" | ")))) {
      return { category: "transient_oauth", ...(code ? { code } : {}), ...(status ? { status } : {}) };
    }
    return { category: "unknown", ...(code ? { code } : {}), ...(status ? { status } : {}) };
  } catch {
    // Explicitly handle hostile proxies without inspecting or exposing them.
    return { category: "unknown" };
  }
}

/** Keep credential/store diagnostics out of public runtime auth error events. */
function publicCredentialError(failure: Failure): Error {
  if (failure.category === "aborted") {
    const error = new Error("Credential operation aborted.");
    error.name = "AbortError";
    return error;
  }
  if (failure.category === "auth_rejected") return new Error("Provider login required. Model credentials could not be resolved.");
  if (failure.category === "transient_oauth") return new Error("Model credential service temporarily unavailable (503).");
  if (failure.category.startsWith("storage_")) return new Error("Model credential storage unavailable.");
  return new Error("Model credential resolution unavailable.");
}

/**
 * Public CredentialStore facade for ModelRuntime. The backing store completes
 * locking/retries first, so sanitization does not change its transaction logic.
 */
export function createRuntimeCredentialStore(store: CredentialStore): CredentialStore {
  const protect = async <T>(operation: Operation, run: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
    try { return await run(); }
    catch (error) {
      const failure = classifyFailure(error, signal);
      try {
        log.warn("Runtime credential operation failed", { event: "credential_store.runtime_failure", operation, ...failure });
      } catch { /* Diagnostics must not replace the sanitized failure. */ }
      throw publicCredentialError(failure);
    }
  };
  return {
    read: (provider, options) => protect("read", () => store.read(provider, options), options?.signal),
    list: options => protect("list", () => store.list(options), options?.signal),
    modify: (provider, fn, options) => protect("modify", () => store.modify(provider, fn, options), options?.signal),
    delete: (provider, options) => protect("delete", () => store.delete(provider, options), options?.signal),
  };
}
