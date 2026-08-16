import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { installServiceOutboxSchema } from "../../src/service-effects/current-piclaw/service-outbox-schema.js";
import { installServiceWorkSchema } from "../../src/service-effects/current-piclaw/service-work-schema.js";
import { installTerminalSettlementCompositionSchema } from "../../src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { createCurrentPiclawTerminalSettlementStore } from "../../src/service-effects/current-piclaw/terminal-settlement-store.js";
import { installTimelineMediaAdapterTestSchema } from "../../src/service-effects/current-piclaw/timeline-media-test-schema.js";
import { Payloads, Runtime } from "./terminal-settlement-test-support.js";

describe("EF-S02 composition schema and construction hardening", () => {
  test("installer composes inside one caller transaction and is idempotent", () => {
    const database = new Database(":memory:", { strict: true });
    database.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
    installTerminalSettlementCompositionSchema(database);
    expect(
      (
        database
          .query(
            "SELECT count(*) n FROM sqlite_master WHERE name LIKE 'service_effect_s02_%'",
          )
          .get() as { n: number }
      ).n,
    ).toBeGreaterThan(0);
    database.exec("ROLLBACK");
    expect(
      (
        database
          .query(
            "SELECT count(*) n FROM sqlite_master WHERE name LIKE 'service_effect_%'",
          )
          .get() as { n: number }
      ).n,
    ).toBe(0);
    installTerminalSettlementCompositionSchema(database);
    installTerminalSettlementCompositionSchema(database);
    expect(
      (
        database
          .query(
            "SELECT count(*) n FROM sqlite_master WHERE type='table' AND name LIKE 'service_effect_s02_%'",
          )
          .get() as { n: number }
      ).n,
    ).toBe(2);
    database.close();
  });

  test("installer rolls back every prerequisite and S02 object boundary", () => {
    const boundaries = [
      "service_work",
      "timeline_media",
      "service_outbox",
      "s02_commits",
      "s02_commit_outbox",
      "s02_commit_chat_index",
    ] as const;
    for (const expected of boundaries) {
      const database = new Database(":memory:", { strict: true });
      database.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
      expect(() =>
        installTerminalSettlementCompositionSchema(database, {
          afterBoundary(boundary) {
            if (boundary === expected) throw new Error(`stop:${boundary}`);
          },
        }),
      ).toThrow(`stop:${expected}`);
      expect(database.inTransaction).toBeTrue();
      database.exec("ROLLBACK");
      expect(
        (
          database
            .query(
              "SELECT count(*) n FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
            )
            .get() as { n: number }
        ).n,
      ).toBe(0);
      database.close();
    }
  });

  test("standalone transaction commit and rollback plus pre-created prerequisites compose", () => {
    const committed = new Database(":memory:", { strict: true });
    committed.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
    installTerminalSettlementCompositionSchema(committed);
    committed.exec("COMMIT");
    expect(
      createCurrentPiclawTerminalSettlementStore(
        committed,
        new Payloads(),
        new Runtime(),
      ).ok,
    ).toBeTrue();
    committed.close();

    const precreated = new Database(":memory:", { strict: true });
    precreated.exec("PRAGMA foreign_keys=ON");
    installServiceWorkSchema(precreated);
    installTimelineMediaAdapterTestSchema(precreated);
    installServiceOutboxSchema(precreated);
    installTerminalSettlementCompositionSchema(precreated);
    expect(
      createCurrentPiclawTerminalSettlementStore(
        precreated,
        new Payloads(),
        new Runtime(),
      ).ok,
    ).toBeTrue();
    precreated.close();
  });

  test("FTS object collision aborts without leaking prerequisite objects", () => {
    const database = new Database(":memory:", { strict: true });
    database.exec("PRAGMA foreign_keys=ON; CREATE TABLE messages_fts(x TEXT)");
    expect(() => installTerminalSettlementCompositionSchema(database)).toThrow();
    expect(
      (
        database
          .query(
            "SELECT count(*) n FROM sqlite_master WHERE name LIKE 'service_effect_%'",
          )
          .get() as { n: number }
      ).n,
    ).toBe(0);
    expect(
      (
        database
          .query("SELECT count(*) n FROM pragma_table_info('messages_fts')")
          .get() as { n: number }
      ).n,
    ).toBe(1);
    database.close();
  });

  test("factory rejects missing disabled incomplete and incompatible schemas", () => {
    const payloads = new Payloads();
    const runtime = new Runtime();
    const missing = new Database(":memory:", { strict: true });
    expect(
      createCurrentPiclawTerminalSettlementStore(missing, payloads, runtime).ok,
    ).toBeFalse();
    missing.close();

    const disabled = new Database(":memory:", { strict: true });
    installTerminalSettlementCompositionSchema(disabled);
    disabled.exec("PRAGMA foreign_keys=OFF");
    expect(
      createCurrentPiclawTerminalSettlementStore(disabled, payloads, runtime).ok,
    ).toBeFalse();
    disabled.close();

    const incomplete = new Database(":memory:", { strict: true });
    installTerminalSettlementCompositionSchema(incomplete);
    incomplete.exec("DROP TRIGGER messages_ai");
    expect(
      createCurrentPiclawTerminalSettlementStore(incomplete, payloads, runtime)
        .ok,
    ).toBeFalse();
    incomplete.close();

    const incompatible = new Database(":memory:", { strict: true });
    installTerminalSettlementCompositionSchema(incompatible);
    incompatible.exec(`
      PRAGMA foreign_keys=OFF;
      DROP TABLE service_effect_s02_commit_outbox;
      DROP TABLE service_effect_s02_commits;
      CREATE TABLE service_effect_s02_commits(idempotency_key TEXT PRIMARY KEY);
      CREATE TABLE service_effect_s02_commit_outbox(operation_id TEXT PRIMARY KEY);
      PRAGMA foreign_keys=ON;
    `);
    expect(
      createCurrentPiclawTerminalSettlementStore(incompatible, payloads, runtime)
        .ok,
    ).toBeFalse();
    incompatible.close();
  });

  test("factory rejects each required table index and trigger when absent", () => {
    const required = {
      table: [
        "chats",
        "media",
        "message_media",
        "messages",
        "messages_fts",
        "service_effect_media_deletions",
        "service_effect_media_upload_history",
        "service_effect_media_uploads",
        "service_effect_operation_media",
        "service_effect_outbox_media_refs",
        "service_effect_s01_chats",
        "service_effect_s01_decisions",
        "service_effect_s01_intents",
        "service_effect_s01_operation_sources",
        "service_effect_s01_operations",
        "service_effect_s01_queued_inputs",
        "service_effect_s01_sources",
        "service_effect_s01_wake_intents",
        "service_effect_s02_commit_outbox",
        "service_effect_s02_commits",
        "service_effect_s05_decisions",
        "service_effect_s05_leases",
        "service_effect_s05_outbox",
        "service_effect_s05_outcomes",
        "service_effect_s05_resolutions",
        "service_effect_timeline_writes",
      ],
      index: [
        "service_effect_draft_revision",
        "service_effect_notice_source",
        "service_effect_operation_media_id",
        "service_effect_outbox_media_id",
        "service_effect_s01_one_active_operation",
        "service_effect_s01_open_operations",
        "service_effect_s01_pending_sources",
        "service_effect_s02_commit_chat",
        "service_effect_s05_decision_outbox",
        "service_effect_s05_expired_started",
        "service_effect_s05_failed_claim",
        "service_effect_s05_lease_outbox",
        "service_effect_s05_operation_lookup",
        "service_effect_s05_pending_claim",
        "service_effect_s05_terminal_cleanup",
        "service_effect_s05_unknown_list",
        "service_effect_timeline_operation",
      ],
      trigger: ["messages_ad", "messages_ai", "messages_au"],
    } as const;
    for (const [type, names] of Object.entries(required)) {
      for (const name of names) {
        const database = new Database(":memory:", { strict: true });
        installTerminalSettlementCompositionSchema(database);
        database.exec("PRAGMA foreign_keys=OFF");
        database.exec(`DROP ${type.toUpperCase()} ${name}`);
        database.exec("PRAGMA foreign_keys=ON");
        expect(
          createCurrentPiclawTerminalSettlementStore(
            database,
            new Payloads(),
            new Runtime(),
          ).ok,
        ).toBeFalse();
        database.close();
      }
    }
  });
});
