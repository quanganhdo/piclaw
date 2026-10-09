# Reliable agent message tags

The audit found that `is_terminal_agent_reply=0` was insufficient for classifying visible assistant updates. Web's completed-turn callback discarded provider phase and successful-response evidence, while an empty trailing result could complete the run without updating the persisted boundary row.

## Changes

- Preserve provider `textPhase` (`commentary`, `final_answer`, or absent) through turn callbacks.
- Persist a host-owned version-1 `agent_message_role` block. Explicit final-answer output remains `final` even when tools follow. Explicit commentary becomes `intermediate`; missing or ambiguous phase stays `unknown`.
- Keep run completion separate: intermediate callbacks always start with a false terminal bit. After successful finalisation without additional output, promote only the exact eligible completed row captured by that run and broadcast the updated interaction.
- Expose the role and terminal flag in timeline/API interaction data; preserve them in family SSE projection.
- Strip forged role blocks at public/model/service-effect boundaries and replace supplied tags in the host writer. Duplicate, malformed, future-version or inconsistent tags fail closed to `unknown`.
- No schema migration, guessing from prose, historical backfill, message deletion or retention policy.

The contract and future cleanup safeguards are in [agent-message-classification.md](../development/agent-message-classification.md).

## Verification

Base: `d3c9e9b6b`. Worktree: `/workspace/piclaw-worktrees/reliable-message-tags`.

- Focused tests: **61 passes, 255 assertions**, including provider phases, final-answer-before-tools, unsigned output, completed response followed by final/error, promotion, updated-interaction broadcast, forged/conflicting tags, legacy unknown rows and family projection.
- All five typecheck projects pass with the unchanged 95 transitive frontend diagnostics. Scoped lint and diff checks pass.
- Independent review initially caught premature boundary promotion and incomplete duplicate-tag validation. The corrected follow-up review found no remaining blockers.
- Full runtime phase: **5,938 passes, 8 skips, zero failures; 38,181 assertions**, in 938 seconds. Its existing process continued after an interrupted agent turn; no duplicate gate was started. The parent command had exited, so the remaining canonical stages ran separately: **25 feature passes, 9 web-build passes**, and historical 0.99.1 evidence **308 + 160 passes** (historical qualification only).
- Final unchanged-source focused rerun: **61 passes, 255 assertions**. All five typechecks, scoped lint, stale-dist, pack hygiene (24,747 files) and diff checks pass.

Tests use isolated stores. The live database has not been reclassified or modified. No installation, restart or deployment.
