# Install from the GitHub repository

The Bun repository install is experimental. [Docker](../README.md#quick-start-with-docker) is the recommended deployment; [portable releases](getting-started.md#portable-releases) bundle Bun for Docker-free use.

This checkout requires Bun 1.4.1 or newer. Bun 1.3 cannot read its version 2 lockfiles. Check the chosen release's requirements before installing or downgrading Bun.

PiClaw can be installed directly from a tagged release with Bun. Replace `vX.Y.Z` below with an existing tag from [GitHub Releases](https://github.com/rcarmo/piclaw/releases):

```bash
RELEASE=vX.Y.Z
bun add -g "github:rcarmo/piclaw#${RELEASE}"
```

Pin a tag for repeatable installs; `main` may contain packaging or dependency changes between releases. Linux and macOS are the primary targets for this experimental path. It can run on Windows, but Windows deployment is unsupported.

## What happens at install time

The package includes the CLI, built web assets, core viewers, skills and bundled extensions such as `cdp_browser` and `pi-mcp-adapter`. A `postinstall` repair step handles incomplete source checkouts or damaged package trees. A normal tagged install needs no development dependencies or manual rebuild.

Draw.io, the Office backend and Windows desktop automation are [optional add-ons](settings-and-addons.md); the core installer does not install them. npm installation parity is outside this experimental path's scope.

## Start the workspace

```bash
piclaw --workspace "$HOME/piclaw-workspace" --host 127.0.0.1 --port 8080
```

This example uses a Unix shell. For Windows and for authentication, provider setup, persistent files and service management, follow [getting started](getting-started.md#start-a-native-workspace). Keep the loopback binding until remote access is secured.

The first start seeds missing workspace files from `skel/`, including `AGENTS.md`, `.pi/skills/`, notes and configuration examples. [Dream bootstrap and recovery](dream-memory.md#startup-bootstrap-and-recovery) also apply to direct installs. [MCP configuration](mcp.md) uses shared `.mcp.json` files with optional Pi-specific overrides; no `mcp-cli` installation is required.

## Access modes and upgrades

Only single-user mode is supported, regardless of Docker or native installation. Development account APIs do not enable family mode; see [Access modes](multi-user/README.md). Back up configuration, database, sessions and bootstrap key together before changing versions. Never remove access markers to downgrade a store or point an older binary at a multi-user database.

## Post-install: update AGENTS.md

The seeded `AGENTS.md` describes a Debian container. On any native installation, update:

- OS and architecture;
- installed command-line tools and package manager;
- process management and restart instructions, including whether a service manager restarts the process after `exit_process`;
- the workspace path selected with `--workspace`.

## Rebuild from source

Run build, pack and install commands from the repository root; `runtime/` is the packaged implementation subtree, not a separate package. See [repository/runtime placement rules](archive/repo-runtime-boundaries-2026-03-28.md).

For a development rebuild:

```bash
bun install              # includes development dependencies
make build-piclaw        # rebuild vendor bundles, web app and TypeScript
```

See [development](development.md) for tests and build targets.
