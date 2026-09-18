/** Account/instance-scoped, origin-local VNC history. Never stores authentication or clipboard data. */
export const VNC_HISTORY_KEY = "piclaw:vnc-history:v1";
export interface VncHistoryEntry {
  target: string;
  label: string;
  connectedAt: number;
  pinned: boolean;
}
interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readVncHistory(storage: Storage | null): VncHistoryEntry[] {
  try {
    const value = JSON.parse(storage?.getItem(VNC_HISTORY_KEY) || "[]");
    if (!Array.isArray(value)) return [];
    return normalize(value);
  } catch {
    return [];
  }
}
/** Missing scope means no persistence, rather than falling back to a shared key. */
export function scopedVncHistoryStorage(
  storage: Storage | null,
  scope: unknown,
): Storage | null {
  if (!storage || typeof scope !== "string" || !/^[a-f0-9]{64}$/.test(scope))
    return null;
  return {
    getItem: (key) => storage.getItem(key + ":" + scope),
    setItem: (key, value) => storage.setItem(key + ":" + scope, value),
  };
}
function normalize(entries: VncHistoryEntry[]): VncHistoryEntry[] {
  const seen = new Set<string>();
  let pinned = 0,
    recent = 0;
  return entries
    .filter(
      (e) =>
        e &&
        typeof e.target === "string" &&
        e.target.length > 0 &&
        e.target.length <= 512 &&
        typeof e.connectedAt === "number" &&
        Number.isFinite(e.connectedAt) &&
        e.connectedAt > 0,
    )
    .sort((a, b) => b.connectedAt - a.connectedAt)
    .filter((e) => {
      if (seen.has(e.target)) return false;
      seen.add(e.target);
      return e.pinned === true ? ++pinned <= 10 : ++recent <= 10;
    })
    .map((e) => ({
      target: e.target,
      label: typeof e.label === "string" ? e.label.slice(0, 256) : e.target,
      connectedAt: e.connectedAt,
      pinned: e.pinned === true,
    }));
}
export function writeVncHistory(
  storage: Storage | null,
  entries: VncHistoryEntry[],
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(VNC_HISTORY_KEY, JSON.stringify(normalize(entries)));
    return true;
  } catch {
    return false;
  }
}
export function recordVncSuccess(
  storage: Storage | null,
  target: string,
  label: string,
  now = Date.now(),
): void {
  const entries = readVncHistory(storage);
  const previous = entries.find((e) => e.target === target);
  writeVncHistory(storage, [
    { target, label, connectedAt: now, pinned: previous?.pinned || false },
    ...entries.filter((e) => e.target !== target),
  ]);
}
