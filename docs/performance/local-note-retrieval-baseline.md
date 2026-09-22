# Local-note retrieval baseline (#1346)

The existing file-level search retrieves every labelled relevant file within its
top five on this synthetic corpus, but returns lexical hits for half the
unanswerable questions. It has no revision-bound citation capability and misses
an edit when file size and timestamp are unchanged. Identical-score ordering can
change after rebuilding the index.

Production baseline: `dc577cbb89b97ccc5d43f5e49f539ecec056897d`, after acceptance of
[#1348](https://github.com/rcarmo/piclaw/pull/1348). No production retrieval,
permissions, schema or ranking code changes in this evaluation.

## Corpus and independent labels

The [fixture directory](../../runtime/test/fixtures/note-retrieval/README.md)
contains twelve synthetic Markdown notes and 24 fixed queries, with twelve
queries each in development and held-out splits. Ten in each split are answerable;
two are deliberately unanswerable, one with shared vocabulary and one without.
The held-out questions use different topics from the development questions.

Coverage includes decisions, preferences, chronology, exact identifiers,
superseded/current policy, duplicate headings, a long multi-topic note and
UTF-8 BOM/CRLF. The author manually chose relevant sections and acceptable source
line ranges before the first baseline run. Quotes are checked against original
files, not search snippets or a future chunker's output. Corpus/labels were frozen
in commit `2b21a5c09b1e31244a58fb1ba175b854762b2989`; their SHA-256 manifest is
checked on every run. No private notes, transcripts, credentials or model output
were used. The exact CRLF fixture has a file-scoped Git whitespace attribute.

A second size case adds 500 neutral synthetic files without changing the labelled
notes/queries: 512 total files and 3,852,667 source bytes versus 12 files and 15,277
bytes. This is a storage/scan scaling fixture, not a second relevance corpus or
an exhaustive test of the accepted 2,000-file/32 MiB ceilings.

## Measurement and scoring

The runner invokes the real `refreshWorkspaceIndex`, `searchWorkspace` and
registered `search_workspace` tool against owned temporary workspaces and a
file-backed SQLite database. It explicitly sets single-user mode, `notes` scope,
OR matching and limit five, disables background launches and requests no provider
or network work. The repository launcher strips credentials, validates temporary
paths and lowers process priority. Worker runs have a 120-second timeout.

A returned file gets full credit if it contains any labelled relevant section.
File Recall@k and MRR@k use unique relevant files. Section coverage is reported as
an **optimistic upper bound**: retrieving the enclosing file counts every labelled
section in it, even if the snippet omits the answer. Snippet localisation is not
scored as citation success. Citation correctness is `null/unsupported` because the
baseline returns no chunk revision or line citation. A contradictory old policy
can appear among false positives even when the current-policy file is retrieved.

Response bytes measure the actual serialized tool result, including its text and
details payload. Tokens are an explicitly approximate `ceil(bytes / 4)` metric;
no model tokenizer or paid provider call is used. Mtime fields make raw payloads
vary, so repeatability compares result paths and quality metrics, not timestamp
bytes. The runner does not sort results to conceal the SQL's missing secondary
tie-break. Equal-content tie probes are separate from the frozen relevance corpus.

The recorded run uses Bun 1.4.1 on local Linux, two independently built indexes per
size, each followed by a fresh-process reopen. Each query has five repeat reads.
Warm latency covers search API calls; tool serialization is measured separately
as bytes. "Cold" means a fresh process and SQLite connection; the OS page cache
was **not** flushed. RSS is sampled near the end of a worker and is not peak RSS.
These are observations with a small number of rebuilds, not confidence intervals.

## Results

At k=5, both size cases produced:

- File recall: **1.00** in development and held-out splits.
- File precision: **0.595** development, **0.733** held-out.
- MRR: **1.00** development; held-out **0.933** with twelve files and **1.00**
  with 512 files. Added distractors can change BM25's corpus statistics; this is
  not a ranking improvement.
- Unanswerable false-positive rate: **0.50** in each split. Lexical matches do not
  establish that a question is answerable or give a semantic confidence score.
- Mean tool-response bytes: **714.7** development and **527.8** held-out;
  maxima **1,605** and **1,047** respectively (at most 402 estimated tokens).
- Precise citation correctness: **unsupported**, not a zero-error citation score.

For the 512-file case, held-out Recall@1 is **1.00**; the smaller case is **0.90**.
All labelled queries retained order within each index and across reopen. The
separate identical-score probe reversed order between two independent 512-file
builds. The smaller final sample happened to keep its tie order, while an earlier
small rebuild probe also reversed it. No deterministic cross-build tie guarantee
exists in the current `ORDER BY bm25(...)` query.

Observed ranges across the two builds and their reopens:

| Measurement | 12 files | 512 files |
| --- | ---: | ---: |
| Warm query p95 | 0.34–3.50 ms | 0.24–0.52 ms |
| First query after build/reopen | 1.56–2.78 ms | 0.92–1.71 ms |
| Initial refresh | 0.30–0.50 s | 14.14–14.27 s |
| Unchanged refresh | 24–27 ms | 60–299 ms |
| Edit refresh | 71–209 ms | 93–108 ms |
| Add / delete refresh | 47–98 / 48–60 ms | 80–82 / 79–95 ms |
| Index-owned SQLite pages after probes | 53,248 bytes | 4,751,360 bytes |
| Maximum sampled worker RSS | 67.5 MiB | 78.6 MiB |

The recorded JSON includes unchanged/edit/add/delete refresh times separately.
The whole database also contains Piclaw schema unrelated to this index; report
`indexOwnedBytes` from SQLite `dbstat` separately from whole-database logical bytes.
Platforms without `dbstat` report `null`, not zero. SQLite free-page/WAL overhead
is not bounded by the source-byte count and this evaluation does not exercise the
future chunk-generation cleanup contract.

Incremental ordinary edit/add/delete probes passed in both builds at both sizes.
The exact metadata-preserving edit changed `SQLite` to `DuckDB` while preserving
byte length and a fixed integer-second mtime. Both index metadata and filesystem
metadata were checked equal before refresh. The new word was not found afterward:
the current metadata shortcut misses the edit, as anticipated by #1345. The
fixture restores the original corpus before the reopen measurement.

Full results: [local-note-retrieval-baseline-results.json](local-note-retrieval-baseline-results.json).

## Proposed budgets before ranking changes

The machine-readable [budgets](../../runtime/test/fixtures/note-retrieval/budgets.json)
were written **after** the first repeated measurements and **before** any ranking
changes. They require acceptance before #390 treats them as a release gate.

- Preserve File Recall@5 ≥ **1.00**, MRR@5 ≥ **0.93**, and file precision ≥ **0.59**
  in each fixed split; do not win on one split by losing the other.
- Future retrieval: unanswerable false-positive rate ≤ **0.25**, citation
  correctness **1.00**, detection of same-metadata edits, and stable tie ordering.
  The current baseline fails or cannot evaluate these requirements.
- Tool response ≤ **4,096 bytes** / **1,024 estimated tokens** at k=5.
- On comparable local hardware: warm p95 ≤ **10 ms**, first fresh-process query
  ≤ **50 ms**, initial refresh ≤ **2 s** for the small fixture and ≤ **30 s** for
  512 files; incremental refresh ≤ **30 s** for that size.
- Index-owned bytes ≤ **2× source bytes** for the large fixture; small index ≤
  **128 KiB**; sampled worker RSS ≤ **256 MiB**. This does not certify peak RSS.

Timing/resource budgets are report thresholds, not CI wall-clock assertions on
unknown runners. The accepted contract's larger work/output ceilings remain the
implementation limits. #1346's proposed measured thresholds can be revised only
with explicit evidence and versioned approval. Broader datasets and genuinely
untouched held-out queries are needed before making general relevance claims.

## Reproduction and CI

```sh
bun run test:local -- bun runtime/scripts/note-retrieval-baseline.ts --repeat-build
bun run test:local --cwd runtime -- bun test test/note-retrieval-baseline.test.ts
```

Use `--small` for the small corpus only. The runner refuses to run outside the
filesystem-isolated launcher. It emits JSON to stdout and leaves temporary data
for the launcher to clean up. Capture stdout from the parent shell if a report is
needed. Tests validate frozen labels, useful/irrelevant scoring, uncertainty,
exact metadata preservation, repeated reads/reopens and reported tie behaviour.
They do not require an unstable baseline tie order to become deterministic by fiat.

Validation on the evaluation branch: five baseline/scoring tests, 46 assertions;
all four configured typechecks; full `make ci-fast` with **5,513 runtime passes,
four skips, zero failures**, **25 feature passes** and **nine build passes**.
Filesystem-isolation/entrypoint and silent-catch guards pass. Repository lint has
20 pre-existing diagnostics, unchanged from the checked main baseline; none
concerns this evaluation. Passing tests validate the measurement and fixtures,
not future retrieval quality or the proposed acceptance thresholds.

## Freshness and tie-order follow-up

[Content freshness and deterministic ties](local-note-retrieval-freshness-ties.md) records the subsequent production correction and matched rerun. The measurements above remain the original baseline; corpus labels and hashes are unchanged.
