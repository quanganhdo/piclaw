# Original #1323 scenario audit

Baseline: core `f1a9d979d4ad5bb9c740b1ddf69f8c6c4ff245b4`; original specification
`9607cc4911f3a2a96566af2ddf127f5fabbfe16e`. Classic is authoritative on doubt.
Original scenarios 001–028 refer to `../../classic/canonical/canonical-ux.feature`. Follow-up #1324 restores 029 to its desired SVG-image scope in `../../shared/svg-images.feature`; see the dated evidence below.
`corrected` means source reconciled, not browser-executed or independently approved.
Paths beginning `runtime/` are relative to the Piclaw repository root.

## Scenario matrix

| ID | Original scenario | Disposition and correction | Implementation evidence | Existing executable evidence to inspect/run |
|---|---|---|---|---|
| ux-original-001 | Open and dismiss the workspace menu | corrected: do not promise unimplemented focus-return/one-open guarantees | `runtime/web/src/components/timeline-menu.ts` / menu open and outside/Escape effects | `runtime/test/web/timeline-menu-dropdown.test.ts` |
| ux-original-002 | Show and hide the native workspace | corrected: scope Classic, preserve non-submission; remove universal backdrop guarantee | `runtime/web/src/components/timeline-menu.ts`; `runtime/web/src/ui/app-pane-state.ts` | `runtime/test/web/workspace-visibility.test.ts` |
| ux-original-003 | Type on the idle timeline to open Quick actions | corrected: Agents label, effect-time focus rather than before-paint; no exactly-once claim | `runtime/web/src/components/timeline-quick-actions.ts` / `isTimelineTypeaheadEvent`, `runItem`; `runtime/web/src/ui/timeline-quick-actions.ts` | `runtime/test/web/timeline-quick-actions.test.ts` / builds configured groups and best match; `popup-typeahead.test.ts` |
| ux-original-004 | Do not steal typing from an interactive surface | corrected: targets follow actual exclusion selector; no universal native input guarantee | `runtime/web/src/components/timeline-quick-actions.ts` / `isEditableTarget`, `isInteractiveTarget`, `isInsideExcludedTypeaheadRegion` | `runtime/test/web/timeline-quick-actions.test.ts` / keyboard shortcut precedence |
| ux-original-005 | Ignore consumed, modified and composing keys | corrected: valid Gherkin and actual event exclusion conditions | `runtime/web/src/components/timeline-quick-actions.ts` / `isTimelineTypeaheadEvent` | `runtime/test/web/timeline-quick-actions.test.ts` |
| ux-original-006 | Dismiss Quick actions without side effects | corrected: Escape/outside implemented; no separate close control or trigger-focus guarantee | `runtime/web/src/components/timeline-quick-actions.ts` / keydown and pointerdown effects | Direct browser focus-return assertion not located |
| ux-original-007 | Activate only current supported Quick actions | corrected: remove stale-activation/error-retains-open promises; command prefill replaces text | `runtime/web/src/components/timeline-quick-actions.ts` / `runItem`; `runtime/web/src/components/compose-box.ts` / prefill effect | `runtime/test/web/compose-box.test.ts` / compose prefill applies new non-search tokens once |
| ux-original-008 | Discover loaded skills through canonical slash commands | corrected: discovery and insertion only, no unsupported expansion/stale-execution guarantee | `runtime/src/channels/web/agent/agent-commands.ts` / skill catalogue; Quick Actions `runItem` | `runtime/test/web/timeline-quick-actions.test.ts`; backend command tests |
| ux-original-009 | Open Plan and edit the loaded revision | corrected: optional add-on, timestamps/request guards, no revision API | External `plan-sidebar/web/index.ts` / `savePlan`, `canApplyPlanResponse` | External add-on `index.test.ts`; no core browser execution claimed |
| ux-original-010 | Preserve a dirty Plan across a remote update | corrected: automatic refresh preserves dirty text; explicit Refresh calls `loadPlan()` without a discard confirmation | External `plan-sidebar/web/index.ts` / `handleRemotePlanUpdate`, `loadPlan`, refresh click binding | External add-on request-state tests; browser confirmation absent |
| ux-original-011 | Submit Plan to the captured session | corrected: saves first, rejects empty/changed-chat result; calls message endpoint with `mode: auto` | External `plan-sidebar/web/index.ts` / `submitToModel`, `savePlan` | External add-on tests; no numeric revision asserted |
| ux-original-012 | Expose canonical Plan Markdown and the native Plan tool to the model | corrected: add-on/activation prerequisite, checklist-derived progress, no universal catalogue presence | External `plan-sidebar/web/index.ts` / `parseChecklist`, `buildPlanDecorationsExtension`; `plan-sidebar/index.ts` | External add-on tests; core tool activation remains independent |
| ux-original-013 | Open, search and dismiss the session picker | corrected: mount-time focus, actual grouping; no first-visible-paint promise | `runtime/web/src/components/compose-box.ts` / popup keyboard/focus effects; `runtime/web/src/ui/compose-session-switcher.ts` | `runtime/test/web/compose-session-switcher.test.ts`; `session-picker-alignment.playwright.optional.test.ts` |
| ux-original-014 | Select one coherent session view | corrected: selection/refresh guards without an atomic all-surfaces snapshot claim | `runtime/web/src/ui/app-chat-pane-state.ts`; `runtime/web/src/ui/app-refresh-coordination.ts` | `runtime/test/web/app-chat-pane-state.test.ts`; `app-refresh-coordination.test.ts` |
| ux-original-015 | Expose only supported session mutations | corrected: callback/entry-dependent controls; no blanket popup delete/child-creation promise | `runtime/web/src/ui/compose-session-switcher.ts`; `runtime/web/src/components/compose-box.ts` | `runtime/test/web/compose-session-switcher.test.ts`; `branch-lifecycle.test.ts` |
| ux-original-016 | Queue two follow-ups exactly once | corrected: accepted queue entries and reconciliation; remove unsupported exactly-once storage claims | `runtime/web/src/components/compose-box.ts` / submit path; `runtime/web/src/ui/app-followup-queue.ts` | `runtime/test/web/app-followup-queue.test.ts`; `queue-state.test.ts` |
| ux-original-017 | Return a queued item to the latest editor draft | corrected: replaces draft/references, clears media, then schedules removal; no persistent recovery merge | `runtime/web/src/components/compose-box.ts` / `returnQueuedFollowupToEditor` | `runtime/test/web/compose-box.test.ts` / queued draft reconstruction and return action |
| ux-original-018 | Reorder and remove by durable identity | corrected: reorder uses indices; remove optimistically hides then reconciles on error | `runtime/web/src/ui/app-followup-actions-orchestration.ts` / `handleMoveQueuedFollowup`; `runtime/web/src/ui/app-floating-widget-followup.ts` / remove action | `runtime/test/web/app-followup-actions-orchestration.test.ts`; `app-floating-widget-followup.test.ts` |
| ux-original-019 | Steer only a matching active run | corrected: idle Steer not disabled by this client; backend may send after stream ends | `runtime/web/src/components/compose-box.ts` / `handleInjectQueuedFollowup`; `runtime/web/src/ui/app-floating-widget-followup.ts` / inject action | `runtime/test/web/app-floating-widget-followup.test.ts`; original safety-deviation was aspirational |
| ux-original-020 | Search and select a model authoritatively | corrected: actual selection request and accepted response; no unconditional persistence/context guarantee | `runtime/web/src/components/model-picker.ts` / `select`; `runtime/web/src/ui/app-model-state.ts` | `runtime/test/web/app-model-state.test.ts`; `model-picker-components.test.ts` |
| ux-original-021 | Find and activate picker entries without changing unsupported state | corrected: picker-specific search, model Home/End modifier guard; no capability metadata promise for sessions | `runtime/web/src/components/model-picker.ts` / keyboard handler; `runtime/web/src/components/compose-box.ts` / popup navigation | `runtime/test/web/popup-typeahead.test.ts`; `compose-session-switcher.test.ts` |
| ux-original-022 | Reject stale or unsupported model state | narrowed: source-reported capabilities/context and stale-chat guard | `runtime/web/src/ui/app-model-state.ts`; `runtime/web/src/ui/model-catalogue.ts` | `runtime/test/web/app-model-state.test.ts`; `model-catalogue.test.ts` |
| ux-original-023 | Cancel the captured active turn across reconnect | corrected: reconnect refresh and selected-chat cancellation; no universal persisted ownership reconstruction | `runtime/web/src/ui/app-connection-lifecycle.ts`; `runtime/web/src/components/compose-box.ts` / stop control; `runtime/web/src/ui/app-agent-turn-events.ts` | `runtime/test/web/app-connection-lifecycle.test.ts`; `app-agent-turn-events.test.ts` |
| ux-original-024 | Copy and delete timeline messages through native actions | corrected: actual source Markdown/code and cascade confirmation; no all-controls glyph announcement guarantee | `runtime/web/src/components/post.ts`; `runtime/web/src/ui/app-timeline-actions.ts` | `runtime/test/web/post-copy-markdown.test.ts`; existing deletion features/steps |
| ux-original-025 | Let the model identify bounded ranges of persisted messages | corrected: explicit scope/all-chat supported in single-user, owner restrictions in family; remove model prompt-injection guarantee | `runtime/src/extensions/messages-crud.ts` / `executeGet`, window filters, `runMessagesTool` | Message tool tests under `runtime/test/extensions`; exact ID ordering still needs independent review |
| ux-original-026 | Retry attachment delivery without duplication | corrected: separate upload success/error from send; no cancellation/retry dedupe guarantee | `runtime/web/src/components/compose-box.ts` / upload batch and submit; `runtime/web/src/ui/upload-transfers.ts` / `uploadFileBatch` | `runtime/test/web/post-attachments.test.ts`; compose upload tests; retry guarantees not located |
| ux-original-027 | Present tool execution lifecycle in the native tool pane | narrowed: Classic status/timing/identity; full reload reconstruction, disclosure/focus and reduced-motion guarantees not established | `runtime/web/src/components/status.ts` / elapsed effects; `runtime/web/src/ui/status-duration.ts`; turn-event routing | `runtime/test/web/status-duration.test.ts`; `status-render.test.ts`; `app-agent-turn-events.test.ts` |
| ux-original-028 | Copy and read assistant content truthfully | corrected: supported browser/post prerequisite; speech ownership and stale callbacks | `runtime/web/src/components/post-speech.ts`; `runtime/web/src/components/post.ts` | `runtime/test/web/post-speech.test.ts`; `post-copy-markdown.test.ts` |

