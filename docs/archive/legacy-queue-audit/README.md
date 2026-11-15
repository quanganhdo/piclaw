# Historical SDK queue replay audit

These text copies preserve the retired audit program and shell wrapper byte-for-byte. Their executable entry points under `scripts/` are removed by #1675. The audit model used legacy SDK queue injection, content-based removal and immediate resubmission of unaccepted queued rows. Native input uses host-accepted immutable sources and intents.

| Former executable | Preserved source | Git content hash |
|---|---|---|
| `scripts/audit-queue-session-threading-replay.ts` | `audit-queue-session-threading-replay.ts.txt` | `a112b553965307bd0f39387359a2a2d6fdba17f2` |
| `scripts/audit-queue-session-threading-replay.sh` | `audit-queue-session-threading-replay.sh.txt` | `de1db3f962a23e72987d03d1053c523f7f76917a` |

The copies are non-executable historical evidence. Existing audit reports and operational data are unchanged. They supply no current validation or native execution contract. The general session-turn audit remains separate.

Use focused tests for native queue boundaries, startup steering, queue-state HTTP behaviour, source attachment/withdrawal and accepted-intent recovery. See [native queue ownership](../../development/native-queue-boundaries.md). Do not run historical broad audit scripts during the frozen issue campaign.
