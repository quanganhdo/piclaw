# Pi 1.0.3 fresh-workspace add-on peers

Fresh workspace add-on seeds now link declared host peers to the exact creating runtime package. The synthetic VM canary exposed `Cannot find package 'typebox'` in the seeded goal add-on: offline bundle preparation omits peer dependencies, and copied workspace packages cannot resolve peers beside the installed runtime. The [receipt](receipts/pi-103-core-addon-peers.json) records the failure, source-bound qualification and import scope.

## Seed publication

`seedFreshWorkspaceCoreAddons` validates pinned add-on manifests before building an owned staging directory. Declared peers are restricted to `typebox`, `@sinclair/typebox`, `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`. Missing bundled peers resolve through the running core module's `createRequire` and link to that package directory. This avoids copying a second Pi instance or invoking a package manager/network during startup. Windows uses directory junctions; other platforms use directory symlinks.

Lexical target checks recognise dangling symlinks. A sibling exclusive seed-publisher lock coordinates concurrent seeders; staging is renamed only when no target or message database exists. Existing workspaces, upgraded/removed add-ons and their dependency trees are unchanged. Missing host peers fail before publication and staging is removed. A crash-left publisher lock fails closed; automatic deletion/recovery is excluded.

The caller already holds the workspace runtime lock. These controls coordinate normal seed publishers; they do not establish an adversarial filesystem no-clobber guarantee. Absolute peer links bind a newly seeded workspace to the creating runtime package. Relocating/removing that runtime requires a separate dependency migration. Existing workspace install/update repair is outside this correction.

## Qualification

Frozen head `09a7597b1bb8073f78dcbfc7321486dbbf28286f`, tree `d1c2470b45d2a7656c098acbd4638699fcc89c9b`, retains unchanged dependency pins and lock hash `5bf82bf6f35ed1bd7cc49bc5f521c7e39a22004b0b2570e774ea2cbf5628ee49`.

- Original isolated seeded-import regression failed with missing `typebox`.
- Seven tests / 32 assertions pass: real seeded TypeBox/Pi import, all five host-peer identities, existing workspace/update/removal preservation, dangling target, four concurrent publishers with one winner, missing-peer cleanup and invalid-bundle refusal.
- The full frozen gate passes 6,537 tests / eight existing skips / zero failures / 42,781 assertions in 661.3 s, plus 25 feature and nine web tests. Source snapshots remain clean and equal before/after each gate.
- Types and scoped lint pass; 95 unchanged compose diagnostics are retained.
- A guarded isolated probe imports all seven actual pinned core add-on entry points from the existing corrected-canary package seed, with the candidate seeding seam and zero network/child-process attempts. It checks importability and peer identity only; it does not execute add-on tools, UI or production Delegate.

Read-only review identified and corrected a dangling-target publication gap and a preliminary reserved-target approach that fails on Windows. The final sibling-lock design was reviewed clear. A first missing-peer test still inherited Bun resolution; an injected resolver failure replaces it and checks cleanup. These attempts and review timeouts supply no successful qualification. Native Windows execution is not recorded.

## Integration limits

The source correction is not installed on Smith or VM900. The completed synthetic canary receipt retains its original add-on warning and exact artifact identity. The new guarded import probe is separate evidence and does not rewrite that canary result.

Public raw auth/provider settlement and account-generation authority are still absent for production Delegate. Live account/server/Memento checks, protected Azure migration, Smith deployment/restart and token-aware rollback require separate approval. No paid inference, live credentials, service restart or existing workspace mutation occurred in this slice.
