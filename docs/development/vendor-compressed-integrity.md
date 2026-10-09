# Compressed vendor payload integrity

The web build generates gzip siblings for static assets. `scripts/check-vendor-compressed.ts` verifies that every present gzip sibling of an inventoried vendor source decompresses to the exact source bytes. The Makefile runs this check immediately after compression; the inventory check also runs it to detect stale generated files already on disk.

```sh
bun scripts/check-vendor-compressed.ts
bun run test:local -- bun test ./runtime/test/scripts/vendor-compressed.test.ts
make build-web
```

Fresh Git checkouts may report zero pairs because gzip siblings are generated and ignored. That is not build acceptance. `make build-web` creates them before checking. Invalid gzip, mismatched bytes and gzip inventory entries without an inventoried source fail. Generated siblings are discovered only beside inventoried vendor assets, not by scanning arbitrary profiles or workspaces. Missing generated gzip siblings are not required by this helper: the build's existing compression selection determines which assets receive them.

This adds byte-consistency validation to core issue #1190. It does not verify upstream provenance, package licences or whether a vendor should be removed. No compressed payload is committed, no dependency is upgraded, and production serving behavior is unchanged.
