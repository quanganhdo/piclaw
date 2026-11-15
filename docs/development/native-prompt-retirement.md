# Core prompt-owner retirement

The Core legacy `runAgentPrompt` loop is deleted. Native SDK tasks/submissions and host accepted-source/terminal records own supported execution. No new prompt loop, compatibility executor or private SDK compaction adapter replaces it.

## Supported caller decisions

| Caller | Execution owner |
|---|---|
| Web input | Accepted native dispatch, same-identity pending observation and native settlement. |
| Dream | Private admitted native invocation, original model/deadline/FD lease and owned cleanup. |
| Add-on operations | Persisted operation/input epoch, current grant/quota/budget fences and private native settlement. |
| Scheduled agent/Dream work | Admitted S07 occurrence, exact lease/source identity and native dispatch. Host shell/internal maintenance remain separate. |
| Non-web AI polling | Explicitly unsupported without host input admission; native polling refuses before queue/cursor/runner side effects. |

`AgentPool.runAgent` and `RunAgentOptions` are deleted. Dream/add-on operations require their native dispatchers; missing native support cannot choose a direct runner. Scheduled AI work requires an admitted S07 occurrence and private native dispatch. It never saves/restores a public SDK branch or changes the public chat model. The now-unused throwing history-restore API is also deleted.

Non-web polling has no accepted-source port. Its executable worker, queue admission, command deduplication and cursor advancement are deleted in every profile. The remaining poller reads pending input and reports the admission requirement without consuming it. Bootstrap/coordinator polling dependencies contain no pool, queue or worker callback. Host shell tasks and deterministic internal maintenance remain separate; direct AI/Dream execution without an occurrence cannot borrow those paths.

## Deleted owner and exclusive helpers

Deleted the old orchestrator, retry/recovery phase, attempt budget/context/finalisation controllers, turn coordinator, protected handoff, tool-ceiling/model-stream interception, leaked-tool-subset memory, tool-state transition logger, blank-turn heuristic, model timing collector and recovery-decision types/logic. The turn coordinator is absent from both native and compatibility composition; no throwing tracker object remains.

Native construction no longer raises shared provider retry settings to a legacy minimum. Native request retry policy remains explicitly bounded by its own model bridge. Removed legacy recovery counters instead of reporting synthetic native zeroes.

The retired run-summary log producer and its process-global age-pruning timer are also deleted. Historical log files are preserved. Native structured logging, request accounting and telemetry are independent and remain in use.

## Retained boundaries and remaining work

Root SDK definitions/resource loading, native model/auth/catalog, MCP transports and permission/effect/budget services remain real host dependencies. Explicit resident legacy capture/import readers remain available; they do not execute prompts. Metadata-only branch registration remains owner-fenced and independent of a prompt lifecycle.

The legacy manual-control dispatcher, session/model/queue handlers, direct slash-prompt executor, compact-then-retry helper, compaction timeout/single-flight owner, JSONL rotation and session-idle waiter are deleted. Missing native control authority cannot hydrate a legacy runtime. `AgentPool` dispatches slash commands only through its admitted host command port; the runtime facade has no slash executor. Model activation after login requires the native authentication context and returns the canonical `model_label`.

Two file-history primitives remain for proven consumers: `session-file-persistence.ts` atomically persists an explicit legacy SDK history, and `branch-seeding.ts` retains effective-context replay for historical deferred seeds. They perform no compaction model request, archive rotation, prompt retry or native admission. Their relocated lines receive no deletion credit. The native bootstrap's timeout formatter is local to its only production caller. Historical side-prompt/provider-boundary fixtures keep their private reference helpers outside production; these moved lines are charged separately against net reduction.

Native root SDK definitions/resources, smart summary preparation, provider quota/model catalogue formatting and credential ownership remain. Native manual compaction/reset, model/thinking/auth controls and read-only history still use captured native ports, with SDK maintenance, owner/lifetime guards and accounting unchanged. The two legacy session-idle-wait environment knobs are removed from runtime configuration documentation and marked removed in the support catalogue. Stored configuration/history is untouched.