## External Plan evidence

Plan behavior was inspected in `/workspace/piclaw-addons/addons/plan-sidebar` at
add-ons repository revision `6374ed3c85627c590794e44828d13b08587ba46b`, package
`@rcarmo/piclaw-addon-plan-sidebar` version `0.1.25`. It is not part of the Piclaw
core PR baseline. Scenarios 009–012 are conditional on this add-on and require a
separate add-on revision check before being used as a port acceptance contract.
No secret or live configuration values were needed for this audit.

## Follow-up contribution

| ID | Scope | Source | Disposition |
|---|---|---|---|
| ux-original-029 | Upstream SVG-image request in 3f8ee0d2f; desired acceptance restored by #1324 | `runtime/web/src/markdown.ts` — renderMarkdown, highlightCodeToHtml pipeline; `runtime/web/src/components/post.ts` — enhanceCodeBlocks | At 70d33bc93 fences remain source: no SVG-fence conversion or bounded fallback policy exists. This is dated implementation-gap evidence, not a ban. The same identity is now [implemented shared acceptance](../../shared/svg-images.feature); #1325 and [SVG evidence](svg-images.md) record the follow-up. |

The PR head advanced to `3f8ee0d2f9eddab3828f9a5d4f626716469636d8` during the audit. Its feature contribution and upstream test edit were adopted by fast-forward before audit changes. The audit changes no executable test.

## Review and remaining validation gaps

- [x] Bounded independent source review of 001–029 completed; see [review dispositions](review.md).
- [x] Record source-confirmed Visual boundaries in [skin differences](differences.md); no full parity claim.
- [ ] Bind or map exact executable assertions for every clause rather than only each flow.
- [x] Rechecked external Plan revision: still `6374ed3c85627c590794e44828d13b08587ba46b`.
- [x] Ran the untouched updated-head SHA-pinned test: 0 pass / 1 fail; see [validation](validation.md).

The original normative idle-Steer safety proposal is retained here as history:
it wanted idle/unknown Steer disabled and exactly-once targeting. Classic currently
uses a backend-authoritative action which can send immediately when the stream
has ended. The corrected feature records that behavior; no code fix is authorised.
