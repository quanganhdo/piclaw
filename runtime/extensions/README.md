# runtime/extensions

This directory contains filesystem-backed packaged runtime extensions. It is separate from `runtime/src/extensions/`, which contains code-registered built-in extension factories wired directly into the runtime.

## Subdirectories

- `browser/` — packaged browser automation extensions
- `platform/windows/` — packaged Windows-specific platform extensions
- `viewers/` — packaged viewer/editor web-surface extensions
- `integrations/` — packaged runtime integration/helper extensions
- `experimental/` — packaged experimental or harness-only extension entries

## Compatibility boundary

Do not confuse this tree with workspace/project-local `.pi/extensions/` or
agent-local `.pi/agent/extensions/` convention paths. Those user-facing
surfaces are compatibility-sensitive and are not the same as the packaged
runtime extension layout.

Some packaged extensions also ship colocated skills through the Pi
`resources_discover` hook. Keep those skill assets beside the extension when the
skill is tightly coupled to that integration's native tool contract.

Related:
- `runtime/src/extensions/`
- `docs/stage4-extension-skill-namespacing-inventory-2026-03-28.md`
- `docs/repo-runtime-boundaries-2026-03-28.md`