The final exclusive policy/configuration surface is retired: Core automatic recovery/loop guard and stale preflight domains, JSONL rotation storage settings, and obsolete scoped/foreground/idle trigger controls have no runtime reader, writer or UI. `recovery-policy.ts`, unused retry-settings type, protected-handoff producers and continuation-prompt selector are deleted. Historical control-intent decoders, typed reason/presentation readers and stored records remain.

Declared retired keys in active domains are finite read-only historical metadata: resolution ignores them, writes preserve them, new patches reject them, and all unrelated unknown keys still fail. General-setting saves containing retired fields reject before identity or other setters. Both Sessions panes retain the independent tool budget/isolation controls and no longer post obsolete knobs. Native auto-compaction remains SDK-owned on the Compaction pane.

Shared Root SDK smart-summary/model/probe/watchdog/context-budget helpers retain proven resource/API consumers and their own settings, including provider-native summary backoff. They do not own a native prompt/retry/rotation lifecycle, and unsupported native compaction settings remain rejected. Removing them solely by filename would break retained utilities. Historical configuration/JSONL/logs/receipts are preserved, not reinterpreted or cleaned up.

#1672 construction/lifetime acceptance is complete. #1673 acceptance spans the merged caller, prompt/manual owner, web/queue and final configuration retirement; no second executor or fallback remains.

[Native host composition](native-host-composition.md) requires native lookup or an explicit historical `legacyCapture: true` selection. Native tool/binder/session lifecycle placeholders, warmup entry points and idle GC timer are deleted; unsupported native MCP live Apply cannot borrow an empty legacy shutdown certificate. The independent real native MCP/resource owner and explicit resident capture path remain separately qualified. #1672 acceptance requires merged construction/lifetime evidence. #1691/#1692 own physical legacy execution-field and UI projection retirement; no historical marker, payload, receipt or database is removed by this code deletion. No dependency upgrade, deployment, restart or live storage/configuration operation is included.

## Evidence

- `retired-prompt-owner.test.ts`: all-profile direct-runner API absence, unchanged factory/accounting state, sixteen module absences, unchanged shared retry settings and absence of obsolete recovery instrumentation.
- `runner-caller-retirement.test.ts`: no public runner/options/fallback call sites; missing native add-on authority cannot choose a stale runner property. Real native caller scenarios qualify grants, quotas, lease revocation, Dream model/tool/FD lifetime, scheduled accounting and pending non-web input preservation.
- `manual-control-retirement.test.ts`: retired module/API absence and missing native control authority refusing old runtime factories, mutation and compaction.
- `retired-execution-policy.test.ts`: no obsolete settings or policy module, stale whole-save refusal, inert stored history preservation, strict unknown-key/patch rejection and no schema-retirement overlap. The shipped Classic/Visual browser matrix covers active controls/save/error/remount, absent retired fields and responsive authentication continuity.
- Fresh native import/composition fences require no legacy construction and no turn-coordinator port; they also forbid the retired manual control, slash, retry and rotation modules.
- `compact.test.ts`, `idle-model.test.ts`, `db-tree.test.ts` and `single-database.test.ts` qualify actual native compaction/reset, model fit, scoped pending work, imported history, same-task checkpoint adoption and reopen.
- Native handler/auth/alias/fuzz tests preserve current catalogue, private credentials and one-time model activation. Retired SDK-session mutation/eviction fixtures do not certify native controls.
- Actual native Dream/add-on/SDK quota/budget/cancellation/compaction and web ACK/reopen cases remain the execution acceptance tests; retired legacy mocks do not certify them.
- Retained metadata/SSH/eviction compatibility fixtures hydrate through their actual introspection API, without using a fake prompt to warm a pool.

Handwritten backend LOC and removed ownership/composition layers are measured separately from tests/docs; file relocation and fixture deletion receive no backend reduction credit.
