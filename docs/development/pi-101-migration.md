# Pi 1.0.1 source migration

This branch selects exact Pi 1.0.1 for Piclaw's core SDK and extends package
admission for that release. Adapter remains the default MCP engine; codemode
Auto remains the default. Native activation, safe Apply and deployment have
separate acceptance gates.

Upstream git head: `a7229ddc21810d6245105978033b7df645ecc2f7`.
Piclaw base: `23dc0aa19b702ab820dd72f7fe6944fc307d8bde`.
Qualification uses Bun 1.4.2 on Smith LXC, disposable profiles and synthetic
provider/MCP endpoints. No live credentials, inference or restart.

## Version boundaries

- Exact admission now supports 0.99.1, 1.0.0 and 1.0.1, each with its own eight
  package SHA-1/SHA-512 map, git head and provider-receipt fingerprint.
- Rui requested removal of the repository's `historical/` directory. The old
  source archive, replay runner and archive-integrity tests are removed. Git
  history retains prior source versions. Original versioned receipt JSON remains
  unchanged; it is not replayed or relabelled as current qualification.
- Current 1.0.1 tests execute new exact-target fixtures. Historical receipt
  validators check their archived artifacts without comparing them to the
  currently installed SDK. Separate 1.0.1 validators check current package,
  CLI bundle, OAuth and provider bytes against newly measured receipts.
- The admission payload test excludes nested `node_modules` directories when
  comparing package-owned bytes. Piclaw and the standalone admitted consumer
  have different dependency layouts; lock closure is checked separately.
- Mainline and production were not changed during qualification. The global
  installed SDK remains 0.99.1 until a separately authorised deployment.

## Changes requiring new qualification

Pi 1.0.1 replaces OAuth `clientMetadataUrl` with
`clientMetadataDocument(metadata)`, adds callback path selection and project
MCP overrides, caps codemode output at 16 Mi characters / 100,000 items, and
removes npm-shrinkwrap. The explicit dependency overrides and lock keep the
selected package family exact. Old callback-port blocker fixtures were
incompatible with the new port-conflict rejection: successful login probes now
leave the callback port free. No provider behaviour or timeout was weakened.

## Completed gates

- Sixteen comparison archives (eight each for 1.0.0/1.0.1) verified by SHA-1 and
  SHA-512; standalone 1.0.1 installed archive bytes matched 2,545 files.
- Actual exact package admission passed in a single-direct-dependency consumer,
  including eight published-tarball / installed-tree checks and guarded Bun
  imports. Provider inventory: 42 providers / nine OAuth owners.
- Admission mutation tests: 22 tests / 144 assertions. Public MCP types retain
  the same ten missing-seam diagnostics. No native-security waiver.
- Focused SDK, adapter, OAuth/CIMD, callback, project override, engine/fence,
  codemode and keychain slice: 136 tests / 625 assertions. Source review gaps
  in reload, storage failures, stale callback-port ownership and replacement
  assertions were corrected and retested.
- Eight actual public MCP runtime children passed, including two CPU profiles.
  Whole-child timings include imports, synthetic responses, reload and disposal;
  no speedup or live-provider claim.
- Fresh Codex device cases: six; Copilot/Kimi device cases: 22. Device/cloud and
  refresh/storage tests plus historical receipt checks: 20 tests / 956 assertions.
- Browser/manual matrix: 20 browser cases plus 17 Anthropic copy-code cases.
- Official packaged CLI: ten OpenAI/Codex cases in independent loopback-only
  OS network namespaces. Synthetic success, denial, bad state, cancellation and
  provider-without-model rejection; clean restored-editor exits. Bundle: 74 JS
  files. Credentials remain in disposable profiles.
- Private Anthropic login UI: ten Chromium/WebKit cases / 1,342 assertions;
  full recording/export checks without private authentication values in rows,
  broadcasts, logs or recordings. No family gateway/live accounts.
- Optional current CLI/browser receipt replay: two tests / 97 assertions.
- Current receipt/admission validators: 28 tests / 1,029 assertions. Earlier
  review-fix activation/archive/payload checks passed eight tests / 164 assertions;
  the archive check was subsequently removed with the directory at Rui's request.
- All five type projects passed; compose keeps 95 unchanged transitive diagnostics.

The first full local gate found nine auth lifecycle/cross-process tests still
calling frozen 1.0.0 fixtures. It was stopped (exit143), retained, and both
callers now select separately created 1.0.1 fixtures. The corrected focused
gate passed ten tests / 53 assertions, including the explicitly enabled
pre-write-holder crash case. A second gate exposed two release-churn assertions
still requiring 1.0.0; correcting only the active target passed nine tests /
226 assertions. The third gate was interrupted for the requested historical
folder removal. All three runs are retained and none is a passing full gate.
The revised tree passed full `make ci-fast`: **6,095 runtime tests, 8 skipped,
zero failed**, 39,748 assertions (1073.44 seconds), then 25 feature and 9 web
build tests. Frozen tree: `0da34aec43b243fdd7fd57317abdcea5a2ce8d60`.
Log SHA-256: `27cbffb05b66c16d445cc6a640d83fe98305849c1f0397fe0c74f9f6d2a3f6f4`.
Final focused validation passed **55 tests / 1,380 assertions** (11.96 seconds),
with pack hygiene, environment checks and frozen-tree identity passing.
Publication adds this validation prose only. There is no historical replay
stage after the requested folder removal.

## Retained blocker

The public synthetic native transport failure probe observes that reload
resolves and starts a replacement even when the previous transport's close
rejects. The first transport remains unclosed and no extension error surfaces;
awaited runtime disposal closes the replacement. Reload success cannot certify
transport shutdown. This probe does not execute Apply or establish real socket
teardown. Safe Apply, full native capability/security, production Delegate
policy/auth/budget/environment, and the live canary remain separate work.

## Evidence

Version-specific JSON under
`docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-101-*`
records package admission, providers, MCP, CLI, device, browser and private-UI
results. The CLI artifact is
`runtime/test/fixtures/earendil-package-admission/cli-artifact-1.0.1.json`.
Local raw logs and separately profiled children are under
`/workspace/tmp/earendil-101-qualification/`. Failed fixture/guard/receipt-format
attempts are retained there; only corrected passing runs are qualification.
