# Native web execution

Web turns execute through `dispatchAcceptedInput` and its same-identity pending observer. `processChat` no longer calls `AgentPool.runAgent` or constructs a legacy preflight, streaming or finalisation runtime. A missing dispatcher or accepted source fails explicitly; it cannot enter another prompt lifecycle.

## Cursor and queue handoff

The cursor selects persisted input. It grants no execution authority. Selection reads pending messages and their thread lineage; historical failed-run markers cannot consume or skip accepted native work. Existing marker rows remain unchanged until the separate owned schema retirement.

Accepted dispatch advances the cursor only after confirmed settlement. Pending or failed observation keeps the cursor unchanged and retains the same message/row identity for the next wake. Display and resume failures cannot revoke a committed settlement. Native settlement wakes the lane; deferred materialisation uses its existing targeted queue key. Deferred controls and queue payload/provenance remain supported.

SDK tasks/submissions and host accepted-source/terminal records own execution and publication. Historical `agent_timing`/outcome blocks remain readable by the UI; deleting their legacy producer does not delete or reinterpret stored posts. Native SSE publication continues through the existing native event/turn-view adapters. No frontend interaction change is introduced.

## Root metadata and routing ownership

Creating a root chat is host metadata registration. The live native owner allocates its SDK context later through input-source preparation. Native root registration requires the existing routing owner, checks it inside the same immediate SQL transaction and skips legacy session warmup. Missing, revoked or closed ownership rejects creation; a failed branch insert rolls back chat metadata too.

Native forks, address changes and destructive purges retain their immutable-routing refusal. A pool with no native routing profile still refuses native root creation. No default conversation or legacy factory is selected as a fallback.

## Removed code and retained work

Removed:

- The legacy runner, protected continuation, draft-fallback and turn-finalisation branch in the web handler.
- `process-chat-preflight-runtime.ts`, `process-chat-streaming-runtime.ts` and `process-chat-finalization-runtime.ts` and their exclusive fixtures.
- The policy-free `processChat` → `processAuthorisedChat` forwarding step and legacy failed-marker selection.

Slash recognition now uses the existing command parser directly. The explicitly retained legacy slash executor re-exports recognition for its current callers; native web parsing does not import that executor merely to recognise a command.

Legacy restart draft/interruption publication, failed-cursor retry/skip controls and their forwarding APIs are removed. Startup retains native restart handoffs and a read-only pending-message/queue scan; repeated wakes use one stable queue key, including attachment-only deferred input. Neither model changes nor login/card continuation actions rewind a cursor or consume historical failed markers. Live draft buffers remain transient; older stored draft payloads stay opaque and are not published as new assistant history.

Status reads and `/agent/runs` do not derive activity from preflight/inflight markers. Historical response keys remain empty for compatibility. Stale-clear changes only terminal display state and rejects active native work; abort still uses the fenced native control. Native terminal settlement no longer clears legacy markers. The session-control tool no longer advertises `retry_failed`/`skip_failed`; old direct requests fail explicitly, while inspect/model/abort/wake/unblock remain supported.

A native fault fixture commits the answer/terminal ledger, rejects the polling cursor write, then closes/reopens the disposable store and repeats startup wakeups. The same source/submission/task identities, answer, historical markers and provider-call count survive; only the polling cursor advances after confirmed observation. This is deterministic fault/reopen evidence, not a live-service restart or unclean-process-kill claim.

#1673 owns final runner/compaction retirement. #1691 owns subsequent schema removals. [Native web UI observations](native-ui-projections.md) records #1692's projection retirement and residual historical JSON preservation. Source deletion does not authorise live data cleanup, migration, deployment or restart.

## Focused evidence

- `native-web-only.test.ts`: missing dispatcher cannot access a legacy runner or write markers; historical failed markers cannot skip accepted input; pending wakeups retain one identity.
- `native-web-recovery-retirement.test.ts`: startup/status/model/control paths cannot read or mutate legacy recovery authority; removed APIs are absent and draft buffers do not persist recovery payloads.
- Existing native factory case `native-web-cursor-ack`: committed terminal publication survives a failed cursor write and real store reopen with repeated discovery, no provider replay or duplicate answer.
- `web-channel-recovery-state.test.ts`: startup preserves historical drafts/markers byte-exact without manufacturing messages.
- `process-chat-native-dispatch-import-boundary.test.ts`: native settlement/pending/failure/status paths never load retired helpers or publish legacy run markers.
- `web-channel.test.ts`: surviving HTTP, cards, controls, queue and status contracts use explicit accepted-dispatch test ports; legacy runner calls are trapped in migrated execution cases.
- `application-web.test.ts`: real native pool/channel, lost wait acknowledgement and deferred uncertain compaction.
- Existing native factory routing/event cases: native source/queue policy, immutable identities, root registration and SSE publication.
- `native-routing-policy.test.ts`: missing/revoked/closed owner and failed registration preserve metadata; authorised root registration adds no SDK conversation.

Run only defining/directly affected files through the isolated priority launcher, with relevant runtime/private/qualification typechecks. Tests exclusive to the retired web lifecycle were removed; surviving wire/queue behavior retains coverage.
