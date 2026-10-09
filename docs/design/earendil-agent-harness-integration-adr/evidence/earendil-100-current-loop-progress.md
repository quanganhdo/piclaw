# Pi 1.0.0 current-loop migration (#1492)

The standalone package admission, full serial regression gate and all five Piclaw typecheck stages pass under Bun 1.4.2. Deployment, full 1.0.0 provider/CLI acceptance and native MCP switching remain separate gates.

## Exact package admission

Target: `1.0.0`, gitHead `a13d35a742c6ef8462812a28fbe1d8c8b7431c32`.

The disposable consumer declares only `@earendil-works/pi-coding-agent: 1.0.0`. Installation used a private Bun cache and `--ignore-scripts`; 121 packages installed, with two postinstalls blocked. All eight existing family packages resolved to 1.0.0 and matched the official SHA-1/SHA-512 archives and extracted trees. The separately assessed optional `pi-durable` is absent from this consumer and the Piclaw candidate.

The revised `scripts/check-earendil-package-admission.ts`:

- accepts only Bun execution; `--node` and direct Node-probe execution reject;
- retains the exact 0.99.1 hashes and historical receipt validation;
- adds separate `registry-1.0.0.json` and `provider-auth-1.0.0.json` fixtures;
- verifies six coding-agent factories, MCP root/OAuth functions, Bun OAuth registration and 42 provider metadata entries;
- rejects eight removed core subpaths and checks six removed root exports are absent;
- rejects an installed `pi-durable` package, including aliased or nested packages;
- rejects non-zero recorded network or child-process attempts, even when package code catches the guard error.

The provider metadata matches 0.99.1, but it was measured independently on 1.0.0. Login behaviour and credential lifecycle have not been requalified by this inventory.

The final standalone run used a fresh Linux network namespace with no external interfaces, dropped back to the agent UID/GID, `no-new-privs`, an empty inherited environment, and a disposable home. Bun module/native guards recorded zero network and child-process attempts. The checker itself reports `networkSandboxed: false`; the external namespace is a run-specific control. There is no filesystem sandbox or exhaustive syscall audit. No live credentials, provider inference or MCP server connection was used.

Local receipt: `/workspace/tmp/pi-100-retarget/admission-1.0.0-final.json`, SHA-256 `794ace4904daaa79b4c3d4363cb3b32d89866ff49d077bb39985aa0050ab567b`. The matching `.exit` is zero and `.stderr` is empty. Retain the earlier admission receipt separately.

## Host-neutral result contract

The live scheduler depended on the removed core `Result` export through the service-effect stores. `service-effects/contracts/result.ts` now owns the same structural `ok/value` or `ok/error` union and constructors. Eight store interfaces, adapters and independent fakes use it. No storage schema, effect authority or operation semantics changed.

`contracts/execution-env.ts` now defines Piclaw's execution port and output-update operations. It uses public Chord context types/helpers and public coding-agent truncation helpers. The adapter, resolvers, fakes and current authority/output/reader tests use this contract. Chord is an exact direct dependency. No local backend or Harness is activated by this port.

The obsolete local SDK backend and Harness/Pico3 assignments/semantic tests are preserved byte-for-byte in `historical/earendil-0.99.1/source.tar.gz`, sourced from checkpoint `eea481648`. The archive includes the old source/test layout, package manifest and lockfile; it has no installed packages or credentials. One pre-existing symlink, `runtime/extensions/node_modules -> ../../node_modules`, resolves inside the extracted consumer. Its digest is independently pinned by the replay script and current boundary test.

`bun run check:earendil-history` installs into an owned temporary consumer with a private cache and scripts disabled, verifies all eight exact 0.99.1 dependencies, compiles the archived runtime, and runs its explicit 45-file list through the isolation/niceness launcher. The original 40 service-effect files passed 459 tests and 7,979 assertions; the five historical auth fingerprint-receipt files separately passed nine tests and 741 assertions. The combined 45-file replay passed 468 tests and 8,720 assertions in the full gate. These results qualify historical evidence only. Current production imports of old subpaths, archived modules and pi-durable are forbidden by the new boundary tests.

The five receipt files compare exact old SDK and lockfile fingerprints. They run against 0.99.1 rather than the installed 1.0.0 family. The archive digest and ordered 45-file list digest are independently pinned in the runner and boundary test. Prior external-auth documentation retains its point-in-time command; its old test is available in the archive, while current coverage is `provider-external-auth-100.test.ts`. That external-auth file is not one of the 45 mandatory historical replay files.

## Frozen-candidate full gate

On 1 October 2026, `make ci-fast` passed against frozen tree `1f0846661d8c634f453b2d247f124a83a3c2dd64` with no edits during execution:

