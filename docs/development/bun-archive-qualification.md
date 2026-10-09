# Bun.Archive qualification

External `tar` remains the production extractor. Bun 1.4.2 on Linux x64 does not preserve the metadata required for a replacement.

Run the disposable corpus:

```sh
bun scripts/qualify-bun-archive.ts > /tmp/bun-archive-qualification.json
bun run test:local -- bun test ./runtime/test/scripts/bun-archive-qualification.test.ts
```

The script builds a reference archive with external tar, extracts it with each implementation into separate temporary directories, records mode/ownership/timestamp/type/link-count metadata, then probes synthetic ustar entries for traversal, absolute paths, symlink/hardlink escape, devices and overwrites. All probes stay in a fresh temporary parent and cleanup removes it. The hostile archive builder writes headers directly, independently of either extractor.

## Linux x64, Bun 1.4.2 findings

- File modes change: 0644 to 0664, 0600 to 0664, 0755 to 0775.
- Reference regular-file timestamps are not preserved.
- The reference hardlink has link count 2; the Bun-extracted hardlink is absent.
- Empty directories and ordinary symlink type survive. The fixture uses the current user/group; it does not establish arbitrary ownership preservation.
- Existing target files are overwritten.
- Hostile probes do not escape the disposable target or create a device. No explicit extraction error is raised; skipping or path normalisation is not equivalent to policy rejection.

Tests validate the corpus and reference metadata and guard against observed writes outside the target. They do not pin Bun's metadata failures permanently: a newer implementation can improve without breaking the report test. A replacement requires a separate explicit gate comparing every required metadata and security property. macOS/Windows, gzip round trips, arbitrary ownership, additional link chains and full package compatibility remain unqualified. Issue #1020 stays open; no extraction call site or Bun pin changes in this work.
