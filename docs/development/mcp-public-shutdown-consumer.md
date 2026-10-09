# Piclaw consumption of adapter shutdown acknowledgement

Piclaw awaits the adapter's public shutdown handle before reloading an MCP
extension generation. A failed or timed-out acknowledgement blocks replacement
and already-captured prompts. Native selection stays unavailable.

Adapter source pin:
`github:piclaw-bot/pi-mcp-adapter#2400aec570d3c1b379ebbd6941590bdea54cd83d`.
The adapter's exact-head Bun CI and1,419-test suite passed before this pin was
selected. The public API is `createMcpAdapter({ onLifecycle })`; it exposes
`shutdown(reason): Promise<void>` per factory installation.

## Generation and credential lifetime

The production factory requires the lifecycle callback. An older adapter that
silently drops the option is rejected. Synthetic lease-only tests can retain
an optional lifecycle, but production has no success fallback.

The session reload wrapper blocks captured prompts, rejects while any admitted
public prompt is unsettled (including input/auth/extension preflight), aborts
active work and awaits the old adapter handle before invoking the SDK reload.
The prompt guard registers ownership before invoking the SDK. Reload from an
admitted command is rejected rather than self-drained, preventing deadlock.
Disposal fences admission before synchronous SDK abort listeners can reenter.
Admission is rechecked after awaited abort/cleanup, and SDK settings/loader/
barrier/discarded-extension failures leave the generation unhealthy. The SDK's
extension-shutdown dispatch can log and suppress errors; that dispatch alone
is never used as acknowledgement. Lease release remains after the adapter's
registered shutdown handlers and the independent public handle settlement.

Public cleanup has a30-second bound. Deadline expiry sets sticky failure and
keeps replacement admission blocked. A timeout is not proof of transport
closure. Direct synchronous SDK disposal starts cleanup but cannot return an
acknowledgement; the bridge retains its scoped credentials until the raw
cleanup promise settles, even if the bounded acknowledgement times out.
No native credentials, tool exposure, engine switching or service restart is
introduced by this slice.

## Tests

- Lease/public ownership slice:25tests/94assertions, including delayed cleanup,
  rejected/hung close, stale/partial loading, direct-dispose lease hold after
  deadline, missing lifecycle, SDK settings/loader/barrier/discard failures,
  preflight/reentrant reload, disposal during await/synchronous abort, and
  same-turn disposal before queued SDK prompt invocation.
- Actual public Pi1.0.1 fixture: successful old-process shutdown before reload,
  preserved session/history, sole replacement, and injected public stdio close
  rejection. Failure blocks SDK reload, replacement and captured prompts while
  retaining the scoped lease. Two tests/six assertions passed; no external
  network or provider execution.
- Existing bundled adapter/core/exact1.0.1 SDK pipeline/OAuth/override/native-
  negative slice:28tests/151assertions passed. The native close-failure blocker stays unchanged.
- Five type projects and strict fixture compilation passed;95existing compose
  transitive diagnostics unchanged.

Initial fixture failures came from admitting a PID before MCP readiness and
binding the SDK without Piclaw's `onError` listener, which disables its reload
restart path. The fixture now observes public connected status and matches
production bindings; timeouts/assertions were not weakened.

Independent consumer review found and corrected SDK failure-admission,
preflight, disposal-reentrance and queued-prompt ownership gaps; final review
cleared the corrected source with targeted regressions.

The first full runtime gate passed6,145tests, skipped8 and failed one family
fixture that wrote its owned configuration with0644permissions. Its unchanged
isolated run reproduced5pass/1fail; adding0600only to that fixture creation
passed6tests/50assertions. The strict reader, family policy and assertions are
unchanged. The failed receipt is retained.

The corrected frozen tree `318d507540bf6b2e448ef534b227e4203641a09d` passed
`make ci-fast`:6,146passed,8skipped,zerofailed,39,991assertions in948.49seconds,
plus25feature and9web tests. Log SHA-256:
`f5899c66774edf07aad321821c9a956743b0df2a5b55500a07a65041345372ff`.
Final focused33tests/158assertions passed7.16seconds with the same tree.
Publication adds these validation lines only. This is adapter-only ownership safety. Safe native Apply, ten
public API gaps, provider/login/Delegate parity and live canary criteria have
separate acceptance requirements.
