# Tracked vendor inventory

`runtime/vendor-manifests/inventory.json` records per-file SHA256 and byte size for tracked core/skel vendor directories, fonts, WASM and declared manifest outputs. Fast CI checks that these files still match the committed inventory.

```sh
bun scripts/vendor-inventory.ts --write
bun run check:vendor-inventory
bun run test:local -- bun test ./runtime/test/scripts/vendor-inventory.test.ts
```

Generation reads Git's tracked-file list, sorts paths and links declarations from existing manifests. Regenerate after intentionally changing or adding tracked assets. Stage newly added files first so `git ls-files` sees them. Repeating generation yields identical output. The inventory itself is not an input asset.

At the initial source snapshot there are 107 files, 83 without a manifest link and 24 identical-payload groups. Examples include duplicated KaTeX fonts and built FiraCode copies. Identical bytes do not establish that a copy is unused; packaging/browser import paths need separate review before removal. A manifest link identifies declared ownership, not verified package integrity, upstream licence or current security status. Unrecorded assets stay visible and do not automatically fail CI; checksum changes do.

This first #1190 tranche makes the tracked payload auditable without upgrading/removing vendors. Existing manifests differ in schema; some record outputs only, others package licences/integrity. The broader audit still needs first-party add-on inventories (including lite-term), stable upstream comparisons/advisories, release dates, licence completeness, regeneration twice, source-of-truth decisions and actual packed/container payload checks. Files outside vendor directories or declared outputs may need explicit inclusion during that audit. The inventory is bounded; it is not a completed supply-chain audit.
