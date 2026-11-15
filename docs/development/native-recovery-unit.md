# Native database recovery unit

A native database recovery unit contains a verified SQLite snapshot, its immutable file payloads and a versioned manifest. Matching external configuration/source artefacts and secure credential references complete the dependency set. SQLite integrity alone does not prove that set is recoverable.

This tooling accepts explicitly selected **offline copies**. It has no live backup, profile discovery, restore promotion, restart, retention or service-management path. Existing full-workspace Restic backups may already contain these components; this work neither assesses nor reconfigures those backups.

## Components and owners

- `database.sqlite`: SDK history, document families/inheritance and record IDs; imported source entries/mappings; host accepted-source/operation/terminal/outbox identities; accounting holds; media and add-on state. Code Review's saved source/snapshots/revisions/receipts remain in its 16 SQLite tables.
- `payloads/<sha256(reference)>`: every immutable file from the selected native `durable-answers` store, including unreferenced files. Capture applies no retention. Native answer references are `runtime-answer:<incarnation>:<submission>`; side input and successful side-result cache references also belong here.
- `artifacts/<sha256(reference)>`: Codex images referenced by their stored operation/path/content-hash/size proof, plus explicitly resolved adapter-owned outbox payloads. Image paths can be nested, remain inside the selected workspace and must match their original content proof.
- `manifest.json`: format version 1, database/content sizes and hashes, read-only schema ownership fingerprint, native binding fingerprint, migration-ledger fingerprints, hashed reference identities, configuration fingerprints, approved add-on source/version fingerprints, declared runtime compatibility and credential reference **names**.

The manifest contains no payload/configuration contents, raw opaque payload references, source database paths or credential values. It is private metadata: directory mode 0700, files 0600, exclusive publication and fsync. Store its digest in trusted backup metadata. Hashes prove integrity against that trusted baseline; the manifest is not a signature or an authentication test.

Normal mutable working files remain part of the separate workspace checkpoint. The database/tooling cannot reconstruct arbitrary tool inputs or working-tree changes from a review or chat. Keep the matching workspace and secure profile backup alongside the unit when those resources are needed.

## Explicit environment contract

`RecoveryEnvironment` describes the matching external resources:

```ts
const environment = {
  runtime: { coreRevision: recordedBuildRevision, sdkVersion: "1.4.0", bunVersion: recordedBunVersion },
  addonWorkspace: selectedOfflineAddonCopy,
  configurations: [{ id: "runtime-policy", path: selectedPrivateConfigurationSnapshot }],
  credentialReferences: recordedCredentialReferenceNames,
  credentialReferenceAvailable: (name: string) => offlineCredentialMetadata.has(name),
};
```

The operator supplies the complete configuration/source/credential declaration from the associated backup contract. Core revision is associated compatibility metadata; it is not inferred proof of which process wrote a database. The current checker supports SDK 1.4.0. Exact configuration byte fingerprints and approved installed add-on files/package metadata must match on verification. Unsupported source, version, shadow module or missing dependency fails before evaluation. The credential probe checks metadata availability only. It must never fetch a value, contact a provider or treat an available reference as usable authentication.

Copy configuration snapshots out of runtime `.pi`/`.piclaw` paths before selecting them. No exception permits the tool to read an active profile, even for a fixture. The selected add-on workspace is an offline copy containing public package sources under its `.pi/extensions` layout; the read-only source audit evaluates no factories or hooks. Never include authentication values in IDs, source metadata or reference names.

Native approval currently selects Code Review 0.1.11 from the pinned source in the native contract. Its persisted schema marker must be version 1. The [Code Review ownership contract](code-review-persistence.md) records the current source hash, acquisition-only writer admission and original 0.1.8 qualification. A shared schema version does not confer package/tool approval on older or changed sources. Retained optional schema is preserved while an add-on is absent; it is not recreated by capture.

## Capture and verification APIs

Source-executed tooling lives in `runtime/scripts/lib/native-recovery-unit.ts`:

```ts
const manifest = await captureNativeRecoveryUnit({
  database: selectedOfflineDatabase,
  answers: selectedOfflineAnswerDirectory,
  workspace: selectedOfflineWorkspace,
  output: newPrivateUnitDirectory,
  environment,
  externalPayloads: adapterOwnedImmutableFileProofs,
});
const approvedDigest = nativeRecoveryManifestSha256(newPrivateUnitDirectory);
await verifyNativeRecoveryUnit(newPrivateUnitDirectory, environment, approvedDigest);
```

