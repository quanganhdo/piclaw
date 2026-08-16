import { describe, expect, test } from "bun:test";
import { terminalOperation, terminalOutbox, terminalRequest } from "../../src/service-effects/testing/contract-suites/terminal-settlement-store-contract.js";
import { openSqliteSubject, type SqliteSubject } from "./terminal-settlement-test-support.js";

describe("EF-S02 lookup and error taxonomy", () => {
  test("invalid lookup missing operation and untraced read semantics are distinct", async () => {
    const subject = openSqliteSubject(":memory:", [], false);
    try {
      const before = subject.runtime.trace.inspect().length;
      const invalid = await subject.store.getTerminal(" ");
      expect(invalid.ok).toBeFalse();
      if (!invalid.ok) expect(invalid.error._tag).toBe("invalid_request");
      const absent = await subject.store.getTerminal("operation-absent");
      expect(absent.ok && absent.value).toBeNull();
      const commit = await subject.store.commitTerminal(terminalRequest());
      expect(commit.ok).toBeFalse();
      if (!commit.ok) expect(commit.error._tag).toBe("not_found");
      expect(subject.runtime.trace.inspect().length).toBe(before + 2);
    } finally {
      subject.dispose?.();
    }
  });

  test("every public error tag is reachable without leaking adapter details", async () => {
    const seen = new Set<string>();
    const run = async (
      setup: (subject: SqliteSubject) => void,
      request: ReturnType<typeof terminalRequest>,
    ) => {
      const subject = openSqliteSubject(":memory:", [], false);
      try {
        setup(subject);
        const result = await subject.store.commitTerminal(request);
        expect(result.ok).toBeFalse();
        if (!result.ok) seen.add(result.error._tag);
      } finally {
        subject.dispose?.();
      }
    };
    const invalid = openSqliteSubject(":memory:", [], false);
    try {
      const result = await invalid.store.commitTerminal(
        {} as ReturnType<typeof terminalRequest>,
      );
      if (!result.ok) seen.add(result.error._tag);
    } finally {
      invalid.dispose?.();
    }
    await run(() => {}, terminalRequest());
    await run(
      (subject) => {
        subject.seedOperation(terminalOperation());
        subject.seedOutbox(terminalOutbox("error-collision"));
      },
      terminalRequest({ outboxIntents: [terminalOutbox("error-collision")] }),
    );
    await run(
      (subject) => subject.seedOperation(terminalOperation()),
      terminalRequest({ expectedVersion: 2 }),
    );
    await run(
      (subject) => subject.seedOperation(terminalOperation()),
      terminalRequest({ chatJid: "web:wrong" }),
    );
    const closed = openSqliteSubject(":memory:", [], false);
    try {
      closed.seedOperation(terminalOperation());
      expect((await closed.store.commitTerminal(terminalRequest())).ok).toBeTrue();
      const conflict = await closed.store.commitTerminal(
        terminalRequest({ key: "closed-other" }),
      );
      if (!conflict.ok) seen.add(conflict.error._tag);
    } finally {
      closed.dispose?.();
    }
    await run(
      (subject) => subject.seedOperation(terminalOperation()),
      terminalRequest({
        sourceDispositions: [
          { sourceSeq: 1, state: "consumed", reason: "terminal" },
          { sourceSeq: 2, state: "disposed", reason: "extra" },
        ],
      }),
    );
    await run(
      (subject) => subject.seedOperation(terminalOperation()),
      terminalRequest({ mediaIds: [404] }),
    );
    await run(
      (subject) =>
        subject.seedOperation(
          terminalOperation({
            sources: [
              { sourceSeq: 1, state: "consumed", operationId: "operation-1" },
            ],
          }),
        ),
      terminalRequest(),
    );
    await run(
      (subject) => {
        subject.seedOperation(terminalOperation());
        subject.planFault("before_effect");
      },
      terminalRequest(),
    );
    expect([...seen].sort()).toEqual(
      [
        "already_terminal_conflict",
        "corrupt_state",
        "idempotency_conflict",
        "invalid_request",
        "invalid_source_disposition",
        "missing_media",
        "not_found",
        "owner_conflict",
        "storage_unavailable",
        "version_mismatch",
      ].sort(),
    );
  });
});
