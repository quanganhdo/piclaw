# Attachment index retirement and measured exceptions

Core startup retires `idx_message_media_message_rowid` under owned migration `host.core-indexes:retire-attachment-rowid-v1`. The primary key `(message_rowid, media_id)` already supplies a covering search for single-message and batched attachment lookup, including single-message media ordering.

## Retained indexes

The other two audit candidates remain. No replacement indexes were added.

| Index | Measured reason to retain |
|---|---|
| `idx_extension_kv_ext_scope` | The existing per-extension count runs on every KV set. Removing this narrower covering index raised median count cost from 20.440 to 24.120 microseconds (18.0%); slower in 24/24 paired rounds. The wider PK still covered the query, but coverage alone did not establish equal scan cost. |
| `idx_token_usage_chat_jid` | Removing it changed the hot-chat aggregate plan to `idx_token_usage_chat_jid_run_at`. Median cost rose from 3674.213 to 4319.391 microseconds (17.6%); slower in 24/24 paired rounds. The date composite remains useful and is also retained. |

These are offline synthetic warm-cache measurements. They do not establish production latency or throughput. The broader schema/accounting ownership changes remain #1684/#1695.

## Selected attachment-only result

A separate interleaved profile removed only the attachment index and explicitly retained both exceptions. All query-result digests matched, and table-content digests matched after write cleanup. Benchmark cleanup excludes KV created/updated timestamps; migration tests separately compare complete raw rows, blobs and counters.

| SQL operation | Baseline median, microseconds | Attachment-only median, microseconds | Change |
|---|---:|---:|---:|
| Single-message attachment read | 0.648 | 0.640 | -1.2% |
| Batch lookup for 50 message rows | 27.075 | 27.596 | 1.9% |
| Attachment insert, amortised committed 200-row batch | 56.423 | 55.897 | -0.9% |

Both attachment profiles use the same covering PK. Batched DISTINCT retains its existing temporary b-tree. The change removes one maintained schema object; these measurements supply no reliable throughput or file-shrink claim. Freed pages may be reused; there is no VACUUM or truncation step in the application migration.

## Migration and rollback

Startup no longer creates the retired index. Its explicit migration checks the exact ascending BINARY primary-key replacement and validates any historical target as a non-unique, non-partial index on only `message_rowid`. Unknown expressions, collations, ordering, uniqueness, owner tables, views or shadowed ledgers fail before deletion. SQL and its checksummed receipt share the existing startup writer transaction. Temporary table/index aliases cannot redirect the main-schema operation.

PK autoindexes, the media reverse lookup, both retained exceptions, longer composites and the separate chat-only messages index remain. Rows, blobs, FTS/history/provenance, accounting, credentials, sequences and existing receipts are unchanged. Reopening is idempotent. If an older binary recreates the exact verified non-unique index after source rollback, newer startup applies the same retirement without rewriting its original receipt. Unknown recreated definitions fail closed.

This source change performs no live migration, backup/restore, installation, dependency upgrade, restart or data cleanup. Existing complete recovery-unit/backup contracts remain separate.

## Reproduction and evidence

The [receipt](receipts/redundant-indexes-1689.json) binds SQL-source and script hashes, SQLite/Bun versions, query plans, result digests and 24 paired warm-read/20 paired write distributions. Fixtures contain 500 chats, 25,000 messages, 40,000 synthetic media records, 50,000 attachment joins, 75 extensions with 900 keys each, and 80,000 usage rows including 8,000 in one hot chat. Both connections use WAL/FULL (`synchronous=2`), secure-delete and the same cache/mmap policy. Writes are committed batches; SQL cleanup is outside timing. No cold-cache, per-request fsync, model or network cost is measured.

The fixture extracts actual core table DDL and production SQL, adds the historical attachment index for the baseline, and performs no core startup migration. Source/receipt guard and startup behaviour are covered separately by focused tests. An initial exploratory NORMAL run is retained outside the qualified evidence; all receipt profiles use FULL. Historical workload receipts are unchanged.

Run each profile through the repository isolation/niceness launcher. Output and all fixture inputs are synthetic; the launcher removes its owned database directory:

```sh
TMPDIR=/workspace/tmp/piclaw/tests bun runtime/scripts/local-test-priority.ts --cwd runtime \
  --env PICLAW_DB_IN_MEMORY=0 -- bun ./test/fixtures/index-retirement-benchmark.ts \
  all-candidates /workspace/tmp/indexes-all.json
TMPDIR=/workspace/tmp/piclaw/tests bun runtime/scripts/local-test-priority.ts --cwd runtime \
  --env PICLAW_DB_IN_MEMORY=0 -- bun ./test/fixtures/index-retirement-benchmark.ts \
  attachment /workspace/tmp/indexes-attachment.json
```

Focused tests cover fresh/upgraded schema convergence, exact metadata/row preservation, real attachment/KV/usage APIs and plans, timeline ordering, failed receipt insertion, malformed definitions, main/temp ownership, tampered receipts and older-binary recreation. The unmodified core fails the fresh/reinitialisation counterfactuals. The frozen issue campaign uses focused tests only.
