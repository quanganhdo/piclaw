# piclaw-test upgrade and rollback receipt

**The bounded upgrade/rollback checks passed except for the reproduced baseline defect [#1334](https://github.com/rcarmo/piclaw/issues/1334).** The exact baseline checkpoint was restored before rollback startup; subsequent startup consumed its queued item. Browser Stop through `/agent/default/message` control handling passed; `POST /agent/runs/abort` failed on both versions. This is targeted canary evidence, not a full browser/integration suite or permission to merge/deploy.

## Authority and target

Rui approved “Yes. Use piclaw-test” at 2026-09-17 06:58:17 UTC after the request to accept public SessionRepo coverage and authorise a disposable installation/restart/upgrade/rollback. Public Memory/JSONL SessionRepo coverage is accepted for PR B; raw Storage remains an upstream limitation, not a requirement to use private access. No merge, production deployment, paid-provider call or Harness activation was authorised.

Live identity differed from old test notes: VM **900 / piclaw-test** was stopped on **radxax4**, with address **192.168.1.236** after boot. The guest runs Debian/systemd, microVM Linux 6.12.22 x86_64. It had no logged-in users or active test run. The original Piclaw and OpenCode proxy services were stopped before launching the isolated canary.

A disk/config snapshot, `pre-ear0851-20260917`, was created while the VM was stopped. The NIC configuration was set to `link_down=1` before boot, but later hotplug returned a microVM device-name mismatch; link-down enforcement during boot was not independently verified. Guest-agent service containment and the per-user canary egress firewall were verified separately. SSH used a host key read through the verified guest agent and strict host-key checking. The temporary canary user/profile/service were independent of the guest's original application state and Smith's state.

## Artifact identities

| Artifact | Source | Earendil | SHA-256 |
|---|---|---|---|
| Exact baseline | `ad922bdaac40b3a5119aa3017a10ee63897e318b` | 0.84.4 | `ff05d8b62c9b21816ed45268b6c13727fde15591dfb2aa1586924ec2d697d06b` |
| Candidate | `da9098fcff7f7af0e0647c8c61a1bc9895bf85c8` | 0.85.1 | `f7e86fa8d4b41e7fe04afbe3b0b593c0929ff3e7c303d2d1a1499938bc898cb8` |

Both are Piclaw 3.1.2 Linux portable artifacts with bundled Bun 1.4.1. Later draft changes through `4b9cd52fe` affected inactive compatibility evidence, tests and documentation only; the execution code and dependency pins match the candidate artifact. The artifact hashes were checked on the guest.

## Isolation

The test used `/opt/earendil-canary-20260917` and a dedicated `earcanary` user (UID 996), separate `.piclaw` store, session directory and agent profile. The only configured/authenticated model was `canary/canary-model`, an HTTP fixture on `127.0.0.1:18444` returning deterministic chat completions, tool calls and usage. The profile used synthetic auth and no copied production credentials.

A guest nftables rule allowed loopback and established replies for that UID, then dropped other outbound packets. An outbound-denial control timed out and incremented the counter by one packet; the captured final rule counter remained at one. The original outward-facing proxy stayed stopped. Ordinary network access used to transfer artifacts and install the guest firewall tool occurred outside the test-service UID and was undone by snapshot restoration.

No production AgentHarness or pi-server activation occurred. Runtime services used the existing coding-agent loop. Existing local MCP integration tests remain separate from this guest run: no external MCP server was configured here.

## Executed observations

| Check | Result |
|---|---|
| Baseline start | 0.84.4 artifact, isolated service active, health HTTP 200 |
| Baseline synthetic messages/tool | Extension explicitly loaded in test profile; dynamic `activate_tools` then `canary_echo` succeeded |
| Baseline checkpoint | Nine web messages, six usage rows, one queued follow-up; session JSONL SHA-256 `2346171bb83cf7368fee0a43d910b3a2fa9165efd86c097e2ee34102c649bca6` |
| Controlled stop | Queue persisted; session hash unchanged; no uncontrolled provider access |
| Candidate startup | Exact pre-start state equals baseline checkpoint; interrupted baseline turn received its separate recovery outcome; queued follow-up materialised and completed once |
| Persisted state | Baseline message/usage rows and tool-result IDs retained; same session filename/ID, model and `high` effort; cacheReadReported true / cacheWriteReported false remained recorded |
| Candidate tools | Extension activation/echo round trip succeeded; shell timeout returned the expected one-second timeout |
| Browser Stop | Real Classic button submitted `/abort` via message control, killed one tracked tool process and returned to idle |
| Managed compaction | Properly structured synthetic summary passed Selective/Single Pass validation, attached a report and appended a compaction entry |
| Browser smoke | Baseline Classic, candidate Classic, candidate Visual and rollback Classic all loaded persisted timeline and General Settings, HTTP 200, no page errors |
| Exact rollback before startup | Whole runtime/dependency set restored to 0.84.4 and immutable baseline checkpoint restored; all captured state fields match after excluding only the receipt's phase label |
| Rollback startup | Restored queue completed once; model/high effort/session/tool identities retained; health and Classic UI passed |
| Final cleanup | Canary and fixture services stopped; no tested sleep process remained; original guest snapshot rollback completed with Proxmox exitstatus OK; VM is stopped with original network configuration |

The queued item executed once per restored phase: once on candidate startup and once again after restoring the baseline checkpoint. This is not an exactly-once claim across the whole experiment.

Rollback restored the baseline checkpoint. It **does not prove** the old runtime can safely consume arbitrary candidate-written state. Candidate-state receipts were captured before restoration; no production schema migration or session rewrite was attempted.

## Failure dispositions

- `/agent/runs/abort` returned HTTP 200 / outer `status: ok` with nested `Unknown command: /abort`, leaving the tool active. It reproduced on 0.84.4 and 0.85.1, and its handler source is unchanged between the two. It routes through `applySlashCommand`; the successful UI/message path routes through `applyControlCommand`. Issue #1334 tracks the baseline defect; no unrelated fix was bundled into PR B.
- The initial fixture extension was not exposed through workspace discovery alone. Explicitly listing it in the isolated agent profile enabled the intended extension-activation check on the baseline before checkpointing.
- The first compaction request correctly returned “session too small”; backoff survived restart. Subsequent attempts rejected short/malformed fixture summaries without changing the JSONL. After using the correct reset payload and a schema-valid synthetic summary, compaction succeeded. Those attempts are retained as test-setup/validation evidence, not relabelled as successful compactions.
- The first Visual check read Settings before its asynchronous content had resolved; waiting for General content produced the passing smoke receipt. An abort-test poll initially read the wrong status field; the corrected browser test passed.

## Coverage limits and next decision

No full E2E suite, live provider, external MCP-server startup, explicit UI-prompt watchdog-versus-absolute-timeout scenario, or branch/model-switch sequence was executed on this guest. Existing local tests for those contracts remain separately labelled. Non-Linux execution and broader HC completion are unchanged follow-ups. Raw Storage constructors/testing fixtures remain unavailable through supported exports; the accepted B boundary is public SessionRepo.

The [machine-readable receipt](earendil-0851-canary-result.json) and external evidence archive retain state snapshots, command responses, fixture request logs, browser receipts/screenshots and verification commands. No claim of whole-product readiness follows from these targeted checks. Final merge/deployment and remaining baseline lint/platform dispositions still require Rui's decision.
