# Earendil 0.87.1 current-loop upgrade candidate (#1381)

The isolated `feat/1381-earendil-0871` worktree pins the coordinated Earendil family to exact `0.87.1`. The running Smith installation has not changed. Harness and experimental Pico3 production imports remain off.

## Package and admission receipt

The direct `pi-agent-core`, `pi-ai` and `pi-coding-agent` pins and one `bun.lock` closure resolve six `@earendil-works` packages at `0.87.1`: `chord`, `pi-agent-core`, `pi-ai`, `pi-coding-agent`, `pi-telemetry` and `pi-tui`. Registry metadata for all six reports gitHead `f07218c4d4bbc12bef056a7058c3dd49dfe41abe`; exact shasums and SHA-512 integrities are saved in `exports/earendil-0871-upgrade-1381-20260923/registry-receipts.json`. The lockfile entries match those integrities. npm tarballs omit `gitHead`, so the registry receipt provides release provenance rather than an installed-manifest field.

A fresh, separate consumer installed only `@earendil-works/pi-coding-agent@0.87.1` with scripts disabled. The repository's read-only admission checker returned `admitted: true` under real Homebrew Node `v26.7.0` and Bun `1.4.1`. It found all six exact versions, root exports and rejected source-only deep paths; provider factory call count was zero. The probe requested offline/telemetry-disabled operation and inherited no secrets. These flags are not an OS network sandbox.

## Compatibility and current-loop evidence

The current-loop manifest selects 0.87.1 with refreshed installed package metadata and contained public-export fingerprints. Historical 0.84.x records and the published 0.87.0 candidate assessment stay unchanged. Selected Harness capabilities remain partial or unsupported; this package upgrade does not promote Harness.

The upgrade removes the obsolete 0.85.1 `deferredTools` converter branch from remote compaction. Release-pinned tests now expect 0.87.1 session projection, transcript normalization and Kimi transcript-declared tool additions. A new offline provider contract checks supported frontier catalogue IDs and image-only OpenAI-compatible content without a live provider call. Focused compatibility and admission suites, four configured typechecks and the full `make ci-fast` gate passed locally on this isolated candidate. No live SSH, Azure, Bedrock, OAuth or provider request was made.

## Add-on, merge and rollback gates

The running Delegate add-on is still `0.2.10`. Rui approved tier 3 for exact GPT-6 Sol, GPT-6 Luna and Grok 4.7; Opus 5/5.5 stays tier 5. Add-on PR #141 merged as source `8cfddeeab435cd3a49591bab0f527a08c921ea25`; published archive commit `a6fb0d1ab6b100df8160e82c92574649dca2e3ab` exposes the immutable [Delegate 0.2.11 tarball](https://raw.githubusercontent.com/rcarmo/piclaw-addons/a6fb0d1ab6b100df8160e82c92574649dca2e3ab/packages/piclaw-addon-delegate-0.2.11.tgz). Its SHA-256 is `c91358187813024563b4573dda990a6ce35407c87a21689b2fe3f9cdf457bd3f`; SRI is `sha512-6IR6jo0QRhW/P5jvHevq5wb6ruSzV5cN8a/WSQxxAW2KSoq8JXuuKuEOn93FyNHs2rroctn3UW2KuUmnzHm++w==`. The SHA-pinned and Pages archives were downloaded and matched byte-for-byte; all 21 archived files matched the merged source. A disposable copy of the add-on manifest and lockfile resolved this SHA-pinned URL and SRI without touching `/workspace/.pi/extensions`. Its reviewed copy and the release receipt are in `exports/earendil-0871-upgrade-1381-20260923/`. Those live files are outside this repository; applying the prepared pin to them and restarting requires separate deployment approval.

Before any production install, take and verify a snapshot of Piclaw state and session JSONL. Earendil 0.87.1 can append `context_edit`; 0.85.1 ignores those records on reopen. Rollback must restore the pre-upgrade snapshot as well as the older packages. Do not reopen 0.87.1-written JSONL with 0.85.1 or attempt an automatic downgrade. Production installation and restart require separate user approval.
