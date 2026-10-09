# Setup artifact caches

CI, E2E and reusable integration validation cache Playwright browser binaries through `.github/actions/playwright-cache`. The publish workflow inherits the integration setup; portable/image builds are unchanged.

The exact cache key includes runner OS and architecture, pinned Bun, root/E2E dependency lock hashes, installed Playwright version and browser selection. There are no fallback restore prefixes. The sole cached path is `~/.cache/ms-playwright`; profiles, databases, credentials, workspaces and fixtures are excluded. The pinned `setup-bun` action already caches its versioned Bun executable, so no duplicate Bun cache is added.

On restoration the helper verifies a manifest of file modes, SHA256 content hashes and symlink targets. Missing, malformed or mismatched manifests discard the browser cache and fall back to normal installation. Playwright installation always runs, including on hits, to install missing revisions and required system libraries where the existing workflow requests them. Installation and verification failures fail the setup step. Cache saving occurs only after successful installation and manifest generation.

The manifest detects accidental corruption; it is unsigned. It does not authenticate arbitrary cache writers. GitHub's existing cache branch/ref isolation and the exact key remain the trust boundary. A corrupt exact-key entry cannot be overwritten through the immutable cache API, so that key repeatedly downloads browsers until the bad cache is evicted or the key changes. Correctness is preserved at the expense of cache efficiency.

## Verification

```sh
bun run test:local -- bun test ./runtime/test/scripts/playwright-cache.test.ts
bun run check:actions-workflows
```

Local fixtures cover cold, warm, altered and malformed caches and preserve a private file outside the browser directory. Workflow contracts check key coverage, restricted paths and mandatory installation. Ordinary automatic CI supplies browser acceptance and setup timing evidence. E2E/tag integration still requires its usual release triggers; local fixture tests do not qualify those gates. No ad-hoc hosted runs are required by this change.
