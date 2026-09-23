# Earendil 0.87.1 text-line reader compatibility (#1378)

This slice supplies the public `ExecutionEnv.openTextLineReader` contract before
Piclaw updates its six coordinated Earendil package pins. The immutable 0.87.0
candidate manifest still records issue #1378 as blocked in that historical
run; this new 0.87.1 typecheck and test receipt does not rewrite it. The target
`@earendil-works/pi-agent-core@0.87.1` public declaration defines
`openTextLineReader(path, context): Promise<Result<TextLineReader, FileError>>`;
`readLine(context)` returns `{ text, terminated }` or `undefined` at EOF, and
`close(context)` is best effort and non-throwing. The inspected package is the
published 0.87.1 tarball, not the installed 0.85.1 runtime.

`PiclawExecutionEnv` captures a stable delegate method, copies line records,
normalises filesystem failures, checks abort/closed state around awaits and
closes owned readers before delegate cleanup. The current and fake resolver
inventories reject missing or changing methods. SSH factory forwarding requires
the remote delegate to expose a stable public method; tests use a fake route and
never contact live SSH.

The pinned 0.85.1 `NodeExecutionEnv` lacks the new method. Only the default local
Node factory receives a temporary pull-based compatibility reader. Injected
factories without the method fail closed. Once the coordinated 0.87.1 upgrade
lands, the default factory uses upstream's reader directly. This change does not
alter package pins or activate Harness/Pico3.

The local reader uses explicit byte offsets and streaming UTF-8 decoding, retains
CR before LF, reports a torn final record, checks abort before and after I/O,
and closes its file handle once. Fake readers use captured bytes and support the
same LF/CRLF/empty/torn contract. Neither adapter reads a whole SSH file as a
fallback.

Validation uses the isolated repository test launcher for local, SSH-fake,
current/fake resolver and hostile-adapter cases. A disposable package fixture
compiles the adapter as the published 0.87.1 `ExecutionEnv` public type. Default
tests make no provider call or live SSH connection. Historical 0.87.0 evidence
remains separately labelled; this note records 0.87.1-specific type evidence.
