import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { terminalOperation, terminalOutbox, terminalRequest, TERMINAL_HARNESS } from "../../src/service-effects/testing/contract-suites/terminal-settlement-store-contract.js";
import { FakeTerminalSettlementStore } from "../../src/service-effects/testing/fakes/fake-terminal-settlement-store.js";
import { openSqliteSubject } from "./terminal-settlement-test-support.js";

describe("EF-S02 concurrency crash and corruption hardening", () => {
  test("two connections terminalise one operation exactly once", async () => {
    const directory = mkdtempSync(join(tmpdir(), "piclaw-s02-race-"));
    const path = join(directory, "store.sqlite");
    const first = openSqliteSubject(path, [], true);
    const second = openSqliteSubject(path, [], false);
    try {
      first.seedOperation(terminalOperation());
      const [left, right] = await Promise.all([
        first.store.commitTerminal(terminalRequest({ key: "race-left" })),
        second.store.commitTerminal(terminalRequest({ key: "race-right" })),
      ]);
      expect(Number(left.ok) + Number(right.ok)).toBe(1);
      const loser = left.ok ? right : left;
      expect(loser.ok).toBeFalse();
      if (!loser.ok) {
        expect(loser.error._tag).toBe("already_terminal_conflict");
      }
      expect(first.inspectDurable().commitCount).toBe(1);
      expect(first.inspectDurable().messages).toHaveLength(1);
    } finally {
      second.dispose?.();
      first.dispose?.();
    }
  });

  test("valid competing disposition candidates converge to one terminal commit", async () => {
    const variants = [
      {
        operation: terminalOperation(),
        left: terminalRequest({ key: "candidate-completed" }),
        right: terminalRequest({
          key: "candidate-failed",
          disposition: "failed",
          errorCode: "HARNESS_FAILED",
        }),
      },
      {
        operation: terminalOperation({ phase: "claimed", harness: null }),
        left: terminalRequest({
          key: "candidate-skipped",
          disposition: "skipped",
          expectedHarness: null,
          mode: "none",
        }),
        right: terminalRequest({
          key: "candidate-superseded",
          disposition: "superseded",
          expectedHarness: null,
          mode: "none",
        }),
      },
    ] as const;
    for (const variant of variants) {
      const subject = openSqliteSubject(":memory:", [], false);
      try {
        subject.seedOperation(variant.operation);
        const [left, right] = await Promise.all([
          subject.store.commitTerminal(variant.left),
          subject.store.commitTerminal(variant.right),
        ]);
        expect(Number(left.ok) + Number(right.ok)).toBe(1);
        const loser = left.ok ? right : left;
        expect(loser.ok).toBeFalse();
        if (!loser.ok) {
          expect(loser.error._tag).toBe("already_terminal_conflict");
        }
        expect(subject.inspectDurable().commitCount).toBe(1);
      } finally {
        subject.dispose?.();
      }
    }
  });

  test("held writer lock is bounded and leaves no partial state", async () => {
    const directory = mkdtempSync(join(tmpdir(), "piclaw-s02-busy-"));
    const path = join(directory, "store.sqlite");
    const owner = openSqliteSubject(path, [], true);
    const contender = openSqliteSubject(path, [], false);
    try {
      owner.seedOperation(terminalOperation());
      contender.database.exec("PRAGMA busy_timeout=0");
      owner.database.exec("BEGIN IMMEDIATE");
      const blocked = await contender.store.commitTerminal(terminalRequest());
      expect(blocked.ok).toBeFalse();
      if (!blocked.ok) {
        expect(blocked.error._tag).toBe("storage_unavailable");
        expect(blocked.error.certainty).toBe("not_applied");
      }
      expect(contender.inspectDurable().commitCount).toBe(0);
      owner.database.exec("ROLLBACK");
    } finally {
      if (owner.database.inTransaction) owner.database.exec("ROLLBACK");
      contender.dispose?.();
      owner.dispose?.();
    }
  });

  test("earlier terminal decisions remain readable after a later operation advances the chat frontier", async () => {
    const subject = openSqliteSubject(":memory:", [], false);
    try {
      subject.seedOperation(terminalOperation());
      expect((await subject.store.commitTerminal(terminalRequest())).ok).toBeTrue();
      subject.database.transaction(() => {
        subject.database
          .prepare(
            `INSERT INTO service_effect_s01_sources(
               chat_jid,source_seq,source_id,source_hash,kind,state,payload_ref,
               target_operation_id,accepted_at,provenance_ref,create_wake_intent
             ) VALUES (?,?,?,?,?,'claimed',?,?,?,?,0)`,
          )
          .run(
            "web:terminal",
            2,
            "source-2",
            "c".repeat(64),
            "message",
            "payload:source-2",
            "operation-2",
            "2026-08-14T09:30:00.000Z",
            "opaque:source-2",
          );
        subject.database
          .prepare(
            `INSERT INTO service_effect_s01_operations(
               operation_id,chat_jid,version,phase,primary_source_seq,
               harness_session_id,harness_lane,harness_operation_id,harness_state,
               harness_watch_generation
             ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            "operation-2",
            "web:terminal",
            3,
            "settling",
            2,
            TERMINAL_HARNESS.sessionId,
            TERMINAL_HARNESS.lane,
            TERMINAL_HARNESS.harnessOperationId,
            TERMINAL_HARNESS.state,
            TERMINAL_HARNESS.watchGeneration,
          );
        subject.database
          .prepare(
            `INSERT INTO service_effect_s01_operation_sources(chat_jid,operation_id,source_seq)
             VALUES ('web:terminal','operation-2',2)`,
          )
          .run();
        subject.database
          .prepare(
            `UPDATE service_effect_s01_chats
             SET next_source_seq=3,active_operation_id='operation-2'
             WHERE chat_jid='web:terminal'`,
          )
          .run();
      }).immediate();
      expect(
        (
          await subject.store.commitTerminal(
            terminalRequest({
              key: "terminal-key-2",
              operationId: "operation-2",
              effectSourceSeq: 2,
              sourceDispositions: [
                { sourceSeq: 2, state: "consumed", reason: "terminal" },
              ],
            }),
          )
        ).ok,
      ).toBeTrue();
      const first = await subject.store.getTerminal("operation-1");
      const second = await subject.store.getTerminal("operation-2");
      expect(first.ok && first.value?.consumedThroughSourceSeq).toBe(1);
      expect(second.ok && second.value?.consumedThroughSourceSeq).toBe(2);
    } finally {
      subject.dispose?.();
    }
  });

  test("malformed operation and ledger rows return bounded corruption", async () => {
    const operation = openSqliteSubject(":memory:", [], false);
    try {
      operation.seedOperation(terminalOperation());
      operation.database.exec("PRAGMA ignore_check_constraints=ON");
      operation.database
        .query(
          "UPDATE service_effect_s01_operations SET phase='impossible' WHERE operation_id='operation-1'",
        )
        .run();
      const result = await operation.store.commitTerminal(terminalRequest());
      expect(result.ok).toBeFalse();
      if (!result.ok) expect(result.error._tag).toBe("corrupt_state");
    } finally {
      operation.dispose?.();
    }

    const ledger = openSqliteSubject(":memory:", [], false);
    try {
      ledger.seedOperation(terminalOperation());
      expect((await ledger.store.commitTerminal(terminalRequest())).ok).toBeTrue();
      ledger.database.exec("PRAGMA ignore_check_constraints=ON");
      ledger.database
        .query(
          "UPDATE service_effect_s02_commits SET committed_at='protected-invalid'",
        )
        .run();
      const read = await ledger.store.getTerminal("operation-1");
      expect(read.ok).toBeFalse();
      if (!read.ok) expect(read.error._tag).toBe("corrupt_state");
      expect(JSON.stringify(read)).not.toContain("protected-invalid");
    } finally {
      ledger.dispose?.();
    }
  });

  test("persisted scalar edge and ordinal corruption is rejected by public reads", async () => {
    const mutations = [
      "UPDATE service_effect_s02_commits SET idempotency_key=''",
      "UPDATE service_effect_s02_commits SET request_hash='bad'",
      "UPDATE service_effect_s02_commits SET operation_id='other'",
      "UPDATE service_effect_s02_commits SET chat_jid=''",
      "UPDATE service_effect_s02_commits SET operation_version=99",
      "UPDATE service_effect_s02_commits SET disposition='impossible'",
      "UPDATE service_effect_s02_commits SET message_row_id=999",
      "UPDATE service_effect_s02_commits SET consumed_through_source_seq=99",
      "UPDATE service_effect_s02_commits SET outbox_count=2",
      "UPDATE service_effect_s02_commits SET media_count=2",
      "UPDATE service_effect_s02_commits SET committed_at='invalid'",
      "UPDATE service_effect_s02_commits SET terminal_authority_present=1",
      "DELETE FROM service_effect_s02_commit_outbox",
      "UPDATE service_effect_s02_commit_outbox SET ordinal=2",
      "UPDATE service_effect_s05_outbox SET operation_id='other'",
      "UPDATE service_effect_s05_outbox SET idempotency_key=''",
      "UPDATE service_effect_s05_outbox SET request_hash='bad'",
      "UPDATE service_effect_s05_outbox SET source_seq=99",
      "UPDATE service_effect_s05_outbox SET enqueued_at='2026-08-14T11:00:00.000Z'",
      "UPDATE service_effect_s05_decisions SET outcome='empty'",
      "UPDATE service_effect_s05_decisions SET outbox_id='other'",
      "UPDATE messages SET chat_jid='web:other' WHERE is_terminal_agent_reply=1",
      "UPDATE messages SET is_terminal_agent_reply=0 WHERE is_terminal_agent_reply=1",
      "DELETE FROM message_media WHERE message_rowid=(SELECT message_row_id FROM service_effect_s02_commits)",
      "UPDATE service_effect_operation_media SET role='draft'",
      `INSERT INTO messages_fts(messages_fts,rowid,content,chat_jid,sender,sender_name,timestamp,is_bot_message)
       SELECT 'delete',rowid,content,chat_jid,sender,sender_name,timestamp,is_bot_message
       FROM messages WHERE is_terminal_agent_reply=1`,
      "UPDATE service_effect_s01_operations SET version=99",
      "UPDATE service_effect_s01_operations SET terminal_disposition='failed'",
      "UPDATE service_effect_s01_operations SET terminal_message_row_id=NULL",
      "UPDATE service_effect_s01_operations SET terminal_committed_at='2026-08-14T11:00:00.000Z'",
      "UPDATE service_effect_s01_sources SET state='claimed'",
      "UPDATE service_effect_s01_chats SET consumed_through_source_seq=0",
    ];
    for (const mutation of mutations) {
      const subject = openSqliteSubject(":memory:", [], false);
      try {
        subject.seedOperation(terminalOperation());
        subject.seedMedia("operation-1", 93);
        const committed = await subject.store.commitTerminal(
          terminalRequest({
            mediaIds: [93],
            outboxIntents: [terminalOutbox("corrupt-edge")],
          }),
        );
        expect(committed.ok).toBeTrue();
        subject.database.exec(
          "PRAGMA foreign_keys=OFF; PRAGMA ignore_check_constraints=ON",
        );
        subject.database.exec(mutation);
        const read = await subject.store.getTerminal("operation-1");
        expect(read.ok).toBeFalse();
        if (!read.ok) expect(read.error._tag).toBe("corrupt_state");
      } finally {
        subject.dispose?.();
      }
    }
  });

  test("queue replay ownership and duplicate commit links are corruption-safe", async () => {
    const queue = openSqliteSubject(":memory:", [], false);
    try {
      queue.seedOperation(
        terminalOperation({
          sources: [
            {
              sourceSeq: 1,
              state: "claimed",
              operationId: "operation-1",
              queuedState: "accepted",
            },
          ],
        }),
      );
      expect((await queue.store.commitTerminal(terminalRequest())).ok).toBeTrue();
      queue.database
        .prepare("UPDATE service_effect_s01_queued_inputs SET state='accepted'")
        .run();
      const read = await queue.store.getTerminal("operation-1");
      expect(read.ok).toBeFalse();
      if (!read.ok) expect(read.error._tag).toBe("corrupt_state");
    } finally {
      queue.dispose?.();
    }

    const links = openSqliteSubject(":memory:", [], false);
    try {
      links.seedOperation(terminalOperation());
      expect(
        (
          await links.store.commitTerminal(
            terminalRequest({ outboxIntents: [terminalOutbox("one-link")] }),
          )
        ).ok,
      ).toBeTrue();
      expect(() =>
        links.database
          .prepare(
            `INSERT INTO service_effect_s02_commit_outbox(operation_id,ordinal,outbox_id)
             VALUES ('operation-1',1,'one-link')`,
          )
          .run(),
      ).toThrow();
    } finally {
      links.dispose?.();
    }
  });

  test("malformed fake snapshots fail public reads and replay with SQLite-parity corruption", async () => {
    const original = new FakeTerminalSettlementStore();
    original.seedOperation(terminalOperation());
    original.seedMedia("operation-1", 91);
    const request = terminalRequest({
      mediaIds: [91],
      outboxIntents: [
        terminalOutbox("fake-corrupt-a"),
        terminalOutbox("fake-corrupt-b"),
      ],
    });
    expect((await original.commitTerminal(request)).ok).toBeTrue();
    type Snapshot = ReturnType<FakeTerminalSettlementStore["snapshot"]>;
    const mutations: Array<(snapshot: Snapshot) => void> = [
      (snapshot) =>
        Reflect.set(snapshot.operations[0]!.harness!, "watchGeneration", "bad"),
      (snapshot) => Reflect.set(snapshot.sources[0]!, "sourceSeq", 2),
      (snapshot) => Reflect.set(snapshot.sources[0]!, "queuedState", "accepted"),
      (snapshot) => Reflect.set(snapshot.messages[0]!, "terminal", false),
      (snapshot) => snapshot.messages[0]!.mediaIds.splice(0, 1),
      (snapshot) => Reflect.set(snapshot.media[0]!, "role", "draft"),
      (snapshot) => Reflect.set(snapshot.outbox[0]!, "operationId", "other"),
      (snapshot) => snapshot.decisions[0]!.linkedOutboxIds.reverse(),
      (snapshot) =>
        Reflect.set(snapshot.decisions[0]!, "terminalAuthorityPresent", true),
      (snapshot) => Reflect.set(snapshot.decisions[0]!, "requestHash", "bad"),
      (snapshot) =>
        Reflect.set(snapshot.decisions[0]!.commit, "operationVersion", 99),
      (snapshot) =>
        Reflect.set(snapshot.decisions[0]!.commit, "consumedThroughSourceSeq", 2),
      (snapshot) =>
        Reflect.set(snapshot.decisions[0]!.commit, "committedAt", "invalid"),
    ];
    for (const mutate of mutations) {
      const snapshot = original.snapshot();
      mutate(snapshot);
      const restored = new FakeTerminalSettlementStore();
      restored.restore(snapshot);
      const results = await Promise.all([
        restored.getTerminal("operation-1"),
        restored.getTerminalByKey("terminal-key-1"),
        restored.commitTerminal(request),
      ]);
      for (const result of results) {
        expect(result.ok).toBeFalse();
        if (!result.ok) expect(result.error._tag).toBe("corrupt_state");
      }
    }
  });
});
