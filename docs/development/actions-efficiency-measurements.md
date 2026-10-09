# Actions execution measurements

`scripts/actions-efficiency-report.ts` collects GitHub Actions metadata through the authenticated `gh api` CLI. It never requests raw logs or artifact downloads, schedules tasks, dispatches workflows or changes GitHub state.

```sh
bun scripts/actions-efficiency-report.ts owner/repo \
  2026-10-07T00:00:00Z 2026-10-21T00:00:00Z /tmp/actions-window 100
```

Arguments are repository, inclusive run-creation window, output prefix and optional maximum run count (1–500, default 100). Outputs are a sanitised JSON metadata snapshot and a Markdown report. If the run limit is exceeded, `truncated` is true. Missing attempt/job/artifact API responses set `incomplete`; they do not count as zero-cost or successful coverage.

Every run attempt is queried. Job IDs deduplicate carried-forward jobs across attempts, and artifact IDs deduplicate artifact metadata. Runner job wall time sums valid start/end intervals for distinct jobs. In-progress, missing and reversed timestamps remain unknown. Step intervals are reported separately and are never added to job totals. Additional attempts describe workflow retry counts, not the number of rerun jobs. Artifact bytes describe returned metadata, including expired entries; deleted artifacts and historical transfer cannot be reconstructed.

Successful named fast-CI, browser, install-smoke, integration and E2E steps are labelled as observed step records. This cannot certify the complete assertions or capability coverage inside each step. No trusted-reuse publisher is active, so trusted reuse is explicitly unmeasured. Reports do not estimate billing, quota or cost savings from runner wall time.

For a two-week comparison, collect equivalent complete windows, retain the JSON snapshots and report command, and compare distinct execution totals alongside changed coverage and cancellation rates. Separate approved trusted reuse from hosted fallback once that mechanism exists. The initial bounded sample is not a two-week savings result. No repeated model task or recurring schedule is required.

Test calculations locally:

```sh
bun run test:local -- bun test ./runtime/test/scripts/actions-efficiency-report.test.ts
```
