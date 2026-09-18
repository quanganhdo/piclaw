import { beforeEach, describe, expect, test } from "bun:test";
import { createWebSession, getDb, initDatabase } from "../../../src/db.js";
import { getVncHistoryScope } from "../../../src/channels/web/vnc/vnc-history-scope.js";
// Launcher isolation owns the DB path; never use the production store.
beforeEach(() => {
  initDatabase();
  getDb().run("DELETE FROM web_sessions");
});
const request = (token?: string, origin = "http://fixture.local") =>
  new Request(origin + "/vnc/session", {
    headers: token ? { cookie: `piclaw_session=${token}` } : {},
  });
describe("VNC history namespace", () => {
  test("unauthenticated metadata has no shared authenticated namespace", () => {
    expect(getVncHistoryScope(request())).toBeNull();
    expect(getVncHistoryScope(request(), true)).toMatch(/^[a-f0-9]{64}$/);
    expect(getVncHistoryScope(request(), true)).not.toBe(
      getVncHistoryScope(request(undefined, "http://other.local"), true),
    );
  });
  test("stable across login rotation, distinct between accounts, never a session credential", () => {
    for (const [token, userId] of [
      ["one", "alice"],
      ["two", "alice"],
      ["three", "bob"],
    ])
      createWebSession(token, userId, 3600, "test");
    const a = getVncHistoryScope(request("one"));
    expect(a).toBe(getVncHistoryScope(request("two")));
    expect(a).not.toBe(getVncHistoryScope(request("three")));
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });
});