- Current 1.0.0 runtime: 5,898 passed, eight existing skips, zero failures; 37,164 assertions across 848 files, 879.59 seconds.
- Feature tests: 25 passed, 211 assertions.
- Classic and Visual frontend builds passed; nine web checks passed with 26 assertions.
- Separate frozen 0.99.1 replay: 468 passed, zero failures, 8,720 assertions across 45 files. Controlled replay completed in 67 seconds.
- The terminal-settlement aggregate passed in 7,997.82 ms under its unchanged 15-second timeout. Its earlier timeout remains recorded below.

Full log: `/workspace/tmp/pi-100-retarget/ci-fast-final-v3.log`; exit marker zero; SHA-256 `c1702440ee5a47f913ad638d8434f887f5d2fc2cee436f07836291694b503cc4`. Only evidence documentation was updated after this frozen gate. No current/history test counts are combined into a single qualification total.

## Focused checks and retained failures

- Result/store/scheduler contracts: 128 passed, 1,786 assertions across nine files.
- Admission checker: 21 passed, 133 assertions, including Bun-only refusal, exact 1.0.0 drift and removed-export tests.
- Focused strict typecheck passed for the checker and result contract.
- Focused lint passed after documenting TypeScript's separate result type/value namespaces. Final checker/result smoke passed 23 tests and 144 assertions; these overlap the sets above.
- Full candidate typecheck: 179 initial diagnostics, 124 after Result, then 50 after the host-neutral execution port. Final runtime/scripts/settings/panes/compose checks pass; compose retains 95 baseline diagnostics. Earlier failures are preserved.
- Current execution/reader/fake/hostile contracts: 40 passed, 273 assertions across six files.
- Exact 1.0.0 provider inventory, OpenAI/Codex synthetic manual PKCE/refresh/rejection/cancellation and core contract checks: eight passed, 114 assertions. Six synthetic credential-lifecycle scenarios also pass. Full provider-route/token/URI/history acceptance remains owned by #1495/#1458.
- The complete current agent-control preflight passed 266 tests, one existing crash-recovery skip, zero failures and 1,077 assertions across 27 files. Its shell lost the exit marker on turn interruption; the process was observed to completion and both controlled stages reported exit zero. The recovered result is recorded separately.
- Final pack hygiene passed with 24,746 files after frontend build; all five typechecks passed again.
- Final admission/current-version/result/historical-boundary/manager-fence/public reload/plan-bridge set: 61 passed, zero failures, 334 assertions across seven files. Synthetic public reload preserves both chat identities/history and removes the old owner tools; real MCP cleanup and active inference cancellation are still unqualified.
- Historical replay first received a directory argument that selected all tests; it was stopped and replaced with the exact manifest list. A later parallel historical run hit the existing 5-second SQLite hardening timeout; serial replay passed without assertion/timeout changes.
- The first full candidate gate stopped before tests on unstaged deleted paths in the Git-backed source audit. Staging the intended migration fixed that. A later gate hit a 15-second terminal-settlement timeout (15,913 ms); its isolated retest passed in 7,905 ms without changing assertions or timeout. Two incomplete runs were stopped with SIGTERM after stale mandatory version guards were found. All failed/aborted logs are retained; none counts as a passing full gate.
- Agent-control preflight exposed three old-receipt/current-SDK fingerprint mismatches and an ENOENT from moving a queued receipt file while that first preflight was active. Moving all five old fingerprint checks to the pinned historical consumer fixed the scope error. The unchanged corrected candidate passed the complete preflight.
- The initial test invocations failed at the launcher's argument separator. The passing runs call the existing exported `runLocalTestCommand` with an explicit argument array, preserving niceness and filesystem isolation.
- A later independent boundary review confirmed dormant-backend isolation. Delta review caught an accidental `FileInfo.kind: other` widening, now reverted to the original three values, and an empty historical-local test group, now removed. The archive digest is pinned independently of its manifest. The review also identified a pre-existing terminal-control sanitisation concern; this migration preserves the existing byte/control behaviour and does not claim terminal-output safety. Final staged review and the subsequent 45-file receipt-isolation delta review found no blocking source defect; both were read-only and did not execute tests.

PR #1496 merged at `eea4816484ff80a917b43ed33cd93ea55eaf2948` after exact-head CI `36931870180` passed. The merged tree equals checkpoint `958ac1852`; post-merge manager/pool checks passed 98 tests and 412 assertions. Its worktree and branches were removed. The upgrade worktree advanced to that merge without discarding uncommitted changes.

Next: publish the reviewed PR, then exact-head hosted and post-merge verification. Native security gaps, provider-flow qualification and canary approval remain separate gates. Smith's running service was not changed.
