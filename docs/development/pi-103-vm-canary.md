# Pi 1.0.3 synthetic VM canary

The corrected package passed a 30-minute synthetic Classic service window on VM900, with 59 ordered prompt/reply cycles, one terminal reply per cycle and unchanged process identity. Both UI skins, cancellation/reconnect, synthetic runtime MCP and scheduler/family probes passed their bounded checks. The canary services are stopped and their writes quarantined without replay. The [receipt](receipts/pi-103-vm-canary.json) contains hashes, approval references and limits.

## Artifact and approvals

| Item | Identity |
| --- | --- |
| Corrected source | `34e4bda1a6c35aebd22b9dd2a127854b2438d9cc` |
| Source tree | `66192a17691b6ddd36f47d4db175360b8187f43f` |
| Private-write fix | [PR1563](https://github.com/rcarmo/piclaw/pull/1563), merge `16b020da0575d080b0d006460ca313130fb8c2c5` |
| Package SHA-256 | `023d2541265cafa259bebe91ed41afbc3660816a7b98f5de0b719197a3516ddc` |
| Runtime | Bun 1.4.2, Pi 1.0.3, retained MCP adapter |
| Target | VM900 `piclaw-test`, node `radxax4`, Debian 13 / systemd |

Rui approved the synthetic 30-minute VM scope in message62730, then authorised clearing old VM workloads, replacing the VM's Bun and directly retrying the corrected package in message62759. These decisions did not approve Smith restart, real accounts, provider expenditure, Memento traffic or production Delegate. OS, SSH, guest-agent access and message databases were preserved.

The first packed artifact lacks a lockfile. Its dependency install resolved the declared dependencies and supplied no frozen-closure evidence. The corrected package used the qualified `bun.lock` as an explicit overlay with `--frozen-lockfile --ignore-scripts`. Its lock hash is `5bf82bf6f35ed1bd7cc49bc5f521c7e39a22004b0b2570e774ea2cbf5628ee49`. The package's 785 runtime/extension/manifest files matched the source commit and the deployed files byte-for-byte. This scope does not cover every byte of every transitive package.

## Continuous Classic window

- Start: `2026-10-05T17:13:30.017Z`; finish: `2026-10-05T17:43:30.036Z`.
- Duration: 1,800,019 ms; 59 synthetic prompt/reply cycles.
- Same service PID throughout, with no duplicate or missing plain-turn reply and exactly one terminal per cycle.
- Both configuration files remained mode 0600 through observed startup, restart and final checks. The final database integrity check passed.
- No application external-denial marker was found in the five canary units' journals. Backend services used loopback-only systemd network policy and an application guard. This is not an OS-wide packet audit or proof of raw provider/authentication settlement.

The watchdog recorded 32 samples from 17:28:27 to 17:43:58. It covered the latter part of the window only. Startup/restart and final checks supplement those periodic observations; no continuous private-mode measurement is asserted for the unobserved first half.

| Observed metric | Median | Range |
| --- | --- | --- |
| Prompt-cycle time | 766.1 ms | 761.9–863.5 ms |
| Timeline read | 2.6 ms | 1.8–75.2 ms |
| Process RSS | 182,272 KiB | 174,036–186,668 KiB |

Prompt-cycle time includes reply polling and the unrelated read; it is not isolated admission acknowledgement latency. RSS and CPU observations are process-wide and coarse. The window establishes no leak-absence, cross-platform or general tail-latency guarantee.

## Separate functional checks

- Classic and Visual browser checks correlate the POST admission row with its own terminal reply, require the reply and Settings to be visible, and assert zero page errors and rejected outside-origin attempts. The browser ran on Smith through a VM-only SSH tunnel.
- A delayed deterministic response was cancelled through the actual HTTP control path, with an exact `user_command` / `agent_control.abort` marker and one terminal reply. An expected intermediate fragment is allowed. SSE disconnect/reconnect passed.
- The running Classic service executed one synthetic once-task with one successful run log, consumed source and terminal operation. A separate packaged-runtime fixture exercised real AgentPool/SDK leaf restoration and recurrence.
- Separate synthetic family-router fixtures admitted 16 prompts and four replays, checked owner/CSRF/conflicting-payload denial, and tested a 500 ms external writer. Release returned 201 with 17 rows; login revocation returned 403 with 16 rows and no revoked admission. These fixtures use direct account provisioning and wake/delivery sinks.
- The actual runtime MCP proxy called the synthetic loopback tool and persisted `Synthetic MCP runtime OK`; the synthetic server observed exactly one call. This supplies no live Memento, server-account or complete MCP parity acceptance.

Visual restarted during MCP harness qualification and has no separate continuous 30-minute soak claim. Test-provider tool discovery was corrected to replay public transcript system-message tool declarations; the loopback server was corrected to create independent sessions. Failed harness attempts remain retained.

## Failure, correction and stop

The original package `8fc25726a816e3d4673cd66f41dc993dc86fd83b9714d2aae7e8ff73ca9ffde2` stopped after 21 cycles, about ten minutes. Its ordinary JSON writer replaced private mode 0600 with mode 0644 while persisting a widget setting; the strict MCP reader then denied restart/session construction. That run failed and is excluded from the successful window.

PR1563 fixes the shared writer with exclusive mode-0600 temporary-file creation while retaining atomic rename and the strict reader. Two new regressions failed before the change. The corrected source passes 6,533 tests / eight existing skips / zero failures / 42,756 assertions, plus 25 feature and nine web tests. Postmerge checks pass 25 tests / 195 assertions. Exact hosted run37346512175 succeeded. Prior review timeouts and failed test-harness attempts provide no approval or success.

Five canary units were stopped. Both fresh profiles were moved to private quarantine and 48,755 candidate files were hash-verified after the move. All 65 original database/sidecar hashes match their pre-cleanup manifest. Candidate writes were not replayed. The approved VM Bun replacement remains; Smith's service and unrelated working-tree edit are unchanged.

## Open acceptance

Production Delegate still lacks public raw auth/provider settlement and account-generation authority contracts. Required immutable core/add-on/policy/credential/owner/orphan qualification and live account/server criteria remain open. Protected Azure credential migration, production deployment/restart and token-aware rollback require separate approval. The canary also retained a workspace goal add-on `typebox` resolution warning; this slice does not fix or qualify that packaging behaviour.
