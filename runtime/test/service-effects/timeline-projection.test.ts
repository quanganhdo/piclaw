import { expect, test } from "bun:test";
import { terminalOperation, terminalRequest } from "../../src/service-effects/testing/contract-suites/terminal-settlement-store-contract.js";
import { openSqliteSubject } from "./terminal-settlement-test-support.js";

test("terminal replay depends on committed execution, not editable timeline rows", async () => {
  const subject = openSqliteSubject(":memory:", [], false);
  try {
    subject.seedOperation(terminalOperation());
    const request = terminalRequest();
    const committed = await subject.store.commitTerminal(request);
    expect(committed.ok).toBe(true);
    if (!committed.ok) throw Error("Fixture commit failed");
    const rowid = committed.value.messageRowId!;
    subject.database.query("UPDATE messages SET content='edited',is_terminal_agent_reply=0 WHERE rowid=?").run(rowid);
    expect(await subject.store.getTerminal("operation-1")).toEqual(committed);
    expect(await subject.store.commitTerminal(request)).toEqual(committed);
    subject.database.query("DELETE FROM messages WHERE rowid=?").run(rowid);
    expect(await subject.store.getTerminal("operation-1")).toEqual(committed);
    expect(await subject.store.commitTerminal(request)).toEqual(committed);
    expect(subject.database.query("SELECT COUNT(*) n FROM messages").get()).toEqual({ n: 0 });
  } finally { subject.dispose?.(); }
});
