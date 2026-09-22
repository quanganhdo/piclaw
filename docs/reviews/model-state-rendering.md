# Consistent model, thinking and context display

Model metadata now survives partial updates and same-chat rerenders without carrying selection or context state into a different chat. The five-second shared polling cadence is unchanged.

## Reproduced causes

- Classic's activation effect depended on the identity of its refresh callback. Recreated callbacks could reset model/thinking state during an ordinary same-chat rerender. The new fixture deliberately recreates those callbacks; unchanged production source loses the model label.
- Partial updates replaced the model payload rather than merging it with the last successful same-chat metadata. Label-only thinking events were not recognised, and a raw thinking change could retain the previous formatted label.
- The compact snapshot's `available_model_count` was not considered by Classic's picker visibility check. A cold chat with available models but no selected model could lose the entire picker.
- Visual gave retained run-status model/thinking values precedence over the current selection. It also treated omitted fields as empty and did not clear all local state when the active chat changed.
- A slow context request could overwrite newer same-generation streamed usage. Visual also retained old-generation meters through its nullish context merge and could restore the old global context-cache fallback.

Six new browser regressions fail against unchanged source at `2e2fd03a1` and pass with this patch. They exercise Classic's real refresh hook and ComposeBox, and Visual's real poller and both ModelContextBar instances. This reproduces the state-handling defects; it does not prove which sequence occurred on the reporting tablet.

## Changes

`mergeModelStatePayload` is shared by both skins. Omitted fields preserve same-model metadata; explicit selection changes clear model-specific thinking/options/usage until replaced. `thinking_level_label` alone is recognised, raw thinking updates replace stale labels, and explicit `supports_thinking:false` or `current:null` clears thinking display.

Classic resets only on a real chat activation. A per-chat model revision prevents an older request from replacing a newer event result. Failed/absent refreshes preserve last-known same-chat metadata; explicit clears still apply. Compact model counts keep the picker accessible as “Select model”.

Visual uses current selection fields after they are known, falling back to agent run metadata only before selection is established. Partial model/context errors contribute to the existing stale indicator. Chat changes clear selection, context, deferred callbacks and last-success state; only that chat's cache is restored. No global legacy context fallback is used.

Context updates use revision checks to reject responses started before a newer update. Authoritative session-generation changes clear old meters while retaining independently aggregated usage telemetry. Conflicting or unversioned pushed Visual context cannot overwrite an established generation. Explicit zero tokens remain valid.

## Verification

- **88 focused tests / 316 assertions** cover partial model merges, explicit clears, thinking labels/off, compact-count picker visibility, context generations, delayed same-generation reads and existing compose/Settings contracts.
- **39 Chromium/WebKit browser cases / 1,422 assertions** cover the real lifecycle/components, same-chat callback churn, failed/partial snapshots, model changes during pending JSON, cross-chat response rejection, generation reset, stale pushed context, reconnect, unmount and mobile/desktop consumers. Existing model Settings, picker geometry and Classic idle regressions pass.
- Existing hybrid Classic/Visual polling test still produces 12 shared requests/minute. No extra interval or endpoint was introduced.
- Full `make ci-fast`: **5,552 runtime passes**, 4 skips, zero failures; 25 feature tests and 9 build tests. Four typechecks and scoped lint pass.

Fixtures serve synthetic data on an ephemeral localhost origin. No production theme, model, thinking setting or database was changed. Both delegated read-only review attempts timed out, so no independent review is claimed.

This patch does not change the backend model selection, thinking policy, context accounting or provider routing. Confirmed values remain visible during transient failures; they are not represented as fresh measurements. No merge, installation or reload is included.
