# Install from the GitHub repository

> Experimental: this Bun repo-install path works, but it is not yet the main recommended production install route.
>
> This repository requires Bun 1.4.1 or newer. Its version 2 lockfiles are not readable by Bun 1.3; rollback to a pre-1.4 runtime requires reverting the lockfile migration as well.

PiClaw can be installed directly from a tagged release with Bun:

```bash
bun add -g github:rcarmo/piclaw#v2.15.2
```

Replace `v2.15.2` with the release you want to install. Pin a tag for repeatable installs; `main` may contain packaging or dependency changes between releases.

This is the intended **Docker-free** install path for people who want the
packaged PiClaw CLI and web assets without building from source manually.

This path exists for low-end ARM SBCs, lightweight VMs, and other sandboxed environments where Docker is not the best fit or is unavailable. It is still experimental and is not a generally supported deployment target.

The repository root is the package/install boundary for this flow. The nested
`runtime/` directory is the packaged implementation subtree that contains the
runtime sources, web app, extensions, vendored assets, skills, packaged runtime
scripts, and packaged runtime docs.

For maintainer-facing placement rules inside the repo, see
`docs/repo-runtime-boundaries-2026-03-28.md`.

## What happens at install time

Tagged repo installs include core runtime assets in the package tree. Draw.io, Office backend and Windows desktop automation are optional add-ons; installing core does not install those add-ons.

A small `postinstall` repair step still runs automatically after `bun add`, but
it is only a fallback for incomplete source checkouts or damaged package trees.
No devDependencies or full source rebuild are required for a working runtime.

Draw.io now lives in the `piclaw-addons` repository and is no longer repaired by
piclaw's core postinstall step.

### Full development rebuild

If you want to rebuild everything from source (requires devDependencies):

```bash
bun install               # includes devDependencies
bun run build:web         # rebuild vendor bundles + web app from source
bun run build             # recompile TypeScript via tsc (optional — Bun runs .ts directly)
```

## Current scope

This path is intended for:

- Bun users
- direct GitHub-repository installs
- Linux and macOS as the primary supported targets

Windows also works in practice, but remains a secondary / not-officially-supported target for now.

For shell execution specifically, PiClaw now uses a platform split:

- Unix-like hosts: detached child process groups for cleaner process-tree termination on abort/shutdown
- Windows: attached child processes (`detached=false`) so stdout/stderr remain capturable

That tradeoff favors reliable shell output on Windows over strict parity with Unix process-group behavior.

This path installs packaged artifacts from the repository. It does not rebuild from source.

## Expected result

After install:

- `piclaw` is available in PATH
- the CLI runs without a manual build
- bundled web assets are already present
- bundled extensions/viewers required by normal runtime behavior are included
- bundled Pi extensions such as `pi-mcp-adapter` are installed with the package and available to session startup wiring
- Draw.io and the Office backend are available separately through optional add-ons
- bundled automation extensions such as `cdp_browser` are available after install
- Windows-only `win_*` desktop automation is available through the optional `@rcarmo/piclaw-addon-win-ui` add-on
- first runtime startup seeds missing workspace skeleton files from the packaged `skel/` tree (for example `AGENTS.md`, `.pi/skills/`, `notes/`, `.piclaw/config.json.example`, `.piclaw/README.md`, and the Dream/notes bootstrap files)
- a fresh workspace with missing Dream memory queues a silent bootstrap; an established workspace with lost derived files uses deterministic recovery first, as described in [Dream memory](dream-memory.md#startup-bootstrap-and-recovery)
- Dream/AutoDream workspace bootstrap files are present for direct Bun installs as well as container installs
- out-of-band Dream runs use a temporary `dream:` channel/session and clean it up after the cycle, so direct installs do not accumulate visible Dream chats

## Notes

- PiClaw now ships `pi-mcp-adapter` as a bundled dependency. Prefer shared MCP config in `.mcp.json` (project-local) or `~/.config/mcp/mcp.json` (shared global MCP config), and use `.pi/mcp.json` / `~/.pi/agent/mcp.json` for Pi-specific overrides. Starter examples are seeded at `.mcp.json.example` and `.pi/mcp.json.example`.
- `pi-mcp-adapter` does not require `mcp-cli`, and it brings its own `mcp` / `/mcp` / `/mcp-auth` surfaces once loaded.
- This path is Bun-first. npm parity is not part of the initial scope.
- The published GHCR image remains the main documented production runtime.
- The Bun repo-install path ships the bundled `cdp-browser` extension in the package tree; Windows UI automation now ships separately as `@rcarmo/piclaw-addon-win-ui`.
- Build, pack, and install commands should be run from the repo root; `runtime/` is not a separate package.
- If repo-install behavior differs slightly from the published package layout, those differences should stay small and documented.
- Dream/AutoDream details, file sequence, and outputs are documented in [`runtime/docs/dream-memory.md`](../runtime/docs/dream-memory.md).

## Access modes and upgrades

Only single-user mode is supported, regardless of Docker or native installation. Development account APIs do not enable family mode; see [Access modes](multi-user/README.md). Back up configuration, database, sessions and bootstrap key together before changing versions. Never remove access markers to downgrade a store or point an older binary at a multi-user database.

## Post-install: update AGENTS.md

The seeded `AGENTS.md` in your workspace describes a Debian Linux container
environment. On native macOS or Windows installs, update it to reflect your
actual platform, available tools, and process management. Key lines to change:

- **OS and architecture** — replace the `OS: Debian Linux (container)` line with your actual OS (e.g. `macOS (Apple Silicon, arm64)`)
- **Available CLI tools** — list the tools actually installed on your host
- **Package manager** — use `brew install` instead of `sudo apt install` on macOS
- **Restart behavior** — note that there is no Supervisor on native installs; `exit_process` will terminate piclaw and it must be restarted manually
- **Workspace path** — replace `/workspace` with your actual `--workspace` directory
