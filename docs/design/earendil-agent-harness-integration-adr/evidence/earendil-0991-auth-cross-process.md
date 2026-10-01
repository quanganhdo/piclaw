# Cross-process credential ownership on Earendil 0.99.1 (#1458)

Independent public `ModelRuntime` consumers share one disposable Piclaw `FileCredentialStore` without double-rotating an OAuth refresh token. Synthetic fixtures also cover logout after refresh, failed refresh followed by a successor, and stale-lock recovery after killing a pre-write refresh holder. This is partial AUTH-04/08 evidence; it does not qualify mid-write crash durability.

## Process and storage boundary

Each child has its own HOME, agent directory and models store, a minimal offline environment and no inherited account credentials. Only an explicitly supplied temporary auth file is shared. Children register a typed synthetic provider through the public root SDK and await offline refresh before admission. Streaming methods and network fetch/preconnect throw if invoked. IPC carries event/command names only; children verify their synthetic request auth locally.

The app-owned store subclass observes public read/delete entry after delegation has started. A rejection fence is written only after the real store's `modify()` has rejected and released its lock; the contender's refresh callback requires that fence. The runtime and lock implementation are not monkeypatched and no private SDK import or credential-store member is used.

| Case | Assertions |
|---|---|
| Concurrent rotation | Two children resolve the same rotated auth; exactly one provider refresh; one authoritative rotated credential persists |
| Logout after held refresh | A contender enters deletion while refresh is held; after release, logout finishes last and the target credential is absent |
| Rejection then successor | First refresh rejects with OAuth/invalid_grant; only after lock release can the contender rotate; no old snapshot is restored |
| Pre-write holder crash | Kill only the owned holder inside provider refresh; assert SIGKILL, unchanged auth bytes and leftover lock; wait 35 real seconds; a fresh child reclaims the stale lock and rotates |

Every case preserves an unrelated credential and checks the exact final provider-ID set. Parent cleanup waits for owned child exit before deleting temporary data. Worker operations have hard timeouts; the slow holder-crash case is explicitly opt-in.

## Validation

The four scenarios passed 35 parent assertions plus child assertions. Strict fixture typechecking and scoped lint passed. Review strengthened entry barriers, rejection ordering, final store cardinality and exact termination-signal checks; final scoped review found no remaining blocker. The post-merge fast/lifecycle set passed nine tests and 42 assertions, with the slow case skipped by default; its separate opt-in execution passed all four scenarios and 35 assertions. At merged baseline `7ed2e718718ffef61bb7d2d0812b8abadd627aa4`, `make ci-fast` passed 5,954 runtime tests with eight skips and no failures, plus 25 feature tests and nine web checks. Seven skips are existing; the eighth is the documented opt-in crash case. Pack hygiene passed 24,741 files; final five typechecks and diff checks passed with the unchanged 95-diagnostic compose baseline. An initial static guard rejected an empty cleanup catch; the fixture was corrected to propagate errors while cleaning its workspace, and the guard/full gate passed without exclusions or relaxed limits. Private Bun caches were used.

```sh
bun run test:local --cwd runtime -- bun test test/agent-control/provider-auth-cross-process.test.ts
bun run test:local --cwd runtime --env PICLAW_RUN_AUTH_CRASH_TESTS=1 -- bun test --timeout 70000 test/agent-control/provider-auth-cross-process.test.ts
```

The ordinary run excludes the slow case; that skip is not new crash evidence. The recorded slow execution uses the unchanged 30-second store stale-lock threshold and real time, without fake clocks or altered lock options.

## Durability still unqualified

The crash case kills a provider refresh before the credential write begins. Piclaw's current `writeFileSync` credential overwrite is not an atomic file-replacement protocol; a process loss during that write can truncate/corrupt the file. No receipt here certifies that boundary. It also does not establish live refresh-token recovery, restoring superseded OAuth snapshots, external identity revocation, independent-process model-config transactions or Delegate credential propagation. Legacy secrets/backups, full CLI/device/browser coverage and approved live canaries remain open. No live account, inference, deployment or restart was used.
