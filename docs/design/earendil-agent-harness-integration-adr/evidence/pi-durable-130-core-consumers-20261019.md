# Seven native core consumers — 19 October 2026

Cold-source qualification admits all seven bundled add-ons and runs Restic
configuration through native SDK execution. This follows the packaged-seed
rejection recorded at `b33f20e96`.

## Adoption

Observability registers its existing handlers without starting process effects.
Native startup calls its public, idempotent preparation function with the runtime
owner check. The SDK's `pi.generation.beforeRequest` hook refreshes its prompt for
every request. Static skill metadata stays unchanged. Legacy clients retain their
real `session_start` handler; the native host never invokes it.

The host binds Observability's single global configuration key through an
owner-checked reader and transactional writer. Startup, request prompts and the
existing Settings API share that port. Released or denied reads throw. The
chat-scoped KV policy is unchanged.

Restic exports the existing configuration tool as a public factory. Its native
port captures the actual tool source and checks operation authority, cancellation
and startup-service identity. `setConfigWithAuthority` checks again after the
legacy-scheduler query and before acquiring the job lock or changing configuration.
An older service that lacks this method rejects the native write. Configuration
uses the existing startup service; these changes create no backup scheduler.

Installed source qualification checks both new profiles, their public exports,
exact registrations and source hashes. Observability has no tool declaration; its
metadata is checked without inserting a dummy tool. Foreign tools, handlers,
commands, changed exports or changed source still reject admission.

## Results

- Companion versions: Observability `0.1.18`, Restic `0.1.5`.
- Domain tests: 34 pass, 1 explicit real-backup integration skip, 203 assertions.
- Actual cold-process default factory: all seven add-ons installed; four synthetic
  provider requests; Restic read, configuration write and status; persisted result.
- Existing Settings GET/POST: persisted enabled configuration, non-default instance
  name and disabled Live Metrics; each model request receives the updated name.
- Legacy SDK constructors `SessionManager.create`, `open` and `inMemory`: zero calls.
- Bounded review found a global-KV routing error. The configuration port above fixes
  it; the follow-up review found no remaining blocker within that scope.

The first fixture linked Code Review to the add-on repository's incomplete test
module tree. Linking to the actual host dependencies, as the existing fixtures do,
fixed extension loading without a production change.

## Published seed and packaged runtime

Add-ons PR #215 merged as `a3444c5b557ca235893745b34989e985074646cc`.
Both authoritative workflows succeeded at reviewed source
`95dd52c131c66eaea3b026e5397090d7d4198df2`; main publication run
`39288113970` also succeeded. The stale routes check display was not used in
place of the completed workflow result.

The seed now contains publicly downloaded Observability `0.1.18` and Restic
`0.1.5`. Seven-core membership is unchanged. Catalogue, archives and the frozen
Bun seed lock were refreshed together; archive checksums are in
`release/core-addons.lock.json`.

The refreshed 47.30 MB package contains 25,580 files. A disposable global install
and explicit postinstall installed host SDK `1.2.0` and private SDK `1.3.0`.
Using only that installation, production seeding and a private owner/database,
the actual default factory admitted all seven consumers and settled one synthetic
native request: zero legacy sessions and zero outbound provider requests.
Backend stop, AgentPool shutdown, backend close, database close and owner release
completed with exit 0. The first probe omitted AgentPool shutdown and timed out
after printing its successful request result; that is not an exit-0 receipt.
The corrected probe reused the completed installation, not a source fallback.

## Combined-source qualification

The broad 52-file run recorded 642 passes, five failures and one error. The
failures came from missing `fd` in PATH, logical-versus-physical dependency-path
assertions, and missing qualification-local frozen Iroh dependencies. All affected
cases passed after setup/test-only repairs: both selected default-factory cases,
69 focused tests, then the remaining add-on-host case (63 assertions). SDK path
assertions still enforce the real host dependency boundary. Original failed
receipts remain failures; they are not presented as a new full green run.

At `928400e14`, subsequent stages each exited 0: Goal 49 tests/771 assertions;
Pele Chromium and WebKit each nine tests/393 assertions; engine and candidate
types. The production source was unchanged by the path/env assertion repair.
Hosted CI now checks out the separate approved core consumer source, runs Goal
qualification, and exercises Pele in both engines. Its Goal source tree is
byte-identical to the retained `9d9eb284` fixture.

Current-head hosted core checks remain required. Whole-real-history and public-API
acceptance gaps are unchanged. No managed runtime installation, restart or live
migration occurred.
