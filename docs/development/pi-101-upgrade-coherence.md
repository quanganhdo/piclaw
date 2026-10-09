# Pi 1.0.1 upgrade coherence and cleanup

The CLI and workspace add-on dependencies must select the same Pi release as
the installed Piclaw SDK. Runtime retention callbacks must stop before their
database owner closes.

## CLI selection

The Smith instance upgraded its global Pi packages to 1.0.1, but the workspace
extension dependencies still selected 0.87.1. Delegate0.2.14 looked for the old
`dist/cli.js` and used that workspace installation. Its model-list discovery
failed while the parent SDK was already1.0.1.

[Delegate PR166](https://github.com/rcarmo/piclaw-addons/pull/166) merged at
`12f35b5987fd748544aa9b9dcd2c17c51ed617c1` and published0.2.15. The resolver reads
the package's public `bin.pi`, validates its identity and contained regular file,
and uses the current Bun runtime. Smith's global and workspace CLI now select
1.0.1. The workspace root dependency and eight family overrides are exact.
A persistent `PI_DELEGATE_CLI` command selects the canonical global Bun/CLI for
already-loaded0.2.14 sessions. New extension runtimes load0.2.15.

Both actual CLI paths passed isolated version and synthetic model-list discovery
with zero guarded network or child-process attempts. Production credentials,
model approval lists, tier policy and provider billing routes were unchanged.
The package rollback snapshot is private and retained outside the repository.

## Package-owned bytes and installed dependencies

The admission CLI compared each published package tree with its installed tree,
including a root `node_modules` created by Bun for a nested `marked` dependency
under `pi-tui`. These dependency-layout bytes are not part of the published Pi
package payload. The mismatch rejected a valid workspace installation.

`packagePayloadDigest` excludes only the root `node_modules` entry. Paths and
hashes for every other regular file and symlink remain part of the comparison;
a deeper package-owned `dist/node_modules` is still checked. Archive SHA-1 and
SHA-512, manifest identity, public exports, provider fingerprints and the full
installed dependency-tree version/server/durable checks are unchanged.
Existing `installedTreeSha256` receipt fields identify these package payload
hashes; earlier versioned receipts are unchanged.

A new mutation test failed on the original hashing implementation, then passed
with the fix. Root dependency placement changes are accepted; changed runtime
bytes and deeper packaged bytes are rejected. Focused admission checks passed
28tests/278assertions, and actual workspace admission verified eight published
payloads and42providers with zero guarded I/O.

## Retention timer ownership

The first full gate failed after the startup test left its15-minute retention
interval alive and closed the fixture database. That timer later fired during
a different DB test and threw `Database not initialized`. The failure log is
retained. Isolated startup tests passed without reproducing the late timer.

`stopToolOutputCleanup` is idempotent. The runtime shutdown stops retention
before extensible hooks, and the startup test stops it before closing its DB.
Each callback checks its exact timer identity, so a queued callback from a
stopped or replaced interval returns before reading configuration or storage.
Current-owner pruning, access checks and error propagation are unchanged.
The lifecycle regression explicitly closes the database and invokes stale
callbacks, then starts a replacement and repeats the ownership check.

Focused lifecycle/family/output/shutdown checks passed21tests/181assertions;
all five type projects passed with95unchanged compose transitive diagnostics.

## Bounded checkpoint tests

The same full gate timed out in one test containing18independent disk-backed
claim/bind/renew/abandon/retention checkpoints. Its unchanged isolated run passed
in3.18seconds. The five operation groups now have separate tests with the same
5-second default timeout. Every original checkpoint, assertion and durable
fixture remains. The focused suite passed22tests/280assertions, with individual
groups between305ms and1.11seconds. No timeout was increased.

## Qualification boundary

The first full gate recorded6,093passes,8skips and2failures across6,103tests,
39,744assertions in1295.90seconds. It is a failed gate.

The corrected frozen tree `3b883e1af06a7468a05709de44fe43f329a5e47e` passed
`make ci-fast`:6,113passed,8skipped,zerofailed,39,805assertions in966.94seconds,
plus25feature and9web tests. Log SHA-256:
`7d6bd0540dd65a0d84bb083afee58aa940e0de318b1058ba8764914eef948bbc`.
Final focused50tests/467assertions passed in16.18seconds with the same tree.
Publication adds these validation lines only.

PR1536 retention batching merged separately at9792cee4ac; its postmerge
44tests/266assertions passed on Pi1.0.1. This work does not qualify native MCP
activation, selected-owner Apply, production Delegate credential/environment
parity, live-provider canaries or pi-durable.
