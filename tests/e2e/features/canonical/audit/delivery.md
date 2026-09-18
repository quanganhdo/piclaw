# Audit delivery receipt

- Audit commit: `cd65da9f1f5ff45fc201fb6277a9f529915fff79` (`docs(ux): audit Gherkin against shipped Classic behavior`).
- Published to `feat/canonical-ux-contract` using a normal fast-forward push.
- GitHub PR #1323 head and `git ls-remote` both confirmed that commit after publication.
- PR body updated with coverage, local validation, source-review limits and the separate immutable-oracle failure: https://github.com/rcarmo/piclaw/pull/1323.
- This receipt and the checked delivery item are a documentation-only follow-up to the audit commit.
- PR remains open. No merge, deployment or reload occurred.

Final audit validation: 24 files, 241 scenarios/outlines, 25 example rows; parser/index/path/scope checks pass; `make ci-fast` passes (5,326 runtime tests, four skips, 23 feature-regression tests, both frontend builds, nine web-build tests); type checking passes. The unchanged immutable oracle fails its SHA assertion (0 pass / 1 fail). No browser execution or complete cross-port parity is claimed.
