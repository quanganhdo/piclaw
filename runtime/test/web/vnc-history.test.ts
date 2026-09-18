import { describe, expect, test } from "bun:test";
import {
  readVncHistory,
  recordVncSuccess,
  scopedVncHistoryStorage,
  VNC_HISTORY_KEY,
  writeVncHistory,
} from "../../web/src/panes/vnc-history.js";
function memory() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) || null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
}
describe("VNC successful connection history", () => {
  test("account/instance scopes do not share history; absent scope disables persistence", () => {
    const storage = memory();
    const a = scopedVncHistoryStorage(storage, "a".repeat(64));
    const b = scopedVncHistoryStorage(storage, "b".repeat(64));
    recordVncSuccess(a, "desktop:5901", "Desktop", 1);
    expect(readVncHistory(b)).toEqual([]);
    expect(readVncHistory(a)).toHaveLength(1);
    expect(scopedVncHistoryStorage(storage, null)).toBeNull();
    expect(scopedVncHistoryStorage(storage, "credential")).toBeNull();
    recordVncSuccess(null, "ignored", "ignored");
    expect(storage.data.size).toBe(1);
  });
  test("deduplicates, keeps pins and drops excess recents without persisting arbitrary fields", () => {
    const storage = memory();
    for (let i = 0; i < 15; i++)
      recordVncSuccess(storage, `host-${i}:5901`, `Host ${i}`, i + 1);
    expect(readVncHistory(storage)).toHaveLength(10);
    const entries = readVncHistory(storage);
    entries[0].pinned = true;
    (entries[0] as any).password = "never-persist";
    writeVncHistory(storage, entries);
    recordVncSuccess(storage, entries[0].target, "Updated", 100);
    expect(readVncHistory(storage)[0]).toEqual({
      target: entries[0].target,
      label: "Updated",
      connectedAt: 100,
      pinned: true,
    });
    expect(storage.getItem(VNC_HISTORY_KEY)).not.toContain("password");
    expect(storage.getItem(VNC_HISTORY_KEY)).not.toContain("never-persist");
  });
  test("corrupt and blocked storage are harmless", () => {
    const storage = memory();
    for (const raw of ["not-json", "{}", '[null,{},42,{"target":3}]']) {
      storage.setItem(VNC_HISTORY_KEY, raw);
      expect(readVncHistory(storage)).toEqual([]);
    }
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(readVncHistory(blocked)).toEqual([]);
    expect(() => recordVncSuccess(blocked, "host:5901", "Host")).not.toThrow();
  });
});
