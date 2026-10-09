# Trusted receipt boundary (inactive)

`scripts/trusted-ci-receipt.ts` defines an Ed25519 signed envelope and a fail-closed verifier for a `ci-fast` claim. No workflow, launcher, service, keychain entry or GitHub check uses it. Hosted validation is unchanged.

## Approval and permissions

The current authenticated GitHub account is observed as `piclaw-bot`. Repository read/merge access does not establish Checks API write permission or approve that account as a publisher. No check-creation probe has been run. The alternative signed-envelope design needs an explicitly approved repository/actor/key ID and protected public-key policy before activation.

The signing key must live in a protected runner or separate signer process, outside the test process and repository workspace. Never inject the private key or a Checks write token into PR code. The trusted runner must independently establish the checkout, toolchain, canonical command and observed child exit, and construct the receipt from that observation. Calling `signReceipt` on arbitrary JSON supplied by PR code can authenticate forged assertions; schema validation cannot prove execution. This module is not a protected runner or a production publisher.

A signed envelope does not need GitHub API write access. Any future Checks publication requires a separately approved least-privilege application, restricted to the target repository and required Checks operations. Credentials must never be exposed to forks or tested code. Missing credentials, permission, approved policy or valid signature must fall back to ordinary hosted validation.

## Claim and verification

The envelope binds repository, actor, key ID, issuance/expiry, exact commit/tree, origin hash, lock, pinned/actual Bun and command/config hashes. It contains only the `ci-fast` result, test counts and log hash. Signing projects the local receipt onto this allowlist, excluding private logs, raw commands and environment data. Failed, interrupted, dirty, changed-source, custom-command and incomplete-count receipts cannot be signed.

The verifier receives expected source and approved public keys from protected configuration. Neither may come from the envelope or tested repository. It rejects unknown/revoked actors/keys, injected payload fields, altered signatures, stale/future validity, different source identities and non-Ed25519 keys. Rejection returns a normal-hosted-check fallback decision. Acceptance covers only the signed `ci-fast` claim; browser, install smoke, integration, E2E and platform acceptance remain separate.

Rotation requires a new key ID and explicit public-key approval. Remove or revoke the old ID in protected policy before retiring its private key. Retain historical public keys only for audit; revoked keys cannot qualify current reuse. Choose validity duration in protected policy, independent of receipt content, before deployment. This source module permits caller-chosen expiry and does not establish a production validity policy.

## Evidence still required for #1578

- Approve a protected signer and repository/actor identity.
- Establish key storage, least-privilege access, rotation and operational revocation.
- Prove that tested code cannot access or influence protected signer inputs/key material.
- Perform a separately approved minimal publication/readback probe.

Local tests use ephemeral test keys only:

```sh
bun run test:local -- bun test ./runtime/test/scripts/trusted-ci-receipt.test.ts
```
