# Vendor output metadata checks

`check:vendor-inventory` verifies output metadata from manifests declaring `metadataFile`, after inventory and gzip checks. It checks manifest identity, recorded output paths, byte sizes and SHA256 against shipped files. Currently 29 declared outputs pass.

```sh
bun scripts/check-vendor-metadata.ts
bun run test:local -- bun test ./runtime/test/scripts/vendor-metadata.test.ts
```

The checker supports single-output and `output_files` metadata. Output reads stay under runtime web/extensions roots; missing files and mismatched identities/hashes/sizes fail. `--report` prints failures without exiting non-zero for audit investigation; required CI uses the strict default.

Eight JetBrains Mono output records used the obsolete `web/static/fonts/vendor/` prefix. They now point to the manifest's existing `web/static/common/fonts/vendor/` files. Existing SHA256 values and sizes match every font; no font bytes or versions changed. The vendor inventory is regenerated only for the corrected metadata file.

This is a consistency check, not registry authenticity or licence validation. Manifests lacking `metadataFile`, upstream tarball integrity/licence hashes, generator reproducibility and undeclared assets remain broader #1190 work. No vendor payload upgrades/removals or production installation are performed.
