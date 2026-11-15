# Compose-reference caller typecheck

`typecheck:web-compose` checks `MainApp`, its six composition modules and the compile-negative contract, with strict callback variance. #1272's first target omitted `web/src/app.ts`; the final #1270 audit found that omission using the compiler's file list.

## Existing diagnostics

The raw frontend graph has **299 pre-existing out-of-seam diagnostics**. The scoped command succeeds only when its exact diagnostic set equals the committed baseline. Added and resolved diagnostics both fail the command. No source suppression, blanket `any`, import exemption or relaxed assertion was added.

The expanded baseline was collected from unchanged source at `b26e64b2ebe9da122c8b7aa4a24dd770545dad4f`, before changing any fixture:

- The original target has 90 diagnostics. Its guard failed because line locations drifted after earlier frontend edits. All 90 diagnostic identities—path, code and first-line message, excluding location—are unchanged.
- Including the previously unchecked `MainApp` graph exposes 201 more existing diagnostics.
- Enabling `strictFunctionTypes` exposes eight more existing diagnostics outside the selected seam.
- All 90 original diagnostic identities remain in the expanded baseline. Zero were waived or removed. The baseline uses exact locations; the guard's comparison rules remain unchanged.

These diagnostics include unrelated rendering, timeline, SSE, DOM and lifecycle contracts. The selected MainApp compose-reference call and its removal-ref bridge have no diagnostics. Raw compilation still exits unsuccessfully; the scoped command reports that limitation explicitly.

## Negative and behavioural evidence

The compile-only fixture keeps its original six negative assignments and adds wrong callback parameters and a misspelled action member. Removing their compiler errors fails with unused `@ts-expect-error` diagnostics.

Three mutations of the actual MainApp removal-ref argument each fail the expanded command at `app.ts:370`:

| Mutation | Diagnostic |
| --- | --- |
| Non-callable `current: 123` | TS2322 |
| Misspelled `removeFileRefReff` | TS2561 |
| Number-only callback for a normalisable reference | TS2322 |

Each mutation was restored before the next check. MainApp's source bytes are unchanged. The final scoped check passes. The interaction/pane/shell/reference regressions pass **11 cases / 48 assertions**. Disposable Chromium passes the referenced-tab close, latest callback after rerender and retained sibling-tab test (**1 case / 3 assertions**). Hook-TDZ checking passes. No live server was used.

## Scope and rollback

This repairs verification coverage. Production source, generated bundles, dependencies, UX and hook ordering are unchanged. Backend LOC, forwarding-stage and lifecycle-owner credit are all **zero**. Reverting the scoped commit restores the earlier coverage and baseline without changing runtime data or behaviour.

The machine receipt is [compose-reference-caller-typecheck-1272.json](receipts/compose-reference-caller-typecheck-1272.json).
