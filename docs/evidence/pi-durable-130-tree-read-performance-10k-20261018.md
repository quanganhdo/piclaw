# Durable tree reader: 10,000 synthetic entries

The existing public SDK SQLite → HostConversationRuntime → durable adapter →
AgentRuntimeFacade harness passed 60,042 assertions at source head b9deecbfb.
Every node's identity, ancestry, role/content and child count matched the golden
history; warm and reopened snapshots matched, with thinking content redacted.

| Measurement | Milliseconds |
|---|---:|
| Warm tree median, five reads | 26.223 |
| Slowest warm tree read | 32.417 |
| First tree read after reopen | 26.105 |
| Runtime reopen plus first read | 27.463 |
| Warm context-metadata median | 0.078 |

One disposable SQLite database with WAL/SHM siblings was removed after the run.
Network access was forbidden; model, credential and effect counters stayed zero.
Source fingerprints matched before/after; worktree was clean. Independent bounded
review accepted the harness and numbers. Raw evidence:
`/workspace/reviews/durable-1650/tree-read-performance-10k.{ts,json,md,log}`.

The history is synthetic, linear and native. This extends the earlier
[100–2,000-entry measurements](pi-durable-130-tree-read-performance-20261017.md).
It does not exercise the default application factory, imported/forked/compacted or
multimodal history, concurrent load, providers, or production chats. Five samples
provide a descriptive maximum, not a reliable tail estimate. Reopen preserves OS
page cache; RSS snapshots include imports/appends/validation and are not peak or
reader-only allocation. HC-024/HC-025 and the 45 requirement statuses are unchanged.
