# Provider stalls and prompt startup

Three reproduced waits are bounded: automatic transport-directory hints before prompts, OpenAI-compatible usage scans after terminal output, and foreground runtime hydration. These tests do not identify the cause of every reported cross-conversation stall.

## Reproductions and changes

- Two real SDK sessions share a synthetic OpenAI-compatible HTTP provider. One response stays open while the other returns text. The second session completes and abort settles the first, including with Piclaw's usage wrapper installed. The basic stream path has no reproduced cross-chat mutex.
- A held registered transport directory delays both `before_agent_start` callbacks. Automatic prompt hints now wait at most one second per transport and coalesce unresolved work by registration. Explicit `chat` directory requests retain their existing wait semantics and can join the same work. Unregister/replacement prevents late results from applying to another registration.
- A response can send `[DONE]` without HTTP EOF. Usage scanning now stops at that marker, ignores later usage and cancels its cloned reader. On terminal output or error, provenance capture gets at most 100 ms to settle. Outstanding cloned readers are cancelled without awaiting tee cancellation, which may depend on the primary reader. Missing late provenance remains unknown; terminal delivery takes precedence over optional accounting.
- Runtime hydration previously preceded the prompt watchdog. Foreground callers now use a bounded startup wait in the orchestrator and web preflight. The startup limit defaults to the run timeout; `startupTimeoutMs` can override it for internal callers. Nonpositive limits retain disabled-timeout behaviour. Caller cancellation affects only its wait, not shared manager-owned creation.

## Ownership

Creation and cached deferred-seed hydration retain manager-owned eviction protection until actual settlement, including error/disposal tails. A timed-out caller cannot start its abandoned prompt when the runtime later becomes ready. Other authorised callers may still join the original creation. Scheduled dispatch retains its outer deadline and lane ownership; its startup wait is not raced away by an inner timeout.

Caller cancellation is installed before post-hydration preflight and checked at subsequent admission boundaries. Per-attempt model dispatch checks the prompt deadline and caller cancellation again after SDK hooks. These checks prevent a late hook from starting a provider request after the caller's deadline. Signal-ignoring hooks retain their lane until settlement; the host does not pretend that their owned work has stopped.

Web startup errors use normal classified failure handling and terminal persistence. They do not bypass cleanup into queue retry with a stale thinking status. Foreground preflight failures clear their tracked phase and preflight marker.

## Qualification and limits

Disposable HTTP server, synthetic credentials and in-memory sessions only. No authenticated provider research, live installation or restart. Regressions cover real streaming concurrency, held directory discovery and explicit joining, `[DONE]` without EOF, post-DONE usage, abort-ignoring clone scans, startup timeout/late completion, retained hydration protection, ordinary model-dispatch cancellation and scheduled deadline ownership.

The full local gate passed 6,770 tests with 74 skips and zero failures, followed by 25 feature and nine build checks. TypeScript and diff checks passed. Independent reviews inspected source and test receipts; they did not execute the gates.

Remaining limitations: arbitrary hooks can ignore cancellation, explicit transport discovery remains unbounded, the directory deadline is per transport rather than aggregate, and startup limits bound caller waiting rather than creation lifetime. OAuth refresh still serialises file-backed credential mutation. Browser connection saturation, remote provider behaviour and actual fleet incident timing require separate evidence. No general fleet-lockup resolution is claimed.
