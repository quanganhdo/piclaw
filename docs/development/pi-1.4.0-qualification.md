# Pi 1.4.0 and Bun 1.4.4 qualification

Root and private-engine dependencies pin Earendil 1.4.0. Bun and its type packages pin 1.4.4. The two SDK installations stay physically separate; qualification keeps its existing `pi-durable-130` path for stable fixture references.

## Published package identity

The upstream tag resolves to `4a080252f06caf63a525d7873c5d94d3c23887e0`.

- The current Root manifest records all eight packages, archive SHA1/SHA512, export fingerprints, complete payload tree hashes and registry-served provenance statements. All 2,693 published files match the installed Root payloads. Attestation subject, tag and commit were checked; signatures were not independently verified.
- The private engine's separate provenance record verifies all 1,447 published files in its five-package closure. Normal tests verify this record offline.
- Historical `120` JSON/log receipts retain their original versions and hashes. Current installed-package tests use new `140` evidence. Stable test/fixture filenames do not turn the old receipts into 1.4.0 evidence.

Current records:

- `docs/design/earendil-agent-harness-integration-adr/evidence/dependency-manifest.json`
- `docs/design/earendil-agent-harness-integration-adr/evidence/receipts/earendil-140-*.json`
- `runtime/test/fixtures/earendil-package-admission/cli-artifact-1.4.0.json`
- `runtime/test/agent-control/fixtures/provider-auth-inventory-140.json`
- `qualification/pi-durable-130/provenance.json`

## API adaptation

Every host document supplies `checkpointWhen: () => false`, preserving the previous implicit delta policy. Stored document kinds, versions, ownership, history and fork semantics stay unchanged.

Host model/settings access resolves the SDK's new function-valued options at use. Runtime capture preserves bound callbacks and a detached client identity. JSON request identity passes through the model bridge; private SDK telemetry spans stay local to their graph. Host transport tracing and existing credential, provider, source, budget and callback fences remain in place.

The real native HTTP fixture initially faulted before provider entry on the new `telemetry` option. The adapted bridge settles the same fixture. Focused chat, image, classifier and deferred probes verify that span methods never cross the bridge, identity remains data, callbacks stay denied and policy revocation still prevents dispatch.

## SQLite format and activation boundary

Pi Durable 1.4.0 opens SQLite storage at format 2. Its migration rebuilds `tasks` to admit `sleeping`; earlier SDKs reject the new format. This is an irreversible SDK-format boundary for an existing store.

The isolated v1-to-v2 probe verifies unchanged task rows, IDs and receipts, integrity checks, and rejection by the down-level migration reader. Only the SDK task-table fingerprint changes. The ownership contract admits that exact v2 fingerprint and retains the exact v1 shape for historical read-only inventory. A real sleeping task retains its deadline and next phase across cold reopen, without repeating its prior phase or effect.

No live store is opened by source qualification. Before deployment:

1. Establish a quiescent ownership boundary; preserve accepted and uncertain work.
2. Take a complete matching checkpoint of database, profile and application artefacts.
3. Treat rollback as restoration of that complete checkpoint. Never point SDK 1.3.0 at a migrated database.

A source merge or Bun binary update does not authorise deployment, a live migration or a restart.

## Scoped checks

Validation uses exact-path tests through the repository's isolated priority launcher, with niceness at least 10. It covers package identity, copied history, SQLite upgrade/sleep, runtime option capture, model bridge controls, native HTTP/compaction/scheduling/codemode/process/Goal consumers, current MCP/OAuth/auth lifecycle, and add-on CLI/import compatibility. Relevant runtime, engine, qualification and add-on type projects are checked separately.

Fresh synthetic receipts contain 65 device/browser rows and ten packaged CLI login rows. CLI/browser callbacks run in a separate loopback-only network namespace after dropping privileges. Device probes use exact fetch interceptors and make no OS-sandbox claim. No real provider login, credential, model inference or live profile is used.

These focused checks do not establish a full host/native gate or hosted CI result.

## Reproducing evidence acquisition

Explicit acquisition is separate from normal tests:

```sh
bun scripts/qualification/pi140/generate-current-contracts.ts --allow-network
bun runtime/test/agent-control/fixtures/provider-auth-inventory-140.ts \
  > runtime/test/agent-control/fixtures/provider-auth-inventory-140.json
bun scripts/qualification/pi140/finish-auth-140.ts
bun scripts/qualification/pi140/measure-cli-remaining.ts
TMPDIR=/workspace/tmp/piclaw/tests bun qualification/pi-durable-130/src/provenance.ts --record
```

Use disposable profiles and the documented network/privilege guards for auth probes. Acquisition verifies package metadata and archives; normal offline tests never fetch or repair their prerequisites.
