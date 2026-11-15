# Native model-request authority: missing correlation contract

Native generation requests use an application-owned `beforeRequest` hook to bind
an exact task/conversation and source guard to the request's abort signal. The
factory rejects unmatched signals. Manual compaction summary requests bypass this
hook, including requests made directly from a resumed `summarize` checkpoint.

## Inspected public surfaces

- `GenerationHooks.beforeRequest` receives task/conversation identity and runs for
  each generation attempt, including recovery.
- `CompactionHooks.beforeCompact` runs during range selection; a saved summary
  checkpoint skips selection and this hook on reopen.
- `HarnessOptions.models` is shared by task runtimes. The model method receives
  request options but no public task identity.
- `HarnessOptions.env` receives conversation identity, not exact task identity.
- `createRegistry()` prohibits replacing built-in tasks. Exporting `CompactionTask`
  does not grant replacement through that registry.

These findings describe the installed candidate's inspected API, not all possible
future SDK integrations. No dependency pin or SDK code was changed.

## Required public contract

Provide an application-owned callback at every actual model request, independently
of a conversation's selected extensions. It must run for generation and compaction,
including saved summary checkpoints and retries, and expose:

- Exact task and conversation identity, plus request abort signal.
- A documented request-attempt identity/lifecycle suitable for durable host binding;
  distinguish a recovery resend from a newly authorised provider attempt.
- An awaited admission point before credential/provider work, and a verified
  post-auth dispatch point before the actual provider send.
- Original terminal assistant usage/identity before cross-package projection, with
  a joinable completion path for settlement and unknown-outcome retention.

The host can then reuse existing operation provenance, budget work, reservations
and settlement. This requires no new accounting ledger or legacy session emulation.
A public task-bound model port could satisfy the contract as an alternative to a
callback; an unscoped shared model object does not establish it by itself.

## Rejected shortcuts

A runtime-owned manual compaction ID and `changingModel` flag establish maintenance
exclusivity, not the origin of an arbitrary unmatched request. Accepting any signal
while maintenance is active would let that request borrow compaction authority.
Independent bounded design review rejected this fallback. It would require the
actual admitted task's request signal, acquired through a qualified public path,
and an exact identity comparison; that signal is the unresolved part.

Do not weaken the unmatched-signal denial, classify requests by prompt text or
cache options, mutate private scheduler/provider state, or fabricate SDK lifecycle
hooks. A `beforeCompact`-only mapping cannot qualify checkpoint recovery.

## Evidence and scope

The existing manual-maintenance tests qualify ownership and joining with a separate
model port. Default-factory tiny-history no-op tests do not qualify summary model
requests. A single nontrivial factory experiment timed out at its existing
30-second limit and was fully reverted; no passing or causal proof is inferred.

The actual factory generation/Delegate hook is implemented and bounded-qualified.
Accounting and factory model-backed compaction recovery are incomplete. Budget
caps remain denied; no live activation or migration has occurred.

## Temporary adapter follow-up

The user-authorised registry-reader shim now supplies the actual task invocation
scope without changing installed SDK files. Generation source capture has moved
to the model boundary and no longer depends on selected extension hooks or stored
extension rewriting. Manual summary requests can use the exact admitted maintenance
task. The earlier hook-only limitation above explains the original gap; it is not
the current generation admission implementation.

Upstream draft PR https://github.com/earendil-works/pi/pull/11104 proposes a supported
`taskModels(scope, models)` API to remove this adapter. Neither the shim nor that
identity-only proposal implements request reservation, atomic dispatch or settlement.
Factory adoption of recovered maintenance and accounting remain unqualified.
