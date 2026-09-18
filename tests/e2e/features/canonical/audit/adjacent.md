# Adjacent interaction evidence

Classic source review; independent bounded review completed for these files. No browser execution. Source paths below are supplemented by named symbols in feature headers and the exact scenario index. Source tests and runtime suites do not prove every browser clause.

| Feature | Source | Related existing tests |
|---|---|---|
| [classic/compose/compaction-model-switch.feature](../../classic/compose/compaction-model-switch.feature) | `runtime/web/src/components/compose-box.ts`; `runtime/web/src/components/model-picker.ts` | `runtime/test/web/compose-box.test.ts` |
| [classic/compose/compose-stability.feature](../../classic/compose/compose-stability.feature) | `runtime/web/src/components/compose-box.ts`; `runtime/web/src/ui/upload-transfers.ts` | `runtime/test/web/compose-box.test.ts` |
| [classic/compose/context-meter-tooltip.feature](../../classic/compose/context-meter-tooltip.feature) | `runtime/web/src/components/compose-box.ts` | `runtime/test/web/compose-box.test.ts` |
| [classic/compose/hamburger-layout-scale.feature](../../classic/compose/hamburger-layout-scale.feature) | `runtime/web/src/components/timeline-menu.ts`; `runtime/web/src/components/tab-strip.ts`; `runtime/extensions/viewers/editor/markdown/theme.ts` | `runtime/test/web/tab-strip.test.ts`; `runtime/test/web/theme.test.ts` |
| [classic/compose/instant-visibility.feature](../../classic/compose/instant-visibility.feature) | `runtime/web/src/components/compose-box.ts`; `runtime/web/src/ui/app-timeline-scroll-orchestration.ts` | `runtime/test/web/compose-box.test.ts` |
| [classic/compose/sse-reconnection.feature](../../classic/compose/sse-reconnection.feature) | `runtime/web/src/ui/app-connection-lifecycle.ts` | `runtime/test/web/app-connection-lifecycle.test.ts` |
| [classic/compose/thoughts-panel.feature](../../classic/compose/thoughts-panel.feature) | `runtime/web/src/components/status.ts` |  |
| [classic/mobile/pwa-manifest.feature](../../classic/mobile/pwa-manifest.feature) | `runtime/src/channels/web/manifest.ts`; `runtime/src/channels/web/http/dispatch-shell.ts` |  |
| [classic/mobile/swipe-independence.feature](../../classic/mobile/swipe-independence.feature) | `runtime/web/src/ui/chat-swipe-navigation.ts` | `runtime/test/web/chat-swipe-navigation.test.ts` |
| [classic/sessions/session-switching.feature](../../classic/sessions/session-switching.feature) | `runtime/web/src/ui/compose-session-switcher.ts`; `runtime/web/src/ui/app-chat-pane-state.ts`; `runtime/web/src/ui/app-refresh-coordination.ts` | `runtime/test/web/compose-session-switcher.test.ts`; `runtime/test/web/app-chat-pane-state.test.ts`; `runtime/test/web/app-refresh-coordination.test.ts` |

`ux-shell-009` adds the editor Markdown theme source omitted from the original header. PWA browser installation, native keyboard focus, media upload progress and gestures still need browser runs.

## Stable scenario cross-reference

IDs below refer to the source/correction tables above by feature and current title. Review state: source checked; bounded independent packet reviewed; browser not run. A related test path is not a per-clause execution claim.

