# Remaining issue qualification

## Dictation #1620

Added Chromium/WebKit steering-shortcut tests across both skins and light/dark document themes; a programmatic binding test verifies repeated submission shares the final barrier. An actual dynamically imported browser add-on registers/selects a provider and throws; both engines verify selection rolls back. Production gateway callbacks now have a fixture covering mandatory authentication, Origin denial, admission, open, buffered output/backpressure rejection and close/disposal. Existing real-cookie/Bun transport, frame limits, expiry, revocation and retained capacity tests remain in the gate.

Synthetic capture is labelled; no real microphone, model or recogniser installation occurs. The add-on must choose a minimum released core version after these source changes appear in a release; source merge does not deploy the API.

## Theme response #1559

A source-traced failure was reproduced: `storeMessage` can return null, and the write service previously resolved without a row or broadcast. `/theme` then reported successful response delivery. The UI-only theme reply now opts into strict persistence failure reporting. Other control-command reply paths preserve their acceptance/cursor semantics, preventing already-executed commands from becoming replayable merely because their reply failed.

Both skins acknowledge the applied command, clear the submitted input and display an existing compose notice: “Command handled, but its timeline reply could not be delivered. Do not resend the command.” They do not fabricate a timeline row, restore the command as unsent, or retry automatically. The wording covers both failed insertion and later publication failures without claiming that a committed row is absent. Browser tests exercise the real shell in both engines/skins; handler tests use the actual write service's null-result path.

This resolves verified silent response-loss behaviour. No claim identifies the original remote eviction-correlated incident's database error.

## Tool activation #193

Activation now reads back the effective active set after the setter. Catalog-present requests excluded by a run ceiling appear in `unavailable`, are not called newly active, and are not listed as active. Tests exercise a real ceiling controller, repeated rejected requests and successful activation after release. No registered-handler fallback or tool-policy bypass is added.

Next-model-step activation succeeds with the real SDK and actual Plan add-on; activation/use in the same assistant batch remains unsupported because the executable snapshot precedes activation. The original report of repeated later ordinary-branch failure remains open pending affected-runtime evidence. The corrected receipt makes that trace distinguish policy-filtered activation from successful activation.

## Receipts

Fresh full gate: 6,814 pass, 74 skip, zero failures, then 25 feature and nine build checks. Chromium/WebKit qualification: 36 tests, 230 assertions across submission acknowledgement, dictation and failed-import fixtures. Independent read-only review found no remaining blocker after the global-write-failure change was narrowed; reviews did not run tests.

No deployment, restart, credential change or remote authenticated provider research.
