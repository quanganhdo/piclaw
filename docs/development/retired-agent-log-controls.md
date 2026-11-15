# Retired agent-log controls

The obsolete agent-log configuration getter, retention env aliases and their parser are removed under #1279. The run-summary/logging producer and its process-global age-pruning timer were already deleted under #1673. No new timer or cleanup owner replaces them, and no historical log file is touched.

## Usage decision

Implementation base: `36610b74f1b5e3244325130270b290ab4eb437a8`.

Tracked source/package/registration/configuration and approved ad7 add-on inventories find no current consumer of `AGENT_LOG_CONFIG` or `getAgentLogConfig`; remaining callers were tests of the retired controls. The config module itself still has real callers for logging level and Pushover. Those settings remain supported.

Removed surfaces:

- `AGENT_LOG_CONFIG` projection and `getAgentLogConfig` export/getter;
- exclusive `AgentLogConfig`/retention DTO declarations and positive-integer env parser;
- env registrations and dotenv admission for `PICLAW_AGENT_LOG_RETENTION_MS`, `PICLAW_AGENT_LOG_RETENTION_DAYS` and `PICLAW_AGENT_LOG_CLEANUP_INTERVAL_MS`;
- redundant logging-level object projection after the domain now resolves only its active level field.

The existing logging domain's **`retiredKeys`** mechanism preserves the known historical JSON keys `retentionMs` and `cleanupIntervalMs` without resolving values or accepting new writes to them. It is an existing compatibility rule, not a new config framework or null-valued dummy setting. Even old values formerly hidden by an env override cannot block startup. Unknown unrelated keys still fail. Active logging-level writes preserve the historical values in the raw JSON block. No read or retirement rewrites the original config file.

The retained compatibility names are consumed by `readDomainConfig`'s strict historical-key check; their deletion requires an explicit configuration migration ending that historical format. This source work authorises no live migration. The env support catalog keeps historical defaults/provenance but marks the three aliases removed; generated observations are refreshed without changing scanner roots, direct-reader baselines or rules.

## Reduction and surviving owners

Two obsolete runtime functions (getter/parser)→0, unused agent-log projection1→0, redundant logging-level projection1→0, env registrations3→0 and dotenv admission entries3→0. The active `getLoggingConfig`, configured log-level fallback and Pushover owners remain. Tool-output retention/configuration and its actual cleanup timer remain separate and unchanged.

Stable #1270 source metric: **144,538→144,517 physical**, **134,134→134,115 nonblank**, **712files unchanged**: **−21physical/−19nonblank**,5added/26deleted production lines across two files. No relocated/replacement implementation or production additions outside the roots. Supporting type/test/catalog/doc changes supply no independent reduction credit. The [machine receipt](receipts/retired-agent-log-controls-1279.json) records the exact scope.

The prior producer/timer deletion receives no duplicate credit. Pre-shutdown unregister/owner disposal, interop ownership fencing and provider-listener teardown remain separate #1279 work. Necessary net-positive safety repairs must be measured and identified separately from this deletion.

## Evidence

The defining original case fails while the runtime getter/env aliases remain. Final owned-subprocess fixtures cover normal and formerly env-shadowed historical values, absent exports/aliases/dotenv readers, actual registered schema/retired names, preserved log level/frozen getter, original config bytes, no secret-shaped diagnostic echo, rejected writes to retired keys, unrelated active writes preserving historical values, and unchanged unknown-key refusal.

Mixed tests retire only obsolete agent-log expectations. Active tool-output cap/default/strict-integer/cleanup assertions remain unchanged. The restart/precedence fixture now verifies the surviving log level with all existing agent-budget compatibility-warning assertions retained. Its first `error` log-level choice suppressed those warnings by design; the corrected `debug` fixture keeps exact warning assertions. A new typo-message fixture initially omitted “persisted”; its corrected expectation pins the exact existing error rather than weakening the guard. Both failed receipts remain.

Focused evidence:13cases/60assertions (new retirement and config modules),2/22 (core restart/retention),2/10 (tool-output config),2/12 (logging-level defaults/precedence). All three source type projects and strict new fixture types pass; actual native default-factory events1/182, circular graph546/0cycles and scoped package checks pass. General import checks remain25pre-existing findings, byte-identical to fc587 and **not green**. No scanner/import/assertion/timeout guard is relaxed.

## Rollback

Reverting restores only inactive controls; historical log files and JSON bytes remain. No database/schema/history/credential operation, retention schedule, installation, restart, backup/restore promotion or branch/worktree cleanup is part of this source-only slice. Automatic repository CI, author review, authorised merge and exact merged-head revalidation are required before acceptance. This partial slice does not complete #1279 or #1270.
