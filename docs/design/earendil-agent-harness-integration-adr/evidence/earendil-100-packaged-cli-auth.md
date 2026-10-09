# Pi 1.0.0 packaged CLI login and provider selection

The official Pi 1.0.0 CLI passes eight synthetic OpenAI/Codex interactive login cases and rejects two provider-only startup invocations under Bun 1.4.2. Each case runs in a separate loopback-only network namespace with a fresh profile. This is a #1495/#1458 qualification slice; it does not establish live-account, Piclaw web-route, Delegate or native-MCP acceptance.

## Exact artifact

Target: `1.0.0`, upstream gitHead `a13d35a742c6ef8462812a28fbe1d8c8b7431c32`. Piclaw base: `ee814bd996ddeadda844572ee8ffe91c06189ed7`.

`runtime/test/fixtures/earendil-package-admission/cli-artifact-1.0.0.json` records official coding-agent and pi-ai SHA-1/SHA-512 archive integrity, complete installed-tree hashes, package file counts, the public `bin.pi` entry, 73 bundled JavaScript files and both OAuth module hashes. The archives retained by #1492 admission were rechecked against the versioned registry receipt, then compared with this worktree's installed package trees. No package was fetched by the runtime probe or modified to make it pass.

The artifact JSON SHA-256 is pinned independently in the driver and receipt test. Every execution rechecks the installed version, public bin target `dist/bundle/cli.js`, bundle aggregate and OAuth hashes. Routine receipt CI checks those same runtime-relevant bytes; it does not repeat the complete archive/tree comparison. The repository's whole lockfile is not used as an authentication fingerprint, so unrelated dependency changes do not masquerade as OAuth drift.

## Executed paths

For each of `openai` and `openai-codex`, the real terminal runs `/login <provider>` in success, denied exchange, mismatched state and cancellation cases, followed by `/quit` from the restored editor. Success requires the CLI status and exact provider-scoped persisted synthetic credentials, mode 0600, refresh token, provider-specific account/client fields, scopes and expiry. The test checks OpenAI's installation UUID and resource parameter, and explicitly observes Codex's browser/device selector before selecting its default browser path.

The preload occupies IPv4 loopback port 1455 to exercise manual handoff. A test-owned `xdg-open` records only the argument count and URL hash; it must be called once with exactly the displayed authorisation URL. The mocked token exchange checks endpoint, method, client/resource, redirect, PKCE verifier/challenge and exact request count. Failed and cancelled logins must store no credentials. Every interactive case must exit zero through `/quit`; killing the process cannot count as success.

Two non-PTY invocations pass `--provider` without `--model`, one for each provider. They require exit 1, empty stdout and the exact provider-specific `Error: --provider requires --model ...` diagnostic. No browser launcher call, token exchange or credential persistence is permitted. No initial inference prompt is supplied.

## Isolation and limits

The parent creates a separate network namespace with only loopback and no IPv4 route, then drops to the invoking non-root UID/GID with no supplementary groups/capabilities and `no-new-privs`. The driver checks those properties before package execution or profile creation. The CLI receives a minimal environment containing only disposable home/profile/cwd paths and synthetic test settings. Extensions, skills, templates, themes, context files, tools and session persistence are disabled.

Fetch/preconnect interception is installed before the official bundle loads and cannot be replaced by Codex's startup polyfill. The OS namespace independently denies external egress. Guard counters do not audit every syscall or loopback request. The IPv4 blocker does not prove absence of an IPv6 localhost listener on every platform. This evidence covers manual handoff, not automatic callbacks or a general socket-lifecycle guarantee.

The namespace, CLI and parent have finite deadlines. Raw PTY output may contain codes, URLs or synthetic tokens and is never emitted on failure. Results contain only bounded metadata and are checked for credential/code sentinels. The UID retains normal filesystem permissions; this is not a mount/filesystem sandbox. No live credentials, accounts, inference, provider token validation, MCP server or deployment were used.

The 0.99.1 fixtures, receipts and archived replay remain unchanged. New 1.0.0 results are stored in `receipts/earendil-100-packaged-cli-auth-bun.json`. Packaged CLI refresh/logout, other provider terminal flows, private web routes and broad token/URI-policy checks are outside this slice. Native MCP acceptance remains a separate gate.

## Validation

- Ten isolated cases passed, then repeated by the optional execution parent plus mandatory receipt/refusal checks: three tests, 261 assertions.
- Initial provider-only expectation omitted the CLI's `Error:` prefix; the actual exact diagnostic was retained and the expectation corrected. A scratch preparation-script escaping error occurred before it wrote candidate files. Both failed attempts are separate from passing qualification.
- Independent read-only review found no blocker. Scoped lint passes; the strict receipt test was corrected to narrow its JSON fingerprint value to a string.
- Full frozen `make ci-fast` passed: 5,914 current-runtime tests, eight existing skips, zero failures; 37,979 assertions across 853 files in 929.79 seconds. Twenty-five feature tests, both frontend builds and nine web checks passed. The separate frozen 0.99.1 replay passed 468 tests / 8,720 assertions across 45 files.
- Final pack hygiene checked 24,746 files; all five typechecks passed with the unchanged 95-diagnostic compose baseline. Final isolated execution/receipt/refusal repeat passed three tests / 261 assertions.

Frozen tree: `5ffd128d04399408ad1686c3bd217cd0252768d5`. Full log: `/workspace/tmp/1495-cli-100/ci-fast.log`, exit zero, SHA-256 `3215e07537bced73625a63da91fc480502fef0d8bb8289c77bd7cb367a6f8ab0`. Only this evidence text was updated after the full gate.

On a Linux host with the required namespace/privilege tools, enable `PICLAW_RUN_AUTH_CLI_TESTS=1` and `PICLAW_E2E_DISPOSABLE=1`, then run `test/agent-control/provider-auth-cli-100.optional.test.ts` and `provider-auth-cli-100-receipt.test.ts` through the normal isolated test launcher. Missing namespace prerequisites fail; there is no unsandboxed fallback.
