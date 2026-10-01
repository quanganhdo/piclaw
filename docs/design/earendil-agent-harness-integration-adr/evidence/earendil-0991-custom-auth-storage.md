# New custom-provider credential writes (#1458)

New custom-provider keys use public `ModelRuntime.login()` and Piclaw's existing private credential store. Newly submitted keys are not written to `models.json` or new configuration backups. Provider logout does not create new snapshots of `auth.json`. This is evidence toward AUTH-04/05/06; the full criteria are not satisfied. Legacy keys and historical backups require a separate migration and retention decision.

## Configuration and credential ownership

Custom setup writes non-secret endpoint/model configuration, refreshes the public runtime offline, then invokes the composed provider's public API-key login. The submitted key answers only the provider-owned secret prompt. No private runtime member, alternate credential owner or SDK storage cast is used.

A blank key retains an existing usable stored credential. Required-key custom providers reject absent or blank stored credentials. Keyless local configuration does not create a credential or invoke login. Availability for every external/local provider still needs separate qualification.

Different providers share a path-scoped configuration queue so asynchronous credential checks cannot lose another provider's update. Each provider also uses the existing credential mutation queue. Custom setup retires the prior provider state only after admission to both queues; later setup takes effect in that order rather than superseding a credential already committing. Expected provider revisions fence model activation after setup.

Configuration failures before credential commit restore the previous configuration bytes and refresh the runtime. Public `CredentialSynchronizationError` identifies a committed credential whose local snapshot could not refresh: the new configuration stays in place, the user gets an explicit saved-but-refresh-failed result, and no older credential is restored. Owner/revision changes after an admitted write also deny activation without restoring superseded credentials.

Custom logout validates/parses and removes configuration before deleting stored credentials. Pre-delete failures restore configuration and preserve the credential. A post-delete synchronization failure does not resurrect a removed credential. Direct logout can remove keyless custom configuration as well as stored custom credentials.

## New backups and compatibility

New `models.json` backups omit each provider's `apiKey` field and are written with mode 0600. Active configuration writes also enforce 0600. The private credential store retains its existing 0600 file/0700 directory behavior. Backups preserve endpoint/model settings and are intentionally insufficient to recover credentials; reauthentication may be needed.

An existing target `models.json` API key blocks reconfiguration before mutation. No silent migration, removal or duplication occurs. Existing backup files are not rewritten or deleted. Other providers' active configuration is preserved. This slice does not scan or redact arbitrary headers, URLs, keychain references or historical backup contents.

## Offline tests

Thirteen disposable child scenarios exercise the real public runtime and Piclaw file store: new key and logout; blank-key update; keyless setup/logout; legacy and malformed configuration refusal; missing required key; pre-commit write rollback; committed-credential snapshot failure; concurrent providers; blank stored key; logout-delete failure; ordered same-provider setup; and a blocked credential-commit window followed by blank-key setup.

The credential-store test double subclasses the app-owned store to inject failures/barriers. It does not patch the public runtime. Each child inherits a minimal disposable profile, denies fetch/preconnect and emits only its scenario name. No inference method is called. Synthetic keys exist only in the private temporary credential file. Tests inspect active configuration/backups and verify unrelated credentials survive.

The thirteen scenarios passed 39 parent assertions plus child assertions. Related handler/isolation/card-service tests passed 52 tests and 408 assertions; the combined twelve-scenario run passed 64 tests and 444 assertions before the final commit-window case was added. Five standard typechecks, explicit strict fixture typechecking, scoped lint and diff checks passed. Independent reviews found and corrected configuration races, rollback, logout and commit-window issues; final scoped review found no blocker in the tested paths. At merged baseline `2b0f5aaa3ae7d0eeb6931535e8513331fecab72c`, `make ci-fast` passed 5,942 runtime tests, seven existing skips and no failures, plus 25 feature tests and nine web checks. Pack hygiene passed 24,741 files; final five typechecks and diff checks passed with the unchanged 95-diagnostic compose baseline. Private Bun caches were used without shared-cache permission changes.

## Remaining qualification

The configuration queue is process-local; cross-process configuration writers and crash interruption are unqualified. Existing literal keys, credential-bearing backups, complete secret/trace scans, provider-specific external auth, full CLI/device/browser matrix, Delegate children and approved live accounts remain open. This change does not certify rollback by restoring old OAuth tokens. No live account, provider request, deployment or restart was used.
