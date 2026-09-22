# Deployment notebook

## Rollback
The parser rollback restores schema version 3 and replays the fixture journal.

## Rollback
The gateway rollback changes the upstream pool to amber and drains pending requests.

## Verification
Both rollbacks require a synthetic health probe before accepting traffic.