| ID | Current scenario | Feature |
|---|---|---|
| ux-compaction-001 | Render compaction using supplied status state | [classic/compose/compaction-model-switch.feature](../../classic/compose/compaction-model-switch.feature#L6) |
| ux-compaction-002 | Reconcile compaction events with client status | [classic/compose/compaction-model-switch.feature](../../classic/compose/compaction-model-switch.feature#L13) |
| ux-compaction-003 | Request stop through the visible compaction control | [classic/compose/compaction-model-switch.feature](../../classic/compose/compaction-model-switch.feature#L21) |
| ux-compaction-004 | Use refreshed usage rather than assume compaction always shrinks context | [classic/compose/compaction-model-switch.feature](../../classic/compose/compaction-model-switch.feature#L28) |
| ux-compaction-005 | Display temporary compaction suppression | [classic/compose/compaction-model-switch.feature](../../classic/compose/compaction-model-switch.feature#L35) |
| ux-compaction-006 | Check model context compatibility before switching | [classic/compose/compaction-model-switch.feature](../../classic/compose/compaction-model-switch.feature#L42) |
| ux-compaction-007 | Refresh model information after an accepted switch | [classic/compose/compaction-model-switch.feature](../../classic/compose/compaction-model-switch.feature#L49) |
| ux-compaction-008 | Handle a model command using the configured provider catalogue | [classic/compose/compaction-model-switch.feature](../../classic/compose/compaction-model-switch.feature#L56) |
| ux-compose-001 | Clear captured content while allowing a new draft | [classic/compose/compose-stability.feature](../../classic/compose/compose-stability.feature#L6) |
| ux-compose-002 | Restore a failed submission alongside newer text | [classic/compose/compose-stability.feature](../../classic/compose/compose-stability.feature#L14) |
| ux-compose-003 | Reject an entirely empty submission | [classic/compose/compose-stability.feature](../../classic/compose/compose-stability.feature#L23) |
| ux-compose-004 | Return a queued message replaces the current editor draft | [classic/compose/compose-stability.feature](../../classic/compose/compose-stability.feature#L29) |
| ux-compose-005 | Keep upload progress separate from sending state | [classic/compose/compose-stability.feature](../../classic/compose/compose-stability.feature#L37) |
| ux-compose-006 | Submit captures the destination chat | [classic/compose/compose-stability.feature](../../classic/compose/compose-stability.feature#L45) |
| ux-context-001 | Show supplied usage in the context tooltip | [classic/compose/context-meter-tooltip.feature](../../classic/compose/context-meter-tooltip.feature#L6) |
| ux-context-002 | Display missing token counts without inventing them | [classic/compose/context-meter-tooltip.feature](../../classic/compose/context-meter-tooltip.feature#L13) |
| ux-context-003 | Offer compaction only when a callback exists | [classic/compose/context-meter-tooltip.feature](../../classic/compose/context-meter-tooltip.feature#L20) |
| ux-context-004 | Show the supplied compaction title and elapsed label | [classic/compose/context-meter-tooltip.feature](../../classic/compose/context-meter-tooltip.feature#L29) |
| ux-context-005 | Apply the coded usage warning colours | [classic/compose/context-meter-tooltip.feature](../../classic/compose/context-meter-tooltip.feature#L37) |
| ux-shell-001 | Menu contains New file, Refresh tree, Reindex workspace | [classic/compose/hamburger-layout-scale.feature](../../classic/compose/hamburger-layout-scale.feature#L12) |
| ux-shell-002 | Menu contains hidden files toggle | [classic/compose/hamburger-layout-scale.feature](../../classic/compose/hamburger-layout-scale.feature#L20) |
| ux-shell-003 | Workspace items disabled in chat-only mode | [classic/compose/hamburger-layout-scale.feature](../../classic/compose/hamburger-layout-scale.feature#L27) |
| ux-shell-004 | Terminal and VNC menu controls depend on callbacks | [classic/compose/hamburger-layout-scale.feature](../../classic/compose/hamburger-layout-scale.feature#L32) |
| ux-shell-005 | Compose box spans full width | [classic/compose/hamburger-layout-scale.feature](../../classic/compose/hamburger-layout-scale.feature#L40) |
| ux-shell-006 | Hamburger button visible and above safe area | [classic/compose/hamburger-layout-scale.feature](../../classic/compose/hamburger-layout-scale.feature#L45) |
| ux-shell-007 | Tab close does not activate tab | [classic/compose/hamburger-layout-scale.feature](../../classic/compose/hamburger-layout-scale.feature#L51) |
| ux-shell-008 | Menu contains display scale control | [classic/compose/hamburger-layout-scale.feature](../../classic/compose/hamburger-layout-scale.feature#L58) |
| ux-compose-007 | Display an accepted text submission | [classic/compose/instant-visibility.feature](../../classic/compose/instant-visibility.feature#L7) |
| ux-compose-008 | Serialize text and references into one submission | [classic/compose/instant-visibility.feature](../../classic/compose/instant-visibility.feature#L14) |
| ux-compose-009 | Preserve the association between uploaded files and media identifiers | [classic/compose/instant-visibility.feature](../../classic/compose/instant-visibility.feature#L21) |
| ux-compose-010 | Do not erase newer typing after send completes | [classic/compose/instant-visibility.feature](../../classic/compose/instant-visibility.feature#L28) |
| ux-compose-011 | Reconcile visible messages through timeline state | [classic/compose/instant-visibility.feature](../../classic/compose/instant-visibility.feature#L35) |
| ux-reconnect-001 | Clear transient agent displays while disconnected | [classic/compose/sse-reconnection.feature](../../classic/compose/sse-reconnection.feature#L6) |
| ux-reconnect-002 | Refresh authoritative chat state after reconnect | [classic/compose/sse-reconnection.feature](../../classic/compose/sse-reconnection.feature#L14) |
| ux-reconnect-003 | Avoid replacing an active search with main-timeline refresh | [classic/compose/sse-reconnection.feature](../../classic/compose/sse-reconnection.feature#L21) |
| ux-reconnect-004 | Show version drift without automatically reloading | [classic/compose/sse-reconnection.feature](../../classic/compose/sse-reconnection.feature#L28) |
| ux-reconnect-005 | Avoid duplicate initial refresh after recent chat activation | [classic/compose/sse-reconnection.feature](../../classic/compose/sse-reconnection.feature#L36) |
| ux-thoughts-001 | Render collapsed thought content with disclosure state | [classic/compose/thoughts-panel.feature](../../classic/compose/thoughts-panel.feature#L6) |
| ux-thoughts-002 | Continue updating content independently of disclosure | [classic/compose/thoughts-panel.feature](../../classic/compose/thoughts-panel.feature#L13) |
| ux-thoughts-003 | Toggle thought panel expansion | [classic/compose/thoughts-panel.feature](../../classic/compose/thoughts-panel.feature#L19) |
| ux-thoughts-004 | Collapse an expanded status panel with Escape | [classic/compose/thoughts-panel.feature](../../classic/compose/thoughts-panel.feature#L27) |
| ux-thoughts-005 | Preserve text when changing disclosure state | [classic/compose/thoughts-panel.feature](../../classic/compose/thoughts-panel.feature#L34) |
| ux-pwa-001 | Serve a manifest with declared application icons | [classic/mobile/pwa-manifest.feature](../../classic/mobile/pwa-manifest.feature#L7) |
| ux-pwa-002 | Use configured agent-avatar URLs for manifest icons | [classic/mobile/pwa-manifest.feature](../../classic/mobile/pwa-manifest.feature#L14) |
| ux-pwa-003 | Fall back to static icons without an avatar | [classic/mobile/pwa-manifest.feature](../../classic/mobile/pwa-manifest.feature#L21) |
| ux-pwa-004 | Request sized Apple touch icons | [classic/mobile/pwa-manifest.feature](../../classic/mobile/pwa-manifest.feature#L27) |
| ux-pwa-005 | Prefer PNG avatars for favicon compatibility | [classic/mobile/pwa-manifest.feature](../../classic/mobile/pwa-manifest.feature#L42) |
| ux-pwa-006 | Vary avatar icon cache URLs with the avatar version | [classic/mobile/pwa-manifest.feature](../../classic/mobile/pwa-manifest.feature#L50) |
| ux-mobile-001 | Swipe on eligible timeline space | [classic/mobile/swipe-independence.feature](../../classic/mobile/swipe-independence.feature#L7) |
| ux-mobile-002 | Ignore gestures originating in excluded controls | [classic/mobile/swipe-independence.feature](../../classic/mobile/swipe-independence.feature#L15) |
| ux-mobile-003 | Permit designated thinking and status panel targets | [classic/mobile/swipe-independence.feature](../../classic/mobile/swipe-independence.feature#L31) |
| ux-mobile-004 | Keep swipe order stable as the selected chat changes | [classic/mobile/swipe-independence.feature](../../classic/mobile/swipe-independence.feature#L38) |
| ux-mobile-005 | Do not treat primarily vertical movement as chat navigation | [classic/mobile/swipe-independence.feature](../../classic/mobile/swipe-independence.feature#L46) |
| ux-mobile-006 | Limit horizontal wheel navigation to the supported Safari path | [classic/mobile/swipe-independence.feature](../../classic/mobile/swipe-independence.feature#L52) |
| ux-session-001 | Show the selected chat's timeline | [classic/sessions/session-switching.feature](../../classic/sessions/session-switching.feature#L6) |
| ux-session-002 | Group picker entries using the current session metadata | [classic/sessions/session-switching.feature](../../classic/sessions/session-switching.feature#L14) |
| ux-session-003 | Filter session entries using their search metadata | [classic/sessions/session-switching.feature](../../classic/sessions/session-switching.feature#L21) |
| ux-session-004 | Use archive and restore actions supplied for session entries | [classic/sessions/session-switching.feature](../../classic/sessions/session-switching.feature#L28) |
| ux-session-005 | Keep touch swipe eligibility independent of picker grouping | [classic/sessions/session-switching.feature](../../classic/sessions/session-switching.feature#L36) |
| ux-session-006 | Dismiss the session picker without choosing an entry | [classic/sessions/session-switching.feature](../../classic/sessions/session-switching.feature#L44) |
