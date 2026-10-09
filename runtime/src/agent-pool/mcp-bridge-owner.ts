import type { AgentSession, ExtensionFactory, LoadExtensionsResult, ResourceLoader } from "@earendil-works/pi-coding-agent";
import { acquireMcpSessionBridge, type McpSessionBridgeLease } from "../secure/mcp-keychain.js";
import { createLogger, debugSuppressedError } from "../utils/logger.js";
const log = createLogger("mcp-bridge-owner");

const OWNER_NAME = "piclaw-mcp-owner";
const OWNER_PATH = `<inline:${OWNER_NAME}>`;
const shutdownAdmissions = new WeakMap<object, (signal: AbortSignal) => Promise<void>>();
type ReloadOptions = Parameters<AgentSession['reload']>[0];
const reloadAdmissions = new WeakMap<object, (options: ReloadOptions, signal: AbortSignal) => Promise<void>>();
const resumeAdmissions = new WeakMap<object, () => void>();
export interface McpShutdownReceipt { readonly acknowledged: true }
const shutdownReceipts = new WeakMap<McpShutdownReceipt, { sessions: readonly object[]; signal: AbortSignal }>();

/** Host settings transitions await every old owner before any new config load. */
export function acknowledgeMcpSessionShutdown(session: object, signal: AbortSignal): Promise<void> {
  const admission = shutdownAdmissions.get(session);
  if (!admission) return Promise.reject(new Error('MCP session has no acknowledged owner binding.'));
  return admission(signal);
}

/** Only a complete captured participant set may grant one replacement batch. */
export async function acknowledgeMcpSessionsShutdown(sessions: readonly object[], signal: AbortSignal): Promise<McpShutdownReceipt> {
  const captured = [...new Set(sessions)];
  await Promise.all(captured.map(session => acknowledgeMcpSessionShutdown(session, signal)));
  signal.throwIfAborted();
  const receipt = Object.freeze({ acknowledged: true as const });
  shutdownReceipts.set(receipt, { sessions: captured, signal });
  return receipt;
}
export async function reloadAcknowledgedMcpSessions(receipt: McpShutdownReceipt, options: ReloadOptions): Promise<void> {
  const captured = shutdownReceipts.get(receipt);
  if (!captured) throw new Error('MCP replacement batch is not authorized.');
  captured.signal.throwIfAborted();
  shutdownReceipts.delete(receipt);
  await Promise.all(captured.sessions.map(session => {
    const reload = reloadAdmissions.get(session);
    if (!reload) throw new Error('MCP session replacement binding is unavailable.');
    return reload(options, captured.signal);
  }));
  captured.signal.throwIfAborted();
  for (const session of captured.sessions) resumeAdmissions.get(session)!();
}

export interface McpOwnerLifecycle {
  assertReady?(): void;
  shutdown(reason?: string): Promise<void>;
}

/**
 * One bridge lease per extension-load generation, not per AgentSession lifetime.
 * The owner's public shutdown handlers run before our release handler. Dispose
 * is a fallback for failed construction/direct session disposal; it cannot
 * certify transport cleanup when the SDK or owner suppresses shutdown errors.
 */
