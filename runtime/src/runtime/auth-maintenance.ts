import { admitSqliteWrite } from "../db/sqlite-async-admission.js";
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
  const controller = new AbortController();
  const prune = async () => {
    try {
      const database = getDb();
      await admitSqliteWrite(database, () => pruneExpiredAuthState(database), () => {
        if (getDb() !== database) throw Error("Authentication maintenance database changed");
      }, controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) log.warn("Authentication expiry cleanup failed", { operation: "auth_maintenance.prune", error });
    }
  };
  void prune();
  const timer = setInterval(() => { void prune(); }, 60_000);
  timer.unref();
  const cleanup = () => {
    controller.abort(); clearInterval(timer);
    if (stop === cleanup) stop = null;
  };
  if (!shutdownHookRegistered) {
    registerPreShutdownHook(() => { stop?.(); });
    shutdownHookRegistered = true;
  }
  stop = cleanup;
  return cleanup;
}
