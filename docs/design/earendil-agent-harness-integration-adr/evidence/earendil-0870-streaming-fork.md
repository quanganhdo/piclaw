# Earendil 0.87.0 streaming-fork evidence

Evidence date: 21 September 2026. Candidate release: `0.87.0`, commit `16787ad5b2dc748047f314ca1bfe7708f30f54f3`.

A disposable exact-0.87.0 consumer ran the public `createSessionRepoStreamingForkConformance()` suite through Piclaw's public Memory and JSONL repository fixtures.

## Result

- 15 unique public cases;
- 15 Memory executions;
- 15 JSONL executions;
- zero failures.

## Case catalogue

- branch fork application state (closed source) / excludes deleted/reappended and untouched application lists;
- branch fork application state (closed source) / excludes overwritten and unchanged application values;
- branch fork application state (open source) / excludes deleted/reappended and untouched application lists;
- branch fork application state (open source) / excludes overwritten and unchanged application values;
- fork application lists (closed source) / tree fork continues asc pagination using source cursors;
- fork application lists (closed source) / tree fork continues desc pagination using source cursors;
- fork application lists (closed source) / tree fork copies lists at distinct addresses;
- fork application lists (closed source) / tree fork copies only survivors after list deletion and reappend;
- fork application lists (closed source) / tree fork preserves list element sequences including gaps;
- fork application lists (open source) / tree fork continues asc pagination using source cursors;
- fork application lists (open source) / tree fork continues desc pagination using source cursors;
- fork application lists (open source) / tree fork copies lists at distinct addresses;
- fork application lists (open source) / tree fork copies only survivors after list deletion and reappend;
- fork application lists (open source) / tree fork preserves list element sequences including gaps;
- fork lane validation / ignores malformed unrelated lanes.

## HC-025 classification

HC-025 changes from `unverified` to `partial` in the published candidate assessment. The public Memory and JSONL streaming boundaries pass, but the requirement also names SQLite parity and host ownership. Upstream marks SQLite streaming-fork support as pending, and these in-process fixtures do not prove cross-process writable authority.

The installed 0.85.1 selected record remains unchanged. This evidence does not update package pins, admit raw Storage constructors, activate AgentHarness or import experimental Pico3.