export function createMcpBridgeOwner(
  createOwner: (bridge: McpSessionBridgeLease, onLifecycle: (lifecycle: McpOwnerLifecycle) => void) => ExtensionFactory,
  acquire: () => McpSessionBridgeLease = acquireMcpSessionBridge,
  options: { requireLifecycle?: boolean; shutdownTimeoutMs?: number } = {},
) {
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? 30_000;
  if (!Number.isSafeInteger(shutdownTimeoutMs) || shutdownTimeoutMs <= 0) throw new Error("Invalid MCP owner cleanup deadline.");
  let active: { release(): void; dispose(): void; shutdown(reason?: string): Promise<void>; assertReady(): void; loaded: boolean } | null = null;
  let disposed = false;
  let cleanupFailed = false;
  const factory: ExtensionFactory = async pi => {
    if (disposed || cleanupFailed || active) throw new Error("MCP bridge owner is not ready for a new generation.");
    const bridge = acquire();
    let released = false;
    let lifecycle: McpOwnerLifecycle | undefined;
    let shutdownPromise: Promise<void> | undefined;
    let cleanupPromise: Promise<void> | undefined;
    const generation = {
      loaded: false,
      assertReady() { lifecycle?.assertReady?.(); },
      shutdown(reason = "Piclaw MCP owner shutdown") {
        if (!shutdownPromise) {
          let timer: ReturnType<typeof setTimeout>;
          const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("MCP owner cleanup deadline exceeded")), shutdownTimeoutMs); });
          cleanupPromise = Promise.resolve().then(() => lifecycle?.shutdown(reason));
          shutdownPromise = Promise.race([cleanupPromise, deadline]).catch(error => {
            cleanupFailed = true;
            throw new Error("MCP owner cleanup failed; replacement remains blocked.", { cause: error });
          }).finally(() => clearTimeout(timer!));
        }
        return shutdownPromise;
      },
      dispose() {
        if (!lifecycle) { generation.release(); return; }
        void generation.shutdown().catch(error => debugSuppressedError(log, "MCP disposal acknowledgement failed; replacement remains blocked.", error));
        // Deadline/rejection blocks replacement but does not certify raw cleanup.
        void cleanupPromise!.then(() => generation.release(), () => generation.release());
      },
      release() {
        if (released) return;
        released = true;
        try { bridge.release(); }
        finally { if (active === generation) active = null; }
      },
    };
    active = generation;
    try {
      await createOwner(bridge, handle => {
        if (lifecycle) throw new Error("MCP owner supplied duplicate lifecycle handles.");
        lifecycle = handle;
      })(pi);
      if (options.requireLifecycle && !lifecycle) throw new Error("MCP adapter did not supply its public shutdown lifecycle.");
      if (disposed || released) throw new Error("MCP bridge owner was disposed during loading.");
      // Registered last so the adapter retains its scoped environment until
      // its earlier shutdown handlers settle through the public SDK.
      pi.on("session_shutdown", async () => {
        await generation.shutdown();
        generation.release();
      });
      generation.loaded = true;
    } catch (error) {
      generation.dispose();
      throw error;
    }
  };
  return {
    extension: { name: OWNER_NAME, factory },
    assertLoaded(result: Pick<LoadExtensionsResult, "extensions" | "errors">) {
      // Factory completion precedes the SDK's registration commit. The SDK
      // can discard that extension and resolve reload with a diagnostic.
      active?.assertReady();
      const published = result.extensions.filter(extension => extension.path === OWNER_PATH).length === 1
        && !result.errors.some(error => error.path === OWNER_PATH);
      if (disposed || cleanupFailed || !active?.loaded || !published) {
        if (!cleanupFailed) active?.dispose();
        throw new Error("MCP bridge owner did not load.");
      }
    },
    blockAdmission() { cleanupFailed = true; },
    assertAdmission() {
      active?.assertReady();
      if (disposed || cleanupFailed) throw new Error("MCP owner is disposed or cleanup is unresolved; operations remain blocked.");
    },
    async shutdown(reason?: string) { await active?.shutdown(reason); },
    async shutdownAndRelease(reason: string, signal: AbortSignal) {
      const generation = active;
      await generation?.shutdown(reason);
      signal.throwIfAborted();
      if (disposed || cleanupFailed) throw new Error('MCP owner cleanup is unresolved; operations remain blocked.');
      // Fulfilled acknowledgement is the only release proof. SDK shutdown
      // later calls this generation's idempotent release again during reload.
      generation?.release();
    },
    dispose() {
      disposed = true;
      const generation = active;
      if (!generation) return;
      // Direct synchronous SDK disposal cannot acknowledge transport closure.
      // Keep scoped credentials until the public cleanup promise settles.
      generation.dispose();
    },
  };
}

