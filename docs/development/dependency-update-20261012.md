# Dependency update and desktop retirement — 12 October 2026

This coordinated candidate replaces the independent Piclaw dependency/workflow updates. Work is confined to `rcarmo/piclaw`; add-ons have a separate coordinated candidate. Other account repositories are outside scope.

## Changes

Routine runtime, editor, vendor, lint and Playwright dependencies are aligned with their regenerated lockfiles. OpenAI 7.31.0 is explicitly recorded in the existing coherent Pi 1.1.0 dependency test. Pi packages remain at 1.1.0.

SimpleWebAuthn moves to 14.0.3 and Preact to 11.0.1. Six ASN.1 sibling packages, including CSR, are pinned to the available coherent 2.10.0 family. This prevents newly published CSR 2.11.0 from requiring schema/X509 2.11.0 while other siblings are forced to 2.10.0. Overrides must be reviewed together on future upgrades.

Preact tests use actual DOM removal/listener semantics rather than private event fields. The Visual passkey fixture mounts its component instead of calling it as a function. Passkey list markup uses a generic element with its existing listitem role, controls and policy guards.

Artifact and github-script action pins are updated. The workflow contract retains exact-source integration, both digest image smoke gates and all five portable targets.

## Desktop retirement

Native desktop apps are discontinued under maintainer direction. Electrobun dependency, runtime/config/icon/build scripts, Make targets, packaging entries and experimental desktop release jobs/downloads are removed. Future releases publish no desktop assets. Existing historical release assets are not deleted. Web/server, container and portable runtime paths remain supported. Dependabot #1637 is closed as not pursued; no Hutch or desktop SDK migration is shipped.

## Qualification

Fresh full canonical gate: 6,814 passed, 74 skipped, zero failures, followed by 25 feature and nine build tests. Full configured typecheck passes with 94 unchanged pre-existing transitive compose diagnostics. Actions workflow and vendor metadata checks pass. Focused auth/pin tests and actual Chromium/WebKit authentication/settings/dictation/widget tests are recorded in the review receipts; the initial combined browser batch's four passkey fixture failures were corrected and all eight passkey settings cases rerun green.

No live installation, credentials, restart or deployment changed. Hosted CI on the published head is a separate required gate. Native desktop testing is no longer a qualification requirement for the removed product.
