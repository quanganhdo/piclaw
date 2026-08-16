import { describe, expect, test } from "bun:test";
import { terminalOperation, terminalOutbox, terminalRequest, TERMINAL_HARNESS } from "../../src/service-effects/testing/contract-suites/terminal-settlement-store-contract.js";
import type { FakeTerminalOperationSeed } from "../../src/service-effects/testing/fakes/fake-terminal-settlement-store.js";
import { context, fakeFactory, openSqliteSubject, sqliteFactory } from "./terminal-settlement-test-support.js";

describe("EF-S02 authority matrix and composed state", () => {
  test("all five dispositions close only their authorised phase", async () => {
    const subject = openSqliteSubject(":memory:", [], false);
    const variants = [
      {
        disposition: "completed" as const,
        phase: "settling" as const,
        cancellation: null,
        harness: TERMINAL_HARNESS,
      },
      {
        disposition: "cancelled" as const,
        phase: "cancelling" as const,
        cancellation: 1,
        harness: TERMINAL_HARNESS,
      },
      {
        disposition: "failed" as const,
        phase: "executing" as const,
        cancellation: null,
        harness: { ...TERMINAL_HARNESS, state: "running" as const },
      },
      {
        disposition: "skipped" as const,
        phase: "claimed" as const,
        cancellation: null,
        harness: null,
      },
      {
        disposition: "superseded" as const,
        phase: "suspended" as const,
        cancellation: null,
        harness: { ...TERMINAL_HARNESS, state: "suspended" as const },
      },
    ];
    try {
      for (const [index, variant] of variants.entries()) {
        const operationId = `matrix-operation-${index}`;
        const chatJid = `web:matrix-${index}`;
        subject.seedOperation(
          terminalOperation({
            operationId,
            chatJid,
            phase: variant.phase,
            cancellationSourceSeq: variant.cancellation,
            harness: variant.harness,
            activeOperationId: operationId,
            sources: [
              {
                sourceSeq: 1,
                state: "claimed",
                operationId,
              },
            ],
          }),
        );
        const result = await subject.store.commitTerminal(
          terminalRequest({
            key: `matrix-key-${index}`,
            operationId,
            chatJid,
            expectedHarness: variant.harness,
            disposition: variant.disposition,
            mode: "none",
          }),
        );
        expect(result.ok).toBeTrue();
        expect(subject.inspectDurable(operationId).operation?.version).toBe(4);
        expect(subject.inspectDurable(operationId).operation?.disposition).toBe(
          variant.disposition,
        );
      }
    } finally {
      subject.dispose?.();
    }
  });

  test("timeline thread roots and nullable chat timestamps are validated exactly", async () => {
    const valid = openSqliteSubject(":memory:", [], false);
    try {
      valid.seedOperation(terminalOperation());
      valid.seedDraft({
        operationId: "operation-1",
        rowId: 20,
        revision: 1,
        chatJid: "web:terminal",
        threadId: null,
        contentRef: "payload:draft",
      });
      valid.database
        .prepare("UPDATE chats SET last_message_time=NULL WHERE jid=?")
        .run("web:terminal");
      const result = await valid.store.commitTerminal(
        terminalRequest({ threadId: 20 }),
      );
      expect(result.ok).toBeTrue();
      expect(
        (
          valid.database
            .prepare("SELECT last_message_time FROM chats WHERE jid=?")
            .get("web:terminal") as { last_message_time: string }
        ).last_message_time,
      ).toBe("2026-08-14T10:00:00.000Z");
    } finally {
      valid.dispose?.();
    }

    for (const threadId of [999, 30]) {
      const invalid = openSqliteSubject(":memory:", [], false);
      try {
        invalid.seedOperation(terminalOperation());
        if (threadId === 30) {
          invalid.database.exec(
            `INSERT INTO chats(jid,name) VALUES ('web:other','web:other');
             INSERT INTO messages(rowid,id,chat_jid,content,thread_id)
             VALUES (30,'root','web:other','root',NULL)`,
          );
        }
        const result = await invalid.store.commitTerminal(
          terminalRequest({ threadId }),
        );
        expect(result.ok).toBeFalse();
        if (!result.ok) expect(result.error._tag).toBe("owner_conflict");
        expect(invalid.inspectDurable().commitCount).toBe(0);
      } finally {
        invalid.dispose?.();
      }
    }
  });

  test("terminal time fences cover accepted sources cancellation latest draft and outbox equality", async () => {
    const variants = [
      {
        name: "source acceptedAt",
        seed(subject: Awaited<ReturnType<typeof sqliteFactory.create>>) {
          subject.seedOperation(
            terminalOperation({
              sources: [
                {
                  sourceSeq: 1,
                  state: "claimed",
                  operationId: "operation-1",
                  acceptedAt: "2026-08-14T10:30:00.000Z",
                },
              ],
            }),
          );
        },
        request: terminalRequest(),
        tag: "owner_conflict",
      },
      {
        name: "cancellation requestedAt",
        seed(subject: Awaited<ReturnType<typeof sqliteFactory.create>>) {
          subject.seedOperation(
            terminalOperation({
              phase: "cancelling",
              cancellationSourceSeq: 1,
              cancellationRequestedAt: "2026-08-14T10:30:00.000Z",
            }),
          );
        },
        request: terminalRequest({ disposition: "cancelled" }),
        tag: "owner_conflict",
      },
      {
        name: "latest draft writtenAt",
        seed(subject: Awaited<ReturnType<typeof sqliteFactory.create>>) {
          subject.seedOperation(terminalOperation());
          subject.seedDraft({
            operationId: "operation-1",
            rowId: 40,
            revision: 1,
            chatJid: "web:terminal",
            threadId: null,
            contentRef: "payload:draft",
            writtenAt: "2026-08-14T10:30:00.000Z",
          });
        },
        request: terminalRequest({
          mode: "replace_placeholder",
          placeholderRowId: 40,
        }),
        tag: "owner_conflict",
      },
      {
        name: "outbox enqueuedAt equality",
        seed(subject: Awaited<ReturnType<typeof sqliteFactory.create>>) {
          subject.seedOperation(terminalOperation());
        },
        request: terminalRequest({
          outboxIntents: [
            {
              ...terminalOutbox("bad-time"),
              enqueuedAt: "2026-08-14T09:59:59.000Z",
            },
          ],
        }),
        tag: "invalid_request",
      },
    ] as const;
    for (const factory of [sqliteFactory, fakeFactory]) {
      for (const variant of variants) {
        const subject = await factory.create(context());
        try {
          variant.seed(subject);
          const result = await subject.store.commitTerminal(variant.request);
          expect(result.ok, `${factory.name} ${variant.name}`).toBeFalse();
          if (!result.ok) expect(result.error._tag).toBe(variant.tag);
          expect(subject.inspectDurable().commitCount).toBe(0);
        } finally {
          await subject.dispose?.();
        }
      }
    }
  });

  test("exact source coverage rejects missing extra and corrupt queued ownership", async () => {
    for (const sourceDispositions of [
      [] as const,
      [
        { sourceSeq: 1, state: "consumed" as const, reason: "terminal" },
        { sourceSeq: 2, state: "disposed" as const, reason: "foreign" },
      ],
    ]) {
      const subject = openSqliteSubject(":memory:", [], false);
      try {
        subject.seedOperation(terminalOperation());
        const result = await subject.store.commitTerminal(
          terminalRequest({ sourceDispositions }),
        );
        expect(result.ok).toBeFalse();
        expect(subject.inspectDurable().commitCount).toBe(0);
      } finally {
        subject.dispose?.();
      }
    }

    const corruptQueue = openSqliteSubject(":memory:", [], false);
    try {
      corruptQueue.seedOperation(
        terminalOperation({
          sources: [
            {
              sourceSeq: 1,
              state: "claimed",
              operationId: "operation-1",
              queuedState: "consumed",
            },
          ],
        }),
      );
      const result = await corruptQueue.store.commitTerminal(terminalRequest());
      expect(result.ok).toBeFalse();
      if (!result.ok) {
        expect(result.error._tag).toBe("corrupt_state");
      }
      expect(corruptQueue.inspectDurable().operation?.phase).not.toBe("terminal");
    } finally {
      corruptQueue.dispose?.();
    }

    const malformedSeeds: FakeTerminalOperationSeed[] = [
      terminalOperation({
        sources: [
          { sourceSeq: 1, state: "consumed", operationId: "operation-1" },
        ],
      }),
      terminalOperation({
        sources: [
          { sourceSeq: 1, state: "claimed", operationId: "operation-1" },
          { sourceSeq: 3, state: "pending", operationId: null },
        ],
      }),
    ];
    for (const seed of malformedSeeds) {
      const malformed = openSqliteSubject(":memory:", [], false);
      try {
        malformed.seedOperation(seed);
        const result = await malformed.store.commitTerminal(
          terminalRequest({
            sourceDispositions: seed.sources
              .filter((entry) => entry.operationId === "operation-1")
              .map((entry) => ({
                sourceSeq: entry.sourceSeq,
                state: "consumed" as const,
                reason: "terminal",
              })),
          }),
        );
        expect(result.ok).toBeFalse();
        if (!result.ok) expect(result.error._tag).toBe("corrupt_state");
        expect(malformed.inspectDurable().commitCount).toBe(0);
      } finally {
        malformed.dispose?.();
      }
    }
  });

  test("latest placeholder and terminal media role are exact", async () => {
    const placeholder = openSqliteSubject(":memory:", [], false);
    try {
      placeholder.seedOperation(terminalOperation());
      placeholder.seedDraft({
        operationId: "operation-1",
        rowId: 40,
        revision: 1,
        chatJid: "web:terminal",
        threadId: 7,
        contentRef: "payload:draft",
      });
      placeholder.seedDraft({
        operationId: "operation-1",
        rowId: 41,
        revision: 2,
        chatJid: "web:terminal",
        threadId: 7,
        contentRef: "payload:draft",
      });
      const stale = await placeholder.store.commitTerminal(
        terminalRequest({
          mode: "replace_placeholder",
          placeholderRowId: 40,
        }),
      );
      expect(stale.ok).toBeFalse();
      if (!stale.ok) expect(stale.error._tag).toBe("owner_conflict");
      expect(placeholder.inspectDurable().messages.every((row) => !row.terminal)).toBeTrue();
    } finally {
      placeholder.dispose?.();
    }

    const media = openSqliteSubject(":memory:", [], false);
    try {
      media.seedOperation(terminalOperation());
      media.seedMedia("operation-1", 61, "draft");
      const wrongRole = await media.store.commitTerminal(
        terminalRequest({ mediaIds: [61] }),
      );
      expect(wrongRole.ok).toBeFalse();
      if (!wrongRole.ok) expect(wrongRole.error._tag).toBe("missing_media");
      expect(media.inspectDurable().messages).toHaveLength(0);
    } finally {
      media.dispose?.();
    }
  });

  test("placeholder FTS replacement covers media-to-none none-to-media A-to-B and same-media", async () => {
    const variants = [
      { name: "media-to-none", oldMedia: [72], newMedia: [] },
      { name: "none-to-media", oldMedia: [], newMedia: [73] },
      { name: "media-A-to-media-B", oldMedia: [74], newMedia: [75] },
      { name: "same-media", oldMedia: [76], newMedia: [76] },
    ] as const;
    for (const variant of variants) {
      const subject = openSqliteSubject(":memory:", [], false);
      try {
        subject.seedOperation(terminalOperation());
        for (const mediaId of new Set([...variant.oldMedia, ...variant.newMedia])) {
          subject.seedMedia(
            "operation-1",
            mediaId,
            variant.newMedia.some((candidate) => candidate === mediaId) ? "terminal" : "draft",
          );
        }
        subject.seedDraft({
          operationId: "operation-1",
          rowId: 40,
          revision: 1,
          chatJid: "web:terminal",
          threadId: null,
          contentRef: "payload:draft",
          mediaIds: variant.oldMedia,
        });
        const result = await subject.store.commitTerminal(
          terminalRequest({
            mode: "replace_placeholder",
            placeholderRowId: 40,
            mediaIds: variant.newMedia,
          }),
        );
        expect(result.ok, variant.name).toBeTrue();
        const matchCount = (phrase: string): number =>
          (
            subject.database
              .prepare(
                "SELECT count(*) n FROM messages_fts WHERE rowid=40 AND messages_fts MATCH ?",
              )
              .get(`"${phrase}"`) as { n: number }
          ).n;
        expect(
          (
            subject.database
              .prepare("SELECT count(*) n FROM messages_fts WHERE rowid=40")
              .get() as { n: number }
          ).n,
        ).toBe(1);
        expect(matchCount("terminal content")).toBe(1);
        expect(matchCount("draft content")).toBe(0);
        for (const mediaId of variant.oldMedia) {
          if (!variant.newMedia.some((candidate) => candidate === mediaId)) {
            expect(matchCount(`media-${mediaId}-text`)).toBe(0);
          }
        }
        for (const mediaId of variant.newMedia) {
          expect(matchCount(`media-${mediaId}-text`)).toBe(1);
        }
        expect(
          subject.database
            .prepare(
              "SELECT media_id FROM message_media WHERE message_rowid=40 ORDER BY media_id",
            )
            .all()
            .map((row) => (row as { media_id: number }).media_id),
        ).toEqual([...variant.newMedia]);
      } finally {
        subject.dispose?.();
      }
    }
  });

  test("ordered outbox ids media links and FTS share terminal visibility", async () => {
    const subject = openSqliteSubject(":memory:", [], false);
    try {
      subject.seedOperation(terminalOperation());
      subject.seedMedia("operation-1", 71);
      const result = await subject.store.commitTerminal(
        terminalRequest({
          mediaIds: [71],
          outboxIntents: [
            terminalOutbox("ordered-a"),
            terminalOutbox("ordered-b"),
          ],
        }),
      );
      expect(result.ok).toBeTrue();
      if (!result.ok) return;
      expect(result.value.outboxIds).toEqual(["ordered-a", "ordered-b"]);
      const view = subject.inspectDurable();
      expect(view.messages[0]?.mediaIds).toEqual([71]);
      expect(
        (
          subject.database
            .query(
              "SELECT count(*) n FROM messages_fts WHERE messages_fts MATCH 'terminal'",
            )
            .get() as { n: number }
        ).n,
      ).toBe(1);
      expect(
        subject.database
          .query(
            "SELECT outbox_id FROM service_effect_s02_commit_outbox ORDER BY ordinal",
          )
          .all(),
      ).toEqual([{ outbox_id: "ordered-a" }, { outbox_id: "ordered-b" }]);
    } finally {
      subject.dispose?.();
    }
  });
});
