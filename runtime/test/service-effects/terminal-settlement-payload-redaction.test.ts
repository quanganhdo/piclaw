import { describe, expect, test } from "bun:test";
import { terminalOperation, terminalOutbox, terminalRequest } from "../../src/service-effects/testing/contract-suites/terminal-settlement-store-contract.js";
import { FakeTerminalSettlementStore } from "../../src/service-effects/testing/fakes/fake-terminal-settlement-store.js";
import { inspectFake, openSqliteSubject, type SqliteSubject } from "./terminal-settlement-test-support.js";

describe("EF-S02 payload observer and redaction hardening", () => {
  test("payload media type and content-block validation fail before mutation", async () => {
    const wrongText = openSqliteSubject(":memory:", [], false);
    try {
      wrongText.seedOperation(terminalOperation());
      wrongText.payloads.add(
        "payload:wrong-text",
        "protected payload",
        "application/octet-stream",
      );
      const result = await wrongText.store.commitTerminal(
        terminalRequest({ contentRef: "payload:wrong-text" }),
      );
      expect(result.ok).toBeFalse();
      expect(wrongText.inspectDurable().commitCount).toBe(0);
    } finally {
      wrongText.dispose?.();
    }

    const blocks = openSqliteSubject(":memory:", [], false);
    try {
      blocks.seedOperation(terminalOperation());
      blocks.payloads.add(
        "payload:bad-blocks",
        '{"protected":"value"}',
        "application/json",
      );
      const result = await blocks.store.commitTerminal(
        terminalRequest({ contentBlocksRef: "payload:bad-blocks" }),
      );
      expect(result.ok).toBeFalse();
      if (!result.ok) expect(result.error._tag).toBe("corrupt_state");
      expect(blocks.inspectDurable().messages).toHaveLength(0);
    } finally {
      blocks.dispose?.();
    }
  });

  test("malformed media metadata and gzip bytes are corrupt and rollback replacement", async () => {
    for (const variant of [
      { metadata: "{bad-json", data: new TextEncoder().encode("media text") },
      {
        metadata: JSON.stringify({ compressed: "gzip" }),
        data: new Uint8Array([0, 1, 2, 3]),
      },
    ]) {
      const subject = openSqliteSubject(":memory:", [], false);
      try {
        subject.seedOperation(terminalOperation());
        subject.seedMedia("operation-1", 92, "draft");
        subject.seedDraft({
          operationId: "operation-1",
          rowId: 40,
          revision: 1,
          chatJid: "web:terminal",
          threadId: null,
          contentRef: "payload:draft",
          mediaIds: [92],
        });
        subject.database
          .prepare("UPDATE media SET metadata=?,data=? WHERE id=92")
          .run(variant.metadata, variant.data);
        const result = await subject.store.commitTerminal(
          terminalRequest({ mode: "replace_placeholder", placeholderRowId: 40 }),
        );
        expect(result.ok).toBeFalse();
        if (!result.ok) expect(result.error._tag).toBe("corrupt_state");
        const durable = subject.inspectDurable();
        expect(durable.commitCount).toBe(0);
        expect(durable.messages[0]?.terminal).toBeFalse();
        expect(durable.messages[0]?.mediaIds).toEqual([92]);
      } finally {
        subject.dispose?.();
      }
    }
  });

  test("independent fake enforces missing digest redaction blocks and resolved-content snapshots", async () => {
    const missing = new FakeTerminalSettlementStore();
    missing.seedOperation(terminalOperation());
    missing.removePayload("payload:terminal-content");
    const absent = await missing.commitTerminal(terminalRequest());
    expect(absent.ok).toBeFalse();
    expect(inspectFake(missing, "operation-1").commitCount).toBe(0);

    const mismatched = new FakeTerminalSettlementStore();
    mismatched.seedOperation(terminalOperation());
    mismatched.seedPayload(
      "payload:terminal-content",
      "private",
      "text/plain",
      "private",
    );
    expect((await mismatched.commitTerminal(terminalRequest())).ok).toBeFalse();

    const bytes = new TextEncoder().encode("protected-digest");
    const digest = new FakeTerminalSettlementStore([], {
      resolve: () => ({
        ref: "payload:terminal-content",
        sha256: "0".repeat(64),
        byteLength: bytes.byteLength,
        mediaType: "text/plain",
        redactionClass: "secret",
        bytes,
      }),
    });
    digest.seedOperation(terminalOperation());
    expect((await digest.commitTerminal(terminalRequest())).ok).toBeFalse();

    const blocks = new FakeTerminalSettlementStore();
    blocks.seedOperation(terminalOperation());
    blocks.seedPayload(
      "payload:fake-blocks",
      '[{"type":"restart_handoff"}]',
      "application/json",
    );
    const blocked = await blocks.commitTerminal(
      terminalRequest({ contentBlocksRef: "payload:fake-blocks" }),
    );
    expect(blocked.ok).toBeFalse();

    const valid = new FakeTerminalSettlementStore();
    valid.seedOperation(terminalOperation());
    const committed = await valid.commitTerminal(terminalRequest());
    expect(committed.ok).toBeTrue();
    expect(valid.snapshot().messages[0]?.content).toBe("terminal content");
  });

  test("minimal commit and decision ledgers retain no protected payload or authority refs", async () => {
    const subject = openSqliteSubject(":memory:", [], false);
    try {
      subject.seedOperation(
        terminalOperation({
          phase: "claimed",
          harness: null,
        }),
      );
      const request = terminalRequest({
        disposition: "skipped",
        expectedHarness: null,
        mode: "none",
        terminalAuthorityRef: "opaque:protected-terminal-authority",
        outboxIntents: [terminalOutbox("privacy-outbox")],
      });
      expect((await subject.store.commitTerminal(request)).ok).toBeTrue();
      const ledgers = JSON.stringify({
        commits: subject.database
          .prepare("SELECT * FROM service_effect_s02_commits")
          .all(),
        links: subject.database
          .prepare("SELECT * FROM service_effect_s02_commit_outbox")
          .all(),
        decisions: subject.database
          .prepare("SELECT * FROM service_effect_s05_decisions")
          .all(),
      });
      for (const protectedValue of [
        "protected-terminal-authority",
        "protected-provenance",
        "protected-outbox",
        "protected-destination",
        "terminal content",
        "restart_handoff",
      ]) {
        expect(ledgers).not.toContain(protectedValue);
      }
      const columns = (
        subject.database
          .prepare("SELECT name FROM pragma_table_info('service_effect_s02_commits')")
          .all() as Array<{ name: string }>
      ).map((entry) => entry.name);
      expect(columns).not.toContain("terminal_authority_ref");
      expect(columns).toContain("terminal_authority_present");

      const fake = new FakeTerminalSettlementStore();
      fake.seedOperation(
        terminalOperation({ phase: "claimed", harness: null }),
      );
      expect((await fake.commitTerminal(request)).ok).toBeTrue();
      expect(JSON.stringify(fake.snapshot().decisions)).not.toContain(
        "protected-terminal-authority",
      );
    } finally {
      subject.dispose?.();
    }
  });

  test("NFC-normalised identities are rejected before mutation", async () => {
    const unicode = openSqliteSubject(":memory:", [], false);
    try {
      unicode.seedOperation(terminalOperation());
      const result = await unicode.store.commitTerminal(
        terminalRequest({ key: "terminal-e\u0301" }),
      );
      expect(result.ok).toBeFalse();
      if (!result.ok) expect(result.error._tag).toBe("invalid_request");
    } finally {
      unicode.dispose?.();
    }
  });

  test("post-resolution payload bytes and caller request mutation cannot alter the accepted snapshot", async () => {
    const subject = openSqliteSubject(":memory:", [], false);
    try {
      subject.seedOperation(terminalOperation());
      subject.payloads.add(
        "payload:blocks-barrier",
        '[{"type":"text","value":"original"}]',
        "application/json",
      );
      const barrier = subject.payloads.block("payload:blocks-barrier");
      const mutable = structuredClone(
        terminalRequest({
          contentBlocksRef: "payload:blocks-barrier",
          outboxIntents: [terminalOutbox("snapshot-outbox")],
        }),
      );
      const pending = subject.store.commitTerminal(mutable);
      await barrier.started;
      const content = subject.payloads.values.get("payload:terminal-content");
      if (!content) throw new Error("missing test payload");
      content.bytes.fill(120);
      Reflect.set(mutable.expectedHarness!, "watchGeneration", 999);
      Reflect.set(mutable.sourceDispositions[0]!, "reason", "mutated");
      Reflect.set(mutable.outboxIntents[0]!, "outboxId", "mutated-outbox");
      barrier.release();
      const result = await pending;
      expect(result.ok).toBeTrue();
      expect(
        (
          subject.database
            .prepare("SELECT content FROM messages WHERE is_terminal_agent_reply=1")
            .get() as { content: string }
        ).content,
      ).toBe("terminal content");
      expect(subject.inspectDurable().outboxIds).toEqual(["snapshot-outbox"]);
    } finally {
      subject.dispose?.();
    }
  });

  test("barriers revalidate owner harness placeholder and media authority before mutation", async () => {
    const variants = [
      {
        name: "owner",
        setup: (subject: SqliteSubject) => {
          subject.database
            .prepare(
              "UPDATE service_effect_s01_chats SET active_operation_id=NULL WHERE chat_jid='web:terminal'",
            )
            .run();
        },
        request: () => terminalRequest(),
      },
      {
        name: "harness",
        setup: (subject: SqliteSubject) => {
          subject.database
            .prepare(
              "UPDATE service_effect_s01_operations SET harness_watch_generation=9 WHERE operation_id='operation-1'",
            )
            .run();
        },
        request: () => terminalRequest(),
      },
      {
        name: "placeholder",
        setup: (subject: SqliteSubject) => {
          subject.database
            .prepare(
              "UPDATE messages SET is_terminal_agent_reply=1 WHERE rowid=40",
            )
            .run();
        },
        request: () =>
          terminalRequest({ mode: "replace_placeholder", placeholderRowId: 40 }),
        draft: true,
      },
      {
        name: "latest-draft",
        setup: (subject: SqliteSubject) => {
          subject.seedDraft({
            operationId: "operation-1",
            rowId: 41,
            revision: 2,
            chatJid: "web:terminal",
            threadId: null,
            contentRef: "payload:draft",
          });
        },
        request: () =>
          terminalRequest({ mode: "replace_placeholder", placeholderRowId: 40 }),
        draft: true,
      },
      {
        name: "media",
        setup: (subject: SqliteSubject) => {
          subject.database
            .prepare(
              "UPDATE service_effect_operation_media SET role='draft' WHERE operation_id='operation-1' AND media_id=91",
            )
            .run();
        },
        request: () => terminalRequest({ mediaIds: [91] }),
        media: true,
      },
    ] as const;
    for (const variant of variants) {
      const subject = openSqliteSubject(":memory:", [], false);
      try {
        subject.seedOperation(terminalOperation());
        if (variant.draft) {
          subject.seedDraft({
            operationId: "operation-1",
            rowId: 40,
            revision: 1,
            chatJid: "web:terminal",
            threadId: null,
            contentRef: "payload:draft",
          });
        }
        if (variant.media) subject.seedMedia("operation-1", 91);
        const barrier = subject.payloads.block("payload:terminal-content");
        const pending = subject.store.commitTerminal(variant.request());
        await barrier.started;
        variant.setup(subject);
        barrier.release();
        const result = await pending;
        expect(result.ok).toBeFalse();
        expect(subject.inspectDurable().commitCount).toBe(0);
        expect(subject.inspectDurable().operation?.phase).not.toBe("terminal");
      } finally {
        subject.dispose?.();
      }
    }
  });

  test("fault and trace callbacks require exact booleans and remain bounded", async () => {
    const beforeInvalid = openSqliteSubject(":memory:", [], false);
    try {
      beforeInvalid.seedOperation(terminalOperation());
      beforeInvalid.runtime.beforeValue = "true";
      const invalid = await beforeInvalid.store.commitTerminal(terminalRequest());
      expect(invalid.ok).toBeFalse();
      if (!invalid.ok) expect(invalid.error.certainty).toBe("not_applied");
    } finally {
      beforeInvalid.dispose?.();
    }

    const beforeThrow = openSqliteSubject(":memory:", [], false);
    try {
      beforeThrow.seedOperation(terminalOperation());
      beforeThrow.runtime.throwBefore = true;
      const result = await beforeThrow.store.commitTerminal(terminalRequest());
      expect(result.ok).toBeFalse();
      if (!result.ok) expect(result.error.certainty).toBe("not_applied");
      expect(JSON.stringify(result)).not.toContain("protected-before-fault");
    } finally {
      beforeThrow.dispose?.();
    }

    const acknowledgement = openSqliteSubject(":memory:", [], false);
    try {
      acknowledgement.seedOperation(terminalOperation());
      acknowledgement.runtime.acknowledgementValue = Promise.resolve(true);
      expect(
        (await acknowledgement.store.commitTerminal(terminalRequest())).ok,
      ).toBeTrue();
    } finally {
      acknowledgement.dispose?.();
    }

    for (const mode of ["nonboolean", "throw"] as const) {
      const checkpoint = openSqliteSubject(":memory:", [], false);
      try {
        checkpoint.seedOperation(terminalOperation());
        if (mode === "throw") checkpoint.runtime.throwCheckpoint = true;
        else checkpoint.runtime.checkpointValue = "false";
        const result = await checkpoint.store.commitTerminal(terminalRequest());
        expect(result.ok).toBeFalse();
        if (!result.ok) expect(result.error.certainty).toBe("not_applied");
        expect(checkpoint.inspectDurable().commitCount).toBe(0);
        expect(JSON.stringify(result)).not.toContain("protected-checkpoint-fault");
      } finally {
        checkpoint.dispose?.();
      }
    }

    const acknowledgementThrow = openSqliteSubject(":memory:", [], false);
    try {
      acknowledgementThrow.seedOperation(terminalOperation());
      acknowledgementThrow.runtime.throwAcknowledgement = true;
      expect(
        (await acknowledgementThrow.store.commitTerminal(terminalRequest())).ok,
      ).toBeTrue();
    } finally {
      acknowledgementThrow.dispose?.();
    }

    const traceThrow = openSqliteSubject(":memory:", [], false);
    try {
      traceThrow.seedOperation(terminalOperation());
      traceThrow.runtime.recordTrace = () => {
        throw new Error("protected-trace-fault");
      };
      expect((await traceThrow.store.commitTerminal(terminalRequest())).ok).toBeTrue();
    } finally {
      traceThrow.dispose?.();
    }

    const fake = new FakeTerminalSettlementStore([], undefined, {
      recordTrace() {
        throw new Error("protected-fake-observer");
      },
    });
    fake.seedOperation(terminalOperation());
    expect((await fake.commitTerminal(terminalRequest())).ok).toBeTrue();
  });

  test("hostile input and SQLite failures never escape protected values", async () => {
    const subject = openSqliteSubject(":memory:", [], false);
    try {
      subject.seedOperation(terminalOperation());
      const hostile = new Proxy(
        {},
        {
          ownKeys() {
            throw new Error("protected-ownkeys");
          },
        },
      );
      const result = await subject.store.commitTerminal(
        hostile as unknown as ReturnType<typeof terminalRequest>,
      );
      expect(result.ok).toBeFalse();
      const encoded = JSON.stringify(result);
      expect(encoded).not.toContain("protected-ownkeys");
      expect(encoded).not.toContain("SQLITE");
      expect(encoded).not.toContain("opaque:protected");
    } finally {
      subject.dispose?.();
    }
  });
});
