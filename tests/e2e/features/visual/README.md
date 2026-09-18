# Visual UX specifications

Import [shared SVG image acceptance](../shared/svg-images.feature) alongside this root. Both skins use the same bounded image helper and browser fixtures.

Import `tests/e2e/features/visual/**/*.feature`: one feature file and five scenarios.

[core-interactions.feature](core-interactions.feature) contains:

- `@ux-extra-006`–`@ux-extra-007`: message search and result activation.
- `@ux-extra-008`: scheduled-task actions and failure feedback.
- `@ux-extra-009`–`@ux-extra-010`: scratchpad submission and split sizing.

These scenarios were extracted unchanged at Rule boundaries from the previous mixed interaction feature. This is the currently audited Visual subset, not a complete Visual product specification. Classic scenarios are not duplicated here.

[Skin differences](../canonical/audit/differences.md) · [Full scenario index](../canonical/COMPLETION.md) · [Import guidance](../README.md)
