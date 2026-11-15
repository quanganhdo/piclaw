# Access modes

Only `single-user` can start. `family-shared` and its account, invitation, browser and migration APIs have been removed. `isolated-containers` configuration is reserved and cannot start.

Set `domains.access.mode` in `.piclaw/config.json`; missing mode defaults to single-user. There is no environment override or top-level `access` alias. Invalid configuration, unknown store markers, prepared migration copies and configuration/store mismatches fail closed before add-ons, workers or listeners.

Removal does not delete historical database tables, ownership records, native sources, operations or migration receipts. Never edit an activation marker to force a store to start. Preserve configuration, SQLite, session files and bootstrap keys together. See [runtime locks](runtime-lock.md) for crash recovery.

Single-user TOTP and Settings passkey management remain available. Authentication maintenance removes expired web sessions and legacy pending WebAuthn enrolments only. Scheduled work retains its server-owned dispatch identity and native recovery requirements.
