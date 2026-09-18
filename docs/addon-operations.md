# Generic add-on operations

Runtime add-ons can register a principal-scoped operation adapter during their startup import. Operations are disabled by default and require an exact operator-configured add-on/principal/target grant. This API contains no A2A or Iroh types.

## Register and use

```ts
// In the owning add-on's startup runtime entry, not inside a request handler:
const operations = globalThis.__piclaw_runtime?.operations;
if (operations?.version !== 1) throw new Error('Compatible operations API required');
const adapter = operations.register();

// After the add-on has authenticated its caller out of band:
const client = adapter.forPrincipal(verifiedPrincipalId);
const receipt = await client.admit({
  target: 'summarise',
  idempotencyKey: 'caller-generated-stable-key',
  text: 'Untrusted external request',
});
```

Registration captures the owning package slug from the host's startup import context. It does not accept an add-on slug from request data. The startup adapter also exposes `admitOutbound()`: it derives the current work/chat from the runtime AsyncLocalStorage context, checks live work status and applicable caps, persists blocking decisions and returns the verified work ID. There is no caller-supplied work ID or fabricated remote billing value. Adapters must recheck this before outbound requests.

The caller identity is still the trusted add-on's responsibility: `forPrincipal()` is not an authentication service. The host then checks that exact principal/target against persisted operator grants. Installing an add-on grants no execution permission.

| Method | Behaviour |
|---|---|
| `admit(input)` | Policy first; atomic idempotency key + operation + budget-work creation; returns a receipt, not completed output |
| `get(id)` | Current public snapshot, after caller ownership and live policy checks |
| `list(cursor?, limit?)` | Caller-only opaque-ID pagination; 1–100 entries, rechecks grants |
| `events(id, after?)` | Snapshot plus up to 128 durable events and a replay-gap flag |
| `subscribe(id, after?, signal?)` | Initial snapshot, then public lifecycle events; pass an AbortSignal for prompt idle-disconnect cleanup |
| `cancel(id)` | Idempotent outcome: cancelled, requested, or not_cancellable; does not abort a shared session |
| `resume(id)` | Re-admit paused approval/budget work only under the same grant |
| `continue(id, text)` | Re-admit input-required work; bounded cumulative input and the same work identity |

A transport must supply a live AbortSignal to idle subscriptions and abort it before closing the iterator. The implementation polls persisted events every 100 ms, with at most 64 subscriptions. This avoids coupling execution persistence to HTTP consumers. Stream disconnection does not cancel an operation. The operation service persists completion even with no subscribers.

## Operator configuration

Merge into `.piclaw/config.json`; do not replace other domains. No configuration or networking is enabled by this change.

```json
{
  "domains": {
    "operations": {
      "enabled": false,
      "grants": [
        {
          "addonId": "example",
          "principalId": "approved-client",
          "target": "summarise",
          "revision": "review-1",
          "allowedTools": [],
          "timeoutMs": 60000,
          "maxToolCalls": 0,
          "parentWorkId": null,
          "enabled": true,
          "approvalRequired": false
        }
      ]
    }
  }
}
```

The target is a publication/grant alias, not an operator chat ID. Each operation uses a new reserved `operation:<UUID>` session and `operation:<UUID>` budget work identity. Existing operator conversations are never reused. Continuations keep the same identity and submit only the new user turn. Cumulative input bytes remain bounded independently of the stored current prompt. If a model boundary pauses after the SDK has accepted a turn, resume sends a continuation instruction rather than replaying prior input.

Grants allow only implemented SDK built-ins (`read`, `grep`, `find`, `ls`, `write`, `edit`, `bash`, `powershell`); unavailable platform tools still fail rather than falling back. Empty tools means text-only. A tool-enabled grant must set a positive cap. Changes to grant revision or contents cannot silently widen already-admitted work: new model/tool boundaries recheck policy, queued work with changed grants is rejected, and paused work requires operator reconciliation.

**A tool grant is not a filesystem/container sandbox.** A granted `read` can read files available to the process, and shell/write tools have their usual authority. Do not grant those tools to an untrusted service principal without an appropriate external sandbox and data boundary. Text-only grants are the safe initial profile. Operation sessions disable ambient extensions, MCP, workspace context files, skills, prompt templates, themes and prompt appendices; they use a fixed host prompt and only the granted tool implementations.

Family/shared and isolated-container modes remain denied. No changes to Remote Peer addresses or credentials are made.

## Execution, budget and cancellation

The host executor uses AgentPool with mandatory tool controls and a model admission hook. Missing controls fail closed. Policy is rechecked before model streaming and tool admission; the hard tool cap is reserved after asynchronous hooks to protect parallel batches. Operation limits do not bypass existing provider/instance/task budget boundaries. Parent work is operator-owned configuration, never a wire-supplied budget ID. If task caps exist and no parent work is configured, admission is budget-blocked.

The caller abort signal is attached to the exact active session owner and follows recovery rotations. Pre-aborted work does not hydrate a session, and recovery does not retry after explicit cancellation. A requested cancel remains `cancel_requested` until the executor returns a truthful result. Completion may win a cancellation race. Shutdown requests abort but does not fabricate confirmation.

Public snapshots contain identity, target, work correlation, lifecycle state, timestamps, sequence, bounded final text and safe reason codes. They omit input text, private session IDs, grants, hidden reasoning, raw provider exceptions and tool traces. The current host publishes final text and lifecycle transitions, not arbitrary local attachment paths. Protocol-specific typed/artifact conversion remains an add-on responsibility and must not infer permission to expose workspace files.

## Durability and limits

- SQLite tables `addon_operations` and `addon_operation_events` are additive migrations in the existing protected store.
- At most 32 KiB request/cumulative continuation text, 256 KiB public final text, 16 nonterminal operations per add-on/principal, and 128 replay events per operation.
- `(addon_id, principal_id, idempotency_key)` is unique. Concurrent identical admission returns the same ID; same key with different target/text conflicts. Grant checks precede duplicate lookup.
- Key lifetime equals record lifetime. A host-only purge removes terminal rows in a principal namespace in batches of 1,000; budget audit data remains. Automatic expiry is not enabled by default.
- Queued work is safe to re-admit on startup. Previously working/cancel-requested work becomes `failed` with `interrupted_execution_unknown`; it is not blindly replayed after potentially irreversible side effects.
- Terminal outcomes are immutable. Resume/continuation require nonterminal status and fresh policy; no exactly-once external side-effect guarantee is made.
- Instance startup recovery, host install, and subscriptions are single-process ownership contracts. This does not add multi-worker leases or a distributed scheduler.

## Verification

Tests cover atomic concurrent deduplication, caller isolation, revoked access, family denial, limits, output redaction, operation-specific cancellation, completion races, replay/pagination, continuation, budget pause/resume, unknown-execution restart handling and retention. An actual SDK resource-loader/session test proves workspace context and extension factories are excluded, with only the granted built-in active. Orchestrator tests prove caller abort cleans up its listener and pre-aborted work does not create a session. Model/tool hooks are tested independently of providers.

Use the isolated launcher, for example:

```sh
bun run test:local --cwd runtime -- bun test \
  test/addons/operation-service.test.ts \
  test/addons/operation-host.test.ts \
  test/addons/operation-lifecycle.test.ts \
  test/agent-pool/operation-session-profile.test.ts \
  test/agent-pool/run-operation-boundary.test.ts
```

This is the generic foundation for issues #1335/#1336. A2A authentication, task store, HTTP/SSE semantics, files, operator UI, independent-peer conformance and release gates remain in `piclaw-addons` epic #118. No production deployment is included.
