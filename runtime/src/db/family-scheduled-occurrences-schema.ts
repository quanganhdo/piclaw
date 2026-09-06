import type Database from "bun:sqlite";

/** Reservations are separate from runnable EF-S07 occurrences; tasks remain paused. */
export function initializeFamilyScheduledOccurrences(database: Database): void {
  database.exec(`CREATE TABLE IF NOT EXISTS family_scheduled_occurrences (
    id TEXT PRIMARY KEY,
    grant_id TEXT NOT NULL UNIQUE REFERENCES family_scheduled_grants(id),
    task_id TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    scheduled_for TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('claimed','consumed')),
    attempt INTEGER NOT NULL CHECK(attempt BETWEEN 1 AND 9007199254740991),
    version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991),
    worker_id TEXT NOT NULL,
    token_hash TEXT,
    first_claim_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    lease_expires_at INTEGER,
    allowed_tools TEXT NOT NULL,
    CHECK(updated_at>=first_claim_at),
    CHECK((state='claimed' AND token_hash IS NOT NULL AND lease_expires_at IS NOT NULL AND length(token_hash)=64 AND lease_expires_at>updated_at)
       OR (state='consumed' AND token_hash IS NULL AND lease_expires_at IS NULL))
  ) STRICT;
  CREATE TABLE IF NOT EXISTS family_scheduled_occurrence_events (
    occurrence_id TEXT NOT NULL REFERENCES family_scheduled_occurrences(id),
    version INTEGER NOT NULL,
    attempt INTEGER NOT NULL,
    worker_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('claim','reclaim','renew','consume')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY(occurrence_id,version)
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_occurrence_identity_immutable BEFORE UPDATE ON family_scheduled_occurrences
    WHEN NEW.id<>OLD.id OR NEW.grant_id<>OLD.grant_id OR NEW.task_id<>OLD.task_id OR NEW.owner_user_id<>OLD.owner_user_id
      OR NEW.scheduled_for<>OLD.scheduled_for OR NEW.first_claim_at<>OLD.first_claim_at
    BEGIN SELECT RAISE(ABORT,'Scheduled occurrence identity is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_occurrence_terminal BEFORE UPDATE ON family_scheduled_occurrences
    WHEN OLD.state='consumed'
    BEGIN SELECT RAISE(ABORT,'Scheduled occurrence is terminal'); END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_occurrence_transition BEFORE UPDATE ON family_scheduled_occurrences
    WHEN OLD.state='claimed' AND (NEW.version<>OLD.version+1 OR NEW.updated_at<OLD.updated_at
      OR NEW.attempt NOT IN (OLD.attempt,OLD.attempt+1)
      OR (NEW.attempt=OLD.attempt+1 AND (NEW.state<>'claimed' OR NEW.updated_at<OLD.lease_expires_at))
      OR (NEW.attempt=OLD.attempt AND (NEW.worker_id<>OLD.worker_id OR NEW.updated_at>=OLD.lease_expires_at))
      OR (NEW.state='claimed' AND (NEW.token_hash=OLD.token_hash OR NEW.lease_expires_at<>NEW.updated_at+60000)))
    BEGIN SELECT RAISE(ABORT,'Invalid scheduled occurrence transition'); END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_occurrence_tools_narrow BEFORE UPDATE OF allowed_tools ON family_scheduled_occurrences
    WHEN NOT json_valid(NEW.allowed_tools) OR json_type(NEW.allowed_tools)<>'array'
      OR EXISTS(SELECT 1 FROM json_each(NEW.allowed_tools) n WHERE n.type<>'text' OR n.value NOT IN (SELECT value FROM json_each(OLD.allowed_tools)))
      OR (SELECT count(*) FROM json_each(NEW.allowed_tools))<>(SELECT count(DISTINCT value) FROM json_each(NEW.allowed_tools))
    BEGIN SELECT RAISE(ABORT,'Scheduled occurrence tools cannot widen'); END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_occurrence_no_delete BEFORE DELETE ON family_scheduled_occurrences
    BEGIN SELECT RAISE(ABORT,'Scheduled occurrence history cannot be deleted'); END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_occurrence_event_immutable BEFORE UPDATE ON family_scheduled_occurrence_events
    BEGIN SELECT RAISE(ABORT,'Scheduled occurrence event is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS family_scheduled_occurrence_event_no_delete BEFORE DELETE ON family_scheduled_occurrence_events
    BEGIN SELECT RAISE(ABORT,'Scheduled occurrence event cannot be deleted'); END;`);
}
