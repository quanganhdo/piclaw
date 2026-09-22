# Decisions

## Lantern storage
Lantern stores event receipts in SQLite. PostgreSQL was rejected for its offline-only deployment.
The storage decision was accepted on 2030-02-08 by the fictional design group.

## Lantern retention
Lantern retains diagnostic receipts for fourteen days. Backups retain receipts for thirty days.
