# Experimental desktop shell

PiClaw's Electrobun wrapper opens the local web UI in a native window. It is experimental and separate from the portable runtime bundles.

## Build and run

From a source checkout, install development dependencies with the Bun version required by [BUN_VERSION](../BUN_VERSION), then build:

```bash
bun install
bun run build:desktop
```

For development:

```bash
bun run desktop:dev
```

The build commands rebuild web assets before invoking Electrobun. See [development](development.md) for the source workflow. Release automation builds desktop assets only when its experimental desktop flag is enabled; ordinary portable runtime downloads do not include this wrapper.

## Runtime and workspace

By default, the shell starts PiClaw on `127.0.0.1`, searches for an available port starting at `18080`, and opens a window pointing to it. The default workspace is `PiClaw/workspace` beneath Electrobun's platform application-data directory; `PICLAW_WORKSPACE` can override it.

Set `PICLAW_DESKTOP_URL` to an already-running PiClaw URL to open that server without starting a local runtime. That server's workspace and authentication settings apply.

The wrapper does not isolate agent tools from your user account. Follow the [native first-run and security instructions](getting-started.md#start-a-native-workspace), and update the seeded `AGENTS.md` for your host platform. Single-user [access-mode limits](multi-user/README.md) apply here too.
