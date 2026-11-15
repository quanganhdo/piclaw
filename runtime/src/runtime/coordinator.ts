/**
 * runtime/coordinator.ts – Runtime message-loop orchestration helpers.
 */

import { createLogger } from "../utils/logger.js";
import {
  runMessageLoop,
  type MessageLoopDeps,
} from "./message-loop.js";

const log = createLogger("runtime.coordinator");

/** Dependencies required to start the readonly pending-input poller. */
export type StartRuntimeLoopDeps = {
  state: MessageLoopDeps["state"];
  assistantName: MessageLoopDeps["assistantName"];
  pollIntervalMs: MessageLoopDeps["pollIntervalMs"];
  signal?: AbortSignal;
  runMessageLoopFn?: (deps: MessageLoopDeps, signal?: AbortSignal) => Promise<void>;
};

/**
 * Start readonly polling without an executable worker, queue or pool.
 */
export async function startRuntimeLoop(deps: StartRuntimeLoopDeps): Promise<void> {
  const runMessageLoopImpl = deps.runMessageLoopFn ?? runMessageLoop;

  log.info("Binding runtime loop dependencies", {
    operation: "start_runtime_loop",
    pollIntervalMs: deps.pollIntervalMs,
  });

  await runMessageLoopImpl({
    state: deps.state,
    assistantName: deps.assistantName,
    pollIntervalMs: deps.pollIntervalMs,
  }, deps.signal);
}
