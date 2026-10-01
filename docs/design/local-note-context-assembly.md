# Internal note context assembly

`runtime/src/note-retrieval/context.ts` assembles bounded text from source snapshots
and already-ranked chunk candidates. It is groundwork for #387, with no runtime
caller or tool registration. Existing `search_workspace`, note indexing and
bootstrap behaviour are unchanged.

The [retrieval contract](local-note-retrieval-contract.md) still controls access,
source freshness and citations. The caller must establish those properties; this
pure synchronous module cannot authorise a request or detect a newer database
publication. It imports no database and performs no filesystem reads or writes.

## Input and authority boundary

`assembleNoteContext` accepts a pinned namespace, source byte snapshots and ranked
stored chunk matches. Every match supplies its path, chunk ID, full-source SHA-256,
chunker version, original byte/line bounds and the matched line range inside that
chunk. The helper verifies path eligibility, recomputes the reference hash, checks
the source digest and checks that stored byte bounds coincide with complete lines.
It never searches for a substitute paragraph after a revision mismatch.

This function must not be exposed directly as a tool or a no-identity content
reader. Hashes prove consistency only; they do not prove that a row came from the
current published index. Query/get must fetch rows and source bytes through the
admitted #387 execution closure. Callers still must validate tool grants, mode,
identity, fixed roots, database binding, namespace and current chunk rows; safely
read source files; and recheck publication, dirty/coverage generations, source
identity and reconciliation age immediately before delivery, with no awaited I/O
between that check and return.

In particular, a caller cannot fabricate a namespace and matching hash and thereby
gain file access: this helper opens no files and returns only text from supplied
bytes. It must never be used to bypass the registered tool's admission rules.
`memory_query` and `memory_get` remain unimplemented by this change.

## Context and references

- Preserve caller ranking order. No BM25 rewrite, weighted coverage, explicit
  query anchors, confidence threshold, recency boost or rejection policy.
- Start with exact matched source lines. Include the enclosing paragraph when it
  fits, then at most the adjacent nonblank blocks, within the verified chunk.
- Do not expand into another indexed chunk or across a following section heading.
  Heading ancestry remains the original chunk metadata; this helper does not
  fabricate heading text or resolve repeated headings by name.
- Retain complete source lines and their original bytes, including BOM, CRLF,
  Unicode, and lone carriage returns. Match/code boundaries never clip a supported
  top-level fenced block. A matched fence too large for the context cap is omitted.
- Quoted/list/indented fence forms outside this small parser's support omit the
  source conservatively with `context_limit`. This is not a complete CommonMark
  parser and can omit fence-like prose; callers must report incomplete coverage.
- Merge overlapping intervals of the same path and source revision if the union
  fits. Preserve the highest-ranked position and original chunk references. Do not
  glue unrelated or merely adjacent sections together.
- Context byte/line bounds describe the returned slice. `references` retains the
  original chunk IDs, full-source revisions and stored chunk bounds. Expanded
  snippets never acquire a new `nr1` ID or replace the original get reference.

An oversized union retains the earlier context and reports a limit, rather than
emitting duplicates or splitting source text. Source metadata that claims a chunk
boundary inside a supported fence fails closed. The existing chunker, its version,
its identity algorithm and database schema are unchanged.

## Bounds and assembly outcomes

These local caps are conservative implementation limits within the accepted
retrieval ceilings, not approval of #1346's quality/performance budgets:

| Limit | Value |
| --- | ---: |
| Ranked candidates | 50 |
| Source snapshots | 16 |
| Bytes per source | 512 KiB |
| Total supplied source bytes | 8 MiB |
| Source lines per file | 8,192 |
| Total supplied source lines | 32,768 |
| Text per passage | 1 KiB |
| Output passages | 5 |
| Complete serialized result, including metadata | 4 KiB |

Line ceilings are checked before allocating parser objects. This prevents tiny
newline-heavy files from turning bounded bytes into millions of objects. Parsing
is cached per supplied path; unsupported-fence exclusions are cached as well.
Each call owns its in-memory byte snapshot. Duplicate source paths are invalid.

`status: assembled` means the helper completed, not that the tool's search was
complete, relevant, authorised or current. `limited` and ordered `reasons` report:

- `source_missing`: no source snapshot supplied for the candidate;
- `source_revision_changed`: supplied bytes differ from the reference revision;
- `context_limit`: required source context cannot be safely included, or an
  overlapping union would exceed the passage limit;
- `result_limit`: another non-overlapping passage exceeds the result count;
- `response_limit`: another passage/reference set exceeds encoded response bytes.

`invalid_reference` discards the entire output for malformed references, invalid
source bytes or incompatible bounds. `input_limit` discards the whole output when
input ceilings are exceeded. Neither returns note content. Missing/stale sources
withhold their own content while preserving other valid snapshots and an explicit
limit reason. An empty candidate list is an empty assembly result, not evidence
that no answer exists.

The future query layer must map these internal reasons to the accepted query/get
outcomes, exclude known-dirty files, preserve scan/selection completeness and honour
its own cancellation/deadline. Any final tool envelope must fit its own encoded
output limit; the 4 KiB figure applies to this helper's entire JSON object only.

## Verification and integration gate

Focused tests check cross-paragraph context, same-size source changes, namespace
and ID mismatches, original reference preservation, repeated headings, exact
Unicode/BOM/CRLF ranges, supported/unsupported fences, oversized lines, duplicate
input paths, whole-result encoding, count caps and parser amplification limits.
Run through the owned filesystem-isolation launcher:

```bash
bun run test:controlled -- runtime/test/note-retrieval/context.test.ts runtime/test/note-retrieval/chunker.test.ts runtime/test/note-retrieval/coordinator.test.ts
```

A separate implementation PR must wire source validation, snapshot consistency,
query/get registration and final response formatting under #387 before this helper
serves agent requests. No production activation, deployment or restart is included.
The experimental ranking/rejection rules in #1422/#1423 are not imported or enabled.
