# Temporary task-bound model identity shim

`runtime/durable-engine/src/task-model-boundary-shim.ts` is a candidate adapter for
an upstream SDK request-boundary API. It decorates the public `RegistryReader`:
each exported task phase runs in an invocation-local async context holding its
actual `TaskRuntime.taskId`, `conversationId`, `signal`, task kind and phase.
Definitions, checkpoints, versions and installed SDK files are not mutated.

The application model policy can read that context only when its request signal
is the exact invocation signal. Missing, unrelated and aborted signals deny.
The default factory uses it only for its exact owned manual-maintenance task,
`pi.compaction`/`summarize`, while generation retains its existing source hook.
An active maintenance flag alone is never authority. Automatic/generation-owned
compaction is not granted this fallback.

## Upstream shape and removal

An SDK implementation should supply this identity directly at each model request,
independently of selected conversation extensions and on every recovered phase.
The temporary adapter instead wraps phase entry because the current public registry
has no request callback. Its context is task-invocation identity, **not** a durable
per-provider-request ID. Do not use it alone to deduplicate billing or claim atomic
dispatch. Those contracts still need pre-auth reservation, per-send identity and
terminal settlement; caps remain denied.

When the SDK provides the callback, replace `withTaskModelRequestScope` at harness
construction and `taskModelRequestScope` in model policy, then delete this adapter.
Keep tests for exact signal matching, async propagation, phase restart/recovery,
registry replacement/subscription, cancellation and absence of scope leakage.
No dependency pin change is needed for this local adapter.

## Current evidence limits

The direct adapter test and manual compaction fixture cover exact signal authority
through awaited phase execution, observer detach and maintenance reconciliation.
The actual default factory's existing ordinary-conversation regression passes.
Dedicated saved-summary checkpoint replay and a full actual-factory model-backed
compaction regression still require qualification; no claim of arbitrary-crash,
exactly-once, accounting or broad automatic-compaction coverage is made.

Additional local checks cover concurrent phase isolation, registry replacement
without changing old snapshots, and disk-backed close/reopen directly into a
synthetic task's persisted summary phase (3 tests / 17 assertions). This proves the
decorator follows recovered phase execution; it is not real compaction checkpoint
recovery evidence. A bounded shim-only review found no scope/cache/receiver blocker.
Upstream draft API proposal: https://github.com/earendil-works/pi/pull/11104.

A separate disk-backed test now runs the SDK's actual `pi.compaction` task, stops
with its summary checkpoint persisted, and reopens the same file. It verifies the
same task/conversation, a fresh invocation signal and summary-phase correlation
(13 assertions). The synthetic provider is held before its effect gate; only the
recovered attempt completes a model call. This is clean-close recovery, not a
SIGKILL or provider exactly-once test. Default-factory adoption of previously
admitted maintenance remains separate and unqualified.

Final bounded local run: the shim, actual SDK compaction checkpoint-reopen and
manual maintenance files pass 9 tests / 151 assertions. The actual factory's
model-backed manual compaction passes 31 assertions. Three scoped typechecks pass.
Automatic compaction is disabled only in the fixture; the SDK manual compaction
path still selects and summarises its range. The test requires both an additional
provider call and a persisted compaction entry, so a no-op cannot satisfy it.

The recovery test was independently reviewed for its clean-reopen claim. These
receipts qualify the temporary adapter's identity propagation and the manual
factory happy path. They do not qualify factory adoption of pre-existing
maintenance, automatic/overflow compaction, crash-exactly-once behaviour or native
budget reservation/settlement. No new CI run or deployment is part of this receipt.

## Source-admission consumer

The default factory now captures generation authority at the model boundary using
the shim's exact task/conversation/signal scope. It awaits public `captureRunSource`
before auth, then rechecks the captured source, invocation cancellation and current
Delegate policy after each admission await and in the host header callback.

This replaces the extension-selected `beforeRequest` hook, its signal map and the
startup code that appended a required source extension to stored selections.
Explicit extension arrays and filters now remain unchanged. The old extension name
is registered without hooks only so persisted selections still resolve.

Actual-source bounded review accepted the new capture and relay paths. Four focused
revocation/cancellation/stale-harness cases pass 124 assertions. Prior actual-factory
cases pass 325 assertions and the model/scope files pass 102 tests / 2,494 assertions.
These are source-identity checks; the SDK's awaited header-to-provider interval is
unchanged and is not an atomic dispatch or accounting guarantee.
