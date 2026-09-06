import { getDb } from "../db/connection.js";
import { pruneExpiredAuthState } from "../db/auth-maintenance.js";
import { createLogger } from "../utils/logger.js";
import { registerPreShutdownHook } from "./shutdown-registry.js";

const log = createLogger("runtime.auth-maintenance");
let stop: (() => void) | null = null;
let shutdownHookRegistered = false;

/** Start one unref'ed cleanup loop after access validation, with deterministic shutdown. */
export function startAuthMaintenance(): () => void {
  if (stop) return stop;
  const prune = () => {
    try { pruneExpiredAuthState(getDb()); }
    catch (error) { log.warn("Authentication expiry cleanup failed", { operation: "auth_maintenance.prune", error }); }
  };
  prune();
  const timer = setInterval(prune, 60_000);
  timer.unref();
  const cleanup = () => {
    clearInterval(timer);
    if (stop === cleanup) stop = null;
  };
  if (!shutdownHookRegistered) {
    registerPreShutdownHook(() => { stop?.(); });
    shutdownHookRegistered = true;
  }
  stop = cleanup;
  return cleanup;
}
