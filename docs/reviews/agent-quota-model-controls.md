# Agent quota and model/thinking controls

The agent-facing quota and combined model/thinking controls pass local complete qualification. The frozen candidate is `665c63bd5f9bccae322df0e44212e95c1d352179`, tree `523ae761b3ed5d07b3058c33d63914cb902f3360`, runtime tree `a5f5133f5960674746673961cc7ab9e211704780`.

## Checks

| Check | Result |
| --- | --- |
| Complete runtime suite | 6,603 passed / 8 skipped / 0 failed; 43,136 assertions; 932 files; 666.74s |
| Focused quota/model/discovery/preparation integration | 170 passed / 2,403 assertions; 9 files |
| Settings/pane contracts | 25 passed / 246 assertions |
| Web build tests | 9 passed / 26 assertions |
| Types and scoped lint | Passed; 95 unchanged transitive frontend diagnostics |
| Static policy, dependency, environment, pack and stale-dist checks | Passed |
| Explicit 6.1 source reviews | Scoped CLEAR after corrections; reviewers ran no tests |

Full gate ran 6 October 2026 07:56:45–08:08:01 UTC. `/workspace/tmp/agent-quota-full-v2/ci-fast.log`, SHA-256 `496edcf64bf15f2b6d926868cb3bba7d978ba388350247431133bc938aa86908`. Final head/tree and clean worktree matched the frozen inputs.

## Corrections and retained failures

- Initial implementation delegation timed out; draft files were inspected and tested, with no approval inferred. Subsequent delegation used explicit `github-copilot/gpt-6.1-sol` only.
- Typechecking caught a discriminated-union narrowing issue; corrected before final qualification.
- Source review found raw authentication exceptions reaching the existing shared warmer's debug logger. Logging now omits exceptions; a real-warmer fixture captures both modules at debug level and checks secret-free logs and output.
- Follow-up review found an invalid settings property masking enabled-model scoping. `set_model` now consumes the public `ctx.scopedModels` snapshot; its regression uses the real context contract.
- The first full run failed four closed manifest/default-activation snapshot checks: 6,599 passed / 8 skipped / 4 failed, 42,635 assertions. Exact preparation rows and snapshots were added, retaining protected parameters/results and conservative non-replay policy. Failed log SHA-256: `6f85ecc47581e65d0ec1664078767a78efbd284a4d53dd971116ad2e271ffc83`.
- The first policy correction had invalid fields and stale exact counts; those failures are retained. Final focused integration and the fresh complete run both passed. No deadlines or assertions were relaxed.

## Boundaries

Quota support uses four existing adapters; other providers receive explicit unsupported results. Default lookup verifies runtime credentials but does not call quota endpoints. Shared refresh can reuse fresh cache/in-flight work. Bounded waits do not cancel underlying authentication/provider work; results state this. Missing adapter diagnostics remain uncertain rather than invented. Quota retrieval does not grant spending permission.

Both new tools are active by default and after reset. Existing controls and slash commands remain available. Model/thinking mutation uses the session API and does not change startup defaults. No live provider account was queried, no production configuration or hardware workload changed, and no package installation into the running runtime or restart occurred. Publication changes after the qualified snapshot are documentation/receipts only and require runtime-tree parity verification.
