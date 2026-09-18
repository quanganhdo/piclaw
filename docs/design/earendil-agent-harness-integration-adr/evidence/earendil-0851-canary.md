# Disposable 0.85.1 upgrade and rollback gate

**Executed on piclaw-test after Rui's 17 September approval.** The targeted baseline→candidate→exact-baseline rollback and browser smoke receipt is in [canary results](earendil-0851-canary-result.md). The original guest snapshot was restored and the VM returned to its stopped state. Full-suite and unrun scenarios remain explicit; no production merge/deployment follows automatically.

The authorised upgrade/restart/rollback receipt is a prerequisite for PR B merge. Its rollback unit is the exact baseline 0.84.4 runtime/dependency set, restored as one coherent change rather than isolated package downgrades. No production schema migration or session rewrite is intended. Broader inactive HC completion is tracked separately as PR C and does not waive this canary gate.

## Recorded approval

Rui approved public SessionRepo coverage for B and the disposable test with “Yes. Use piclaw-test” at 2026-09-17 06:58:17 UTC. Live checks found VM 900 stopped on radxax4; its current address was 192.168.1.236, not the historical 192.168.1.78. The test used synthetic state, a local deterministic provider and a separate service/profile with egress restrictions. No production credentials or Smith state were copied.

Any future canary run must recheck guest identity/use. Paid-provider calls, production deployment and merge remain unauthorised.

## Preparation (before touching the target)

1. Record the approved guest identity, OS/architecture, service manager, current executable and profile/workspace paths, active users and network policy.
2. Build immutable candidate and baseline packages from their recorded revisions; record SHA-256, version, dependency family and archive listing. Candidate version text alone is insufficient because both packages may be Piclaw 3.1.2.
3. Capture an owned disposable-state checkpoint and service configuration. Include test session JSONL, SQLite, add-on configuration and fixture identities. Record hashes/row counts. Keep the original checkpoint immutable.
4. Use separate release directories and a temporary test profile. Deny outbound provider access or supply a deterministic local provider. Do not mount/copy Smith `/workspace/.piclaw` or auth files.
5. Record which assertions are public SessionRepo/current-loop tests and which require Harness promotion. Keep Harness/pi-server disabled throughout.

## Baseline → candidate → baseline sequence

| Phase | Required observation |
|---|---|
| Baseline start | Exact baseline artifact/source receipt; health HTTP 200; test profile isolated; no unrelated sessions |
| Seed baseline fixtures | Synthetic saved session, queue entries, tool call/result, explicit usage provenance and selected model/effort; record IDs, hashes and expected counts |
| Controlled stop | Stop only the approved target service; verify process exit and retained test state |
| Candidate start | Exact 0.85.1 package closure and artifact hashes; service active; health succeeds; no pi-server process and no Harness activation |
| Read/continue fixture | Model/effort retained, tools visible including extensions, stored reasoning/tool records parse, queue ownership and results retain identifiers; no duplicate terminal/projection entries |
| Runtime actions | Deterministic tool cancellation/timeout, UI-prompt stale-watchdog suspension with absolute deadline intact, managed compaction/recovery, branch/session affinity and MCP lifecycle cleanup |
| UI checks | Explicit disposable URL/flag; Classic and Visual load; prompts, cancellation, reconnect, settings/provider catalogue; no local-production browser target |
| Capture candidate state | Export synthetic session/store observations and exact expected diffs; preserve baseline checkpoint |
| Rollback start | Stop target only, select baseline artifact and restore the immutable test checkpoint if downgrade compatibility is not established |
| Rollback verification | Health and artifact identity; baseline fixture hashes/counts restored; session/queue/use provenance intact; no leaked process groups or duplicate externally visible effects |

Do not silently open a candidate-written store in the old runtime if backward compatibility has not been proved. A rollback plan must specify whether it reuses candidate state or restores the baseline checkpoint; these are different claims.

## Required receipt

- Approval reference and disposable target identity.
- Baseline/candidate artifact hashes, source revisions and resolved family versions.
- Commands and exit codes for stop/start/health and tests; no raw credentials.
- Before/after/rollback fixture counts and hashes, including exact session/queue IDs.
- Process ownership/cleanup and denied live-provider evidence.
- Passed/failed/skipped scenarios, with browser execution distinct from source/unit evidence.
- Final target state and owner hand-back.

The [executed receipt](earendil-0851-canary-result.md) records the passing bounded checks, baseline abort-endpoint defect and unrun coverage. It closes the missing upgrade/rollback execution evidence; acceptance of remaining platform/lint/full-suite limits and final merge/deployment are separate decisions.
