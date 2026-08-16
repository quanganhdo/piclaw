import { describe, expect, test } from "bun:test";
import { terminalOperation, terminalOutbox, terminalRequest, type TerminalSettlementContractSubject } from "../../src/service-effects/testing/contract-suites/terminal-settlement-store-contract.js";
import { FakeTerminalSettlementStore } from "../../src/service-effects/testing/fakes/fake-terminal-settlement-store.js";
import { context, fakeFactory, fakeSubject, openSqliteSubject, sqliteFactory } from "./terminal-settlement-test-support.js";

describe("EF-S02 exhaustive statement rollback coverage", () => {
  const shapes = [
    {
      name: "insert-media-outbox",
      expected: [
        "timeline_chat_insert",
        "timeline_message_insert",
        "timeline_media_link",
        "timeline_media_link",
        "timeline_fts_media_delete",
        "timeline_fts_media_insert",
        "settle_source",
        "terminalise_operation",
        "advance_frontier_release_owner",
        "outbox_insert",
        "outbox_decision_insert",
        "outbox_insert",
        "outbox_decision_insert",
        "insert_commit",
        "link_commit_outbox",
        "link_commit_outbox",
      ],
      setup(subject: TerminalSettlementContractSubject) {
        subject.seedOperation(terminalOperation());
        subject.seedMedia("operation-1", 81);
        subject.seedMedia("operation-1", 82);
        return terminalRequest({
          mediaIds: [81, 82],
          outboxIntents: [terminalOutbox("rollback-a"), terminalOutbox("rollback-b")],
        });
      },
    },
    {
      name: "insert-single-media",
      expected: [
        "timeline_chat_insert",
        "timeline_message_insert",
        "timeline_media_link",
        "timeline_fts_media_delete",
        "timeline_fts_media_insert",
        "settle_source",
        "terminalise_operation",
        "advance_frontier_release_owner",
        "insert_commit",
      ],
      setup(subject: TerminalSettlementContractSubject) {
        subject.seedOperation(terminalOperation());
        subject.seedMedia("operation-1", 83);
        return terminalRequest({ mediaIds: [83] });
      },
    },
    {
      name: "replace-multiple-sources",
      expected: [
        "timeline_placeholder_fence",
        "timeline_fts_media_delete",
        "timeline_fts_media_insert",
        "timeline_message_replace",
        "timeline_media_unlink",
        "settle_source",
        "settle_source",
        "settle_queued_input",
        "terminalise_operation",
        "advance_frontier_release_owner",
        "insert_commit",
      ],
      setup(subject: TerminalSettlementContractSubject) {
        subject.seedOperation(
          terminalOperation({
            primarySourceSeq: 1,
            sources: [
              { sourceSeq: 1, state: "claimed", operationId: "operation-1" },
              {
                sourceSeq: 2,
                state: "queued",
                kind: "follow_up",
                operationId: "operation-1",
                queuedState: "queued",
              },
            ],
          }),
        );
        subject.seedMedia("operation-1", 79, "draft");
        subject.seedDraft({
          operationId: "operation-1",
          rowId: 40,
          revision: 1,
          chatJid: "web:terminal",
          threadId: null,
          contentRef: "payload:draft",
          mediaIds: [79],
        });
        return terminalRequest({
          mode: "replace_placeholder",
          placeholderRowId: 40,
          sourceDispositions: [
            { sourceSeq: 1, state: "consumed", reason: "primary" },
            { sourceSeq: 2, state: "disposed", reason: "follow-up" },
          ],
        });
      },
    },
    {
      name: "replace-multiple-new-media-one-outbox",
      expected: [
        "timeline_placeholder_fence",
        "timeline_message_replace",
        "timeline_media_unlink",
        "timeline_media_link",
        "timeline_media_link",
        "timeline_fts_media_delete",
        "timeline_fts_media_insert",
        "settle_source",
        "terminalise_operation",
        "advance_frontier_release_owner",
        "outbox_insert",
        "outbox_decision_insert",
        "insert_commit",
        "link_commit_outbox",
      ],
      setup(subject: TerminalSettlementContractSubject) {
        subject.seedOperation(terminalOperation());
        subject.seedMedia("operation-1", 84);
        subject.seedMedia("operation-1", 85);
        subject.seedDraft({
          operationId: "operation-1",
          rowId: 40,
          revision: 1,
          chatJid: "web:terminal",
          threadId: null,
          contentRef: "payload:draft",
        });
        return terminalRequest({
          mode: "replace_placeholder",
          placeholderRowId: 40,
          mediaIds: [84, 85],
          outboxIntents: [terminalOutbox("replace-one")],
        });
      },
    },
    {
      name: "insert-existing-chat",
      expected: [
        "timeline_chat_insert",
        "timeline_chat_update",
        "timeline_message_insert",
        "settle_source",
        "terminalise_operation",
        "advance_frontier_release_owner",
        "insert_commit",
      ],
      setup(subject: TerminalSettlementContractSubject) {
        subject.seedOperation(terminalOperation());
        subject.seedDraft({
          operationId: "operation-1",
          rowId: 39,
          revision: 1,
          chatJid: "web:terminal",
          threadId: null,
          contentRef: "payload:draft",
        });
        return terminalRequest();
      },
    },
    {
      name: "no-timeline",
      expected: [
        "settle_source",
        "terminalise_operation",
        "advance_frontier_release_owner",
        "insert_commit",
      ],
      setup(subject: TerminalSettlementContractSubject) {
        subject.seedOperation(terminalOperation());
        return terminalRequest({ mode: "none" });
      },
    },
    {
      name: "no-timeline-queue-outbox",
      expected: [
        "settle_source",
        "settle_source",
        "settle_queued_input",
        "terminalise_operation",
        "advance_frontier_release_owner",
        "outbox_insert",
        "outbox_decision_insert",
        "insert_commit",
        "link_commit_outbox",
      ],
      setup(subject: TerminalSettlementContractSubject) {
        subject.seedOperation(
          terminalOperation({
            sources: [
              { sourceSeq: 1, state: "claimed", operationId: "operation-1" },
              {
                sourceSeq: 2,
                state: "queued",
                kind: "continuation",
                operationId: "operation-1",
                queuedState: "queued",
              },
            ],
          }),
        );
        return terminalRequest({
          mode: "none",
          sourceDispositions: [
            { sourceSeq: 1, state: "consumed", reason: "primary" },
            { sourceSeq: 2, state: "disposed", reason: "terminal" },
          ],
          outboxIntents: [terminalOutbox("none-one")],
        });
      },
    },
  ] as const;

  for (const factory of [sqliteFactory, fakeFactory]) {
    for (const shape of shapes) {
      test(`${factory.name} ${shape.name} rolls back after every executed statement`, async () => {
        const subject = await factory.create(context());
        try {
          const request = shape.setup(subject);
          const baseline = JSON.stringify(subject.inspectDurable());
          let occurrence = 1;
          for (; occurrence <= 100; occurrence += 1) {
            subject.planStatementFault(occurrence);
            const result = await subject.store.commitTerminal(request);
            if (result.ok) break;
            expect(result.error._tag).toBe("storage_unavailable");
            expect(result.error.certainty).toBe("not_applied");
            expect(JSON.stringify(subject.inspectDurable())).toBe(baseline);
          }
          expect(occurrence).toBeGreaterThan(1);
          expect(occurrence).toBeLessThanOrEqual(100);
          const executed = subject.inspectStatements();
          expect(executed).toHaveLength(occurrence - 1);
          expect(
            executed.every((entry, index) => entry.startsWith(`${index + 1}:`)),
          ).toBeTrue();
        } finally {
          await subject.dispose?.();
        }
      });
    }
  }

  test("fake and SQLite expose identical named statement sequences", async () => {
  for (const shape of shapes) {
    const sqlite = openSqliteSubject(":memory:", [], false);
    const fake = fakeSubject(new FakeTerminalSettlementStore());
    try {
      const sqliteRequest = shape.setup(sqlite);
      const fakeRequest = shape.setup(fake);
      const [sqliteResult, fakeResult] = await Promise.all([
        sqlite.store.commitTerminal(sqliteRequest),
        fake.store.commitTerminal(fakeRequest),
      ]);
      expect(sqliteResult.ok).toBeTrue();
      expect(fakeResult.ok).toBeTrue();
      const expected = shape.expected.map(
        (statement, index) => `${index + 1}:${statement}`,
      );
      expect(sqlite.inspectStatements()).toEqual(expected);
      expect(fake.inspectStatements()).toEqual(expected);
    } finally {
      sqlite.dispose?.();
      fake.dispose?.();
    }
  }
  });
});
