# Narrow-window thumbnail previews

Visual image lightboxes now mount under `document.body`, outside the message pane. Their fixed backdrop covers the viewport even when the thumbnail's ancestors clip content or establish a fixed-position containing block.

## Cause and scope

`MessageItem` and `AttachmentChip` rendered `ImageLightbox` inside their own subtrees. A fixed overlay under a containing block remains positioned relative to that block; a high z-index cannot escape it. The isolated regression places each real caller inside a 180 × 160 pixel pane with `overflow: hidden` and a transform. The previous component fails all 12 Visual cases with a backdrop offset from the viewport.

The fix uses a Preact portal only in `ImageLightbox`. Shared `OverlayShell` behaviour, media URLs, escape handling and focus/scroll cleanup are unchanged. Classic's image modal already mounts through `BodyPortal` and passes the same narrow-pane checks; no Classic production change is needed.

## Validation

Base: `e0fa73752`; isolated worktree `/workspace/piclaw-worktrees/narrow-thumbnail-preview`.

- Baseline: **12 Visual failures**, covering thumbnail and attachment-button callers in Chromium/WebKit at 320, 600 and 900 px.
- Corrected component matrix: **18 passes, 306 assertions**. Classic and Visual previews cover the viewport, contain a decoded 1600 × 1000 image, resize to 280 px, dismiss through Escape/backdrop, keep close controls reachable and release scroll locking.
- Rebuilt Classic/Visual entrypoints in Chromium/WebKit: **4 passes, 36 assertions**, using actual timeline thumbnails at 480 px and resizing to 320 px.
- Attachment unit tests: **17 passes, 58 assertions**. Five typechecks pass with the unchanged 95 transitive frontend diagnostics; scoped lint and diff check pass; web build: **9 passes**.
- Independent bounded source review found no production blockers. Exact trigger-focus restoration and nested-overlay overflow interactions were not added to the coverage; shared overlay behaviour is unchanged.

Full local `make ci-fast` passes: **5,900 runtime passes, 8 skips, zero failures; 25 feature checks; 9 web-build tests**. The separate historical 0.99.1 evidence stages also pass (308 and 160 tests); these are historical evidence, not 1.0.0 qualification. Final post-build browser rerun: **22 passes, 342 assertions**. Scoped lint, stale-dist, pack hygiene (24,746 files) and diff check pass.

Tests use disposable local fixtures. No live uploads, settings changes, installation or restart.