Capture reuses `createVerifiedSqliteBackup`: committed WAL data, open-file/VFS identity checks, exclusive staging, integrity/ledger verification and no-clobber publication. It reads the resulting snapshot through the existing schema-ownership contract, validates retained Code Review versioning and derives required references from that snapshot. Messages and scheduled definitions already owned by SQLite are not guessed to be external files. Outbox payloads have adapter-specific storage; each needs an explicit immutable `(ref, path, sha256, byteLength, mediaType, redactionClass)` file proof matching its recorded redaction class. Unknown internal source owners fail explicitly. For attached inputs, publication selects the first model-failed submission or the successful input with the latest public transcript entry. Capture and verification read those public SDK Storage records from an exclusively created disposable copy, never decode private SDK record JSON or assume the primary submission owns the terminal answer. This inspection installs no Harness, scheduler, model, auth or tool registry. Its private parent must be writable; successful scratch copies are removed, failed inspections remain as evidence.

Answer files are UTF-8 and keyed by the reference hash. Missing required input/result/answer files fail even if database integrity is `ok`. Codex image bytes must match the saved hash and length. Opaque outbox reference strings stay inside the private database; the manifest records only their SHA-256 identities.

An existing output is never adopted or overwritten. File/directory symlinks, hard-linked files, input-tree output placement, unexpected objects and SQLite sidecars are refused. Files and subdirectories are synced before the manifest is published. Interrupted capture leaves an incomplete private directory; preserve it for inspection and use a new output. There is no force/retry/delete switch.

Verification checks the manifest digest when supplied, dependency fingerprints/availability, schema/bindings/ledgers, every file's bytes, complete reference closure and exact inventories. It rechecks bindings against the database rather than trusting a manifest list. Configuration, source or credential-reference mismatch fails explicitly. No source or unit file is repaired.

## Disposable paused restore qualification

`runtime/durable-engine/src/recovery-unit-qualification.ts` exposes:

```ts
await qualifyNativeRecoveryUnit(unitDirectory, environment, newQualificationDirectory, approvedDigest);
```

The destination must be new, private and offline. The function verifies the pinned unit, copies its database exclusively and opens the copy through public SDK `SqliteStorage`/`Harness` APIs with credential access denied. Scheduling stays paused; no host factory, dispatcher, resume/progress call or plugin evaluation is installed. It reads each conversation's public context and emits hashes only.

Before/after fingerprints preserve SDK conversations, documents and revisions (including imported original entries, branch mappings, provenance and inheritance), entries/tasks/submissions/record IDs, native bindings, host accepted-source/operation/terminal/outbox state and budget work/reservations. Credential access or execution-state changes fail. Original unit bytes are verified again against the same pinned manifest digest. A successful `receipt.json` records the input database/manifest identity, paused scheduling, zero credential reads, context hashes and execution-identity fingerprint. Failure retains the disposable candidate and creates no success receipt.

Public SDK open can normalise its private candidate; it does not open the original database for writing. This is paused data qualification, not permission to activate a restored service or proof of valid provider authentication. SDK 1.3 cannot reopen format-2 storage produced by SDK 1.4; software rollback requires the matching complete checkpoint.

## Focused evidence

- `runtime/test/native-recovery-references.test.ts`: reference owners, side input/results, cancelled/private-failure exclusions, nested image binding, traversal/malformed proof and opaque adapter refs.
- `runtime/test/native-recovery-unit.test.ts`: profile-path refusal before IO/probes/output and file/directory alias/private-mode boundaries.
- Default factory case `native-recovery-unit`: real native ordinary, attached-steer and side execution prepares a checkpoint; capture/verification then make no further model calls. The unit includes native answers/side caches, saved review state, a real public-API imported legacy tree and image bytes. Disposable SDK reopen preserves imported contexts/provenance and terminal/effect identities. Native terminal resolution selects the attached SDK submission's payload, whose primary submission has no answer file. Candidate provenance/outbox mutation during close fails without a receipt. Corrupt/missing payloads, configuration/source/runtime/credential mismatch, schema drift, missing adapter proofs, manifest tampering, wrong approval and sidecars fail. Unknown outbox delivery remains unknown without replay.

Only those defining cases and affected type/static checks qualify this change. No production database/configuration/credential lookup, live backup/restore, deployment or restart is implied. Owner-specific retention remains #1702; capture never prunes records or files.
