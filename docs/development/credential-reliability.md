# Credential reliability

This change improves diagnosis and recovery. It does not establish the cause of Flint's Codex failures.

## Behaviour

- Credential storage/lock/permissions/parsing failures and unknown resolution failures use a separate non-retryable `credential_storage` category. The existing outcome marker does not suggest signing in.
- Recognised rejected authentication retains login guidance. Temporary credential-service failures retain the network category.
- Structured credential diagnostics contain only fixed categories, operation names and allowlisted codes/statuses. They never include provider messages, paths, account identifiers, tokens or error causes. Throwing diagnostic getters are not invoked.
- OAuth transient retries cover Pi 1.1.0's inclusive five-minute pre-expiry refresh window. Proactive retries require a typed OAuth failure; arbitrary modification callbacks are not retried just because a token expires soon. Retries remain bounded under the credential lock; rotated credentials and cancellation semantics are preserved.
- A login that saved credentials but failed local synchronization attempts one offline model refresh inside the existing provider-write queue. It never repeats login or overwrites the saved credential. Ownership, cancellation and logout handoffs remain fenced. Persistent failure reports that credentials were saved but local synchronization failed.

## Limits

There is no new automatic refresh or inference replay after a 401. An unexpired credential may still be revoked. Refresh/replay needs a provider-supported boundary that proves no output or tool execution was accepted; the current request-header retry path does not provide that guarantee.

Diagnostics are not proof of provider-side validity, automatic credential refresh on a live account, or the cause of an earlier connection failure.

## Qualification

Tests follow the existing isolated credential-store, real Pi stream and process-isolated login fixture patterns. They cover proactive threshold boundaries, bounded retries, invalid grants, lock compromise, concurrent rotation, cancellation, malformed storage/permissions/lock failures, secret sanitization, final web guidance and saved-login synchronization ownership.

Run `make ci-fast` through the repository's local-test-priority wrapper. The final local gate passed; retain the exact-head judge and hosted receipts with the PR.

## Deployment and verification

No live deployment is part of this PR. Before deployment, obtain operator approval, verify the target host/service manager and idle sessions, and preserve the current release and credential-store permissions without copying secrets into reports.

After approved deployment, correlate the next failure with the fixed diagnostic category and outcome marker. Do not force expiry, refresh, logout or login just to generate evidence. A temporary refresh failure should not request login; a storage failure should identify local credential availability; saved credentials should survive synchronization failure.

Rollback uses the previous qualified runtime release and the existing service manager. Do not restore an old credential snapshot: that could overwrite a rotated refresh token. Reverting application code must preserve current credential data.