/** Preserve the caller's reload barrier and release leases on direct disposal. */
export function bindMcpBridgeOwner(
  session: Pick<AgentSession, "reload" | "dispose" | "abort" | "prompt">,
  loader: Pick<ResourceLoader, "getExtensions">,
  owner: ReturnType<typeof createMcpBridgeOwner>,
): void {
  const assertLoaded = () => owner.assertLoaded(loader.getExtensions());
  assertLoaded();
  const dispose = session.dispose.bind(session);
  const reload = session.reload.bind(session);
  const prompt = session.prompt.bind(session);
  let reloading = false;
  let transitioning = false;
  let transitionAcknowledged = false;
  const admittedPrompts = new Set<Promise<void>>();
  session.prompt = (...args) => {
    owner.assertAdmission();
    if (reloading || transitioning) throw new Error("MCP owner reload is in progress; operations remain blocked.");
    // Register before invocation: SDK input/auth/extension preflight precedes
    // its active-agent flag, so abort/isIdle cannot certify prompt quiescence.
    const pending = Promise.resolve().then(() => {
      owner.assertAdmission();
      if (reloading || transitioning) throw new Error("MCP owner reload is in progress; operations remain blocked.");
      return prompt(...args);
    });
    admittedPrompts.add(pending);
    void pending.then(() => admittedPrompts.delete(pending), () => admittedPrompts.delete(pending));
    return pending;
  };
  session.dispose = () => {
    // SDK dispose aborts synchronously; listeners must see the host fence first.
    owner.dispose();
    try { dispose(); }
    finally { owner.dispose(); }
  };
  shutdownAdmissions.set(session, async signal => {
    if (reloading || transitioning) throw new Error('MCP owner transition is already in progress.');
    signal.throwIfAborted(); owner.assertAdmission(); transitioning = true;
    let rejectAbort!: (error: unknown) => void;
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
    const onAbort = () => rejectAbort(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      await Promise.race([session.abort(), aborted]);
      // Agent idle does not prove preflight/auth or extension-command tails
      // settled. The synchronous fence stops new admissions before this drain.
      await Promise.race([Promise.allSettled([...admittedPrompts]), aborted]);
      signal.throwIfAborted(); owner.assertAdmission();
      await Promise.race([owner.shutdownAndRelease('Piclaw MCP server settings', signal), aborted]);
      signal.throwIfAborted(); owner.assertAdmission();
      transitionAcknowledged = true;
    } catch (error) { owner.blockAdmission(); throw error; }
    finally { signal.removeEventListener('abort', onAbort); }
  });
  const reloadBound = async (options: ReloadOptions, transitionSignal?: AbortSignal) => {
    // The SDK reload and resource loader both mutate shared session state.
    // Reject rather than queue: a barrier can itself try to reload.
    if (reloading) throw new Error("MCP bridge owner reload is already in progress.");
    if (transitioning && (!transitionAcknowledged || !transitionSignal)) throw new Error('MCP owner settings transition requires its authorized replacement batch.');
    transitionSignal?.throwIfAborted();
    // Reject instead of self-draining: commands inside an admitted prompt may
    // request reload, and its own preflight cannot await itself.
    if (admittedPrompts.size) throw new Error("MCP owner reload is blocked until admitted prompts settle.");
    reloading = true;
    try {
      owner.assertAdmission();
      await session.abort();
      transitionSignal?.throwIfAborted();
      owner.assertAdmission();
      await owner.shutdown("Piclaw MCP owner reload");
      owner.assertAdmission();
      let reachedStart = false;
      await reload({ ...options, beforeSessionStart: async () => {
        reachedStart = true;
        assertLoaded();
        transitionSignal?.throwIfAborted();
        await options?.beforeSessionStart?.();
        transitionSignal?.throwIfAborted();
        assertLoaded();
      } });
      // Public SDK does not call this hook for unbound sessions. A host
      // transition must not certify successful activation without the gate.
      if (transitionSignal && !reachedStart) throw new Error('MCP replacement did not reach its startup barrier.');
      assertLoaded();
      if (!transitionSignal) {
        transitioning = false;
        transitionAcknowledged = false;
      }
    } catch (error) {
      owner.blockAdmission();
      // A cancelled replacement can finish resource loading after the host
      // already quarantined its runtime. Retire that late owner as well.
      if (transitionSignal) owner.dispose();
      throw error;
    } finally { reloading = false; }
  };
  session.reload = options => reloadBound(options);
  reloadAdmissions.set(session, (options, signal) => reloadBound(options, signal));
  resumeAdmissions.set(session, () => { transitioning = false; transitionAcknowledged = false; });
}
