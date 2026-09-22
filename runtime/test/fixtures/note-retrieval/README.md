# Synthetic note-retrieval corpus

Twelve authored Markdown notes and 24 fixed queries provide a small local search
baseline. All names, projects, identifiers, policies and dates are fictional. No
private notes, credentials, transcript exports or provider output were used.

`corpus.json` was labelled before running the baseline. `question` states the
intended information need; `query` is the fixed tool input, not a query rewritten
by the engine. Each relevant section has manually selected source lines and an
exact quote checked against the file. Relevant ranges can include the section
heading. Conflicting historical notes are labelled separately from current policy.
An empty relevance list means the corpus contains no answer, even when lexical
matches exist. Matching words alone do not count as useful recall.

The 12 development and 12 held-out query IDs are fixed. Held-out questions use
separate note topics; all notes are indexed together, including distractors.
Do not adjust queries, relevance labels or thresholds to improve measured scores.
Any correction requires a corpus version/hash change and a recorded reason.
This is a transparent regression set, not proof of performance on private notes
or a statistically representative unseen corpus. Subsequent ranking work needs
additional untouched evaluation data if developers tune against these results.

`frozen-sha256.json` binds the notes and labels before the first baseline run.
These labels are independent of search results, snippets and any future chunker.
The deliberately repeated Rollback headings and UTF-8 BOM/CRLF file test source
range identity without deriving labels from an implementation's chunk boundaries.

After the metadata-freshness and deterministic-tie correction, the worker's
mutation/tie probes are regression requirements: equal-size/equal-mtime edits
must be detected and exact-score ties must sort by binary path. Historical
baseline results remain unchanged in the performance report. New runs identify
the measured commit and tracked-worktree modification state separately from the
original production baseline.
