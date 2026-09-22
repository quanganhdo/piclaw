import type Database from "bun:sqlite";
import { randomUUID } from "node:crypto";
export type PinKind = "model" | "session";
export interface PickerPins {
  scope: string;
  revision: number;
  models: string[];
  sessions: string[];
}
export type PinChange =
  | { action: "set"; kind: PinKind; key: string; pinned: boolean }
  | { action: "import"; browser: string; models: string[]; sessions: string[] };
const MAX_PINS = 256,
  MAX_HISTORY = 4096;
export function initializePickerPins(db: Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS picker_pin_scopes (owner TEXT PRIMARY KEY, public_id TEXT NOT NULL, revision INTEGER NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS picker_pins (owner TEXT NOT NULL REFERENCES picker_pin_scopes(owner), kind TEXT NOT NULL CHECK(kind IN ('model','session')), key TEXT NOT NULL, pinned INTEGER NOT NULL CHECK(pinned IN (0,1)), PRIMARY KEY(owner,kind,key)) STRICT;
    CREATE TABLE IF NOT EXISTS picker_pin_imports (owner TEXT NOT NULL REFERENCES picker_pin_scopes(owner), browser TEXT NOT NULL, PRIMARY KEY(owner,browser)) STRICT;`);
}
export function normalizePinKey(kind: PinKind, value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 512 ||
    [...value].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  )
    throw new Error("Invalid pin key.");
  const key = value.trim();
  if (kind === "model") {
    const slash = key.indexOf("/");
    if (slash <= 0 || slash === key.length - 1)
      throw new Error("Invalid model key.");
    return key.slice(0, slash).toLowerCase() + key.slice(slash);
  }
  return key;
}
export function parsePinChange(value: unknown): PinChange {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid pin action.");
  const v = value as Record<string, unknown>;
  if (
    v.action === "set" &&
    Object.keys(v).length === 4 &&
    ["model", "session"].includes(String(v.kind)) &&
    typeof v.pinned === "boolean"
  ) {
    const kind = v.kind as PinKind;
    return {
      action: "set",
      kind,
      key: normalizePinKey(kind, v.key),
      pinned: v.pinned,
    };
  }
  if (
    v.action === "import" &&
    Object.keys(v).length === 4 &&
    typeof v.browser === "string" &&
    /^[a-zA-Z0-9_-]{16,80}$/.test(v.browser)
  ) {
    const list = (kind: PinKind, input: unknown) => {
      if (!Array.isArray(input) || input.length > MAX_PINS)
        throw new Error("Too many imported pins.");
      return [...new Set(input.map((key) => normalizePinKey(kind, key)))];
    };
    return {
      action: "import",
      browser: v.browser,
      models: list("model", v.models),
      sessions: list("session", v.sessions),
    };
  }
  throw new Error("Invalid pin action.");
}
export function readPickerPins(
  db: Database,
  owner: string,
  canReadSession: (jid: string) => boolean = () => true,
): PickerPins {
  db.query("INSERT OR IGNORE INTO picker_pin_scopes VALUES (?,?,0)").run(
    owner,
    randomUUID(),
  );
  const state = db
    .query("SELECT public_id,revision FROM picker_pin_scopes WHERE owner=?")
    .get(owner) as { public_id: string; revision: number };
  const rows = db
    .query(
      "SELECT kind,key FROM picker_pins WHERE owner=? AND pinned=1 ORDER BY rowid",
    )
    .all(owner) as Array<{ kind: PinKind; key: string }>;
  return {
    scope: state.public_id,
    revision: state.revision,
    models: rows.filter((r) => r.kind === "model").map((r) => r.key),
    sessions: rows
      .filter((r) => r.kind === "session" && canReadSession(r.key))
      .map((r) => r.key),
  };
}
/** Desired-state writes are atomic and idempotent; imports never overwrite
 * existing rows, including unpin tombstones from another browser. */
export function changePickerPins(
  db: Database,
  owner: string,
  change: PinChange,
  canReadSession: (jid: string) => boolean = () => true,
): PickerPins {
  return db
    .transaction(() => {
      const before = readPickerPins(db, owner, canReadSession);
      if (
        change.action === "import" &&
        db
          .query("SELECT 1 FROM picker_pin_imports WHERE owner=? AND browser=?")
          .get(owner, change.browser)
      )
        return before;
      const write = (
        kind: PinKind,
        key: string,
        pinned: boolean,
        importing = false,
      ) => {
        if (kind === "session" && !canReadSession(key)) {
          if (importing) return;
          throw new Error("Session access denied.");
        }
        const old = db
          .query(
            "SELECT pinned FROM picker_pins WHERE owner=? AND kind=? AND key=?",
          )
          .get(owner, kind, key) as { pinned: number } | null;
        if (importing && old) return;
        if (old?.pinned === Number(pinned)) return;
        const count = db
          .query("SELECT count(*) AS n FROM picker_pins WHERE owner=?")
          .get(owner) as { n: number };
        if (!old && count.n >= MAX_HISTORY)
          throw new Error("Pin history limit reached.");
        const active = db
          .query(
            "SELECT count(*) AS n FROM picker_pins WHERE owner=? AND kind=? AND pinned=1",
          )
          .get(owner, kind) as { n: number };
        if (pinned && active.n >= MAX_PINS)
          throw new Error("Pin limit reached.");
        db.query(
          "INSERT INTO picker_pins VALUES (?,?,?,?) ON CONFLICT(owner,kind,key) DO UPDATE SET pinned=excluded.pinned",
        ).run(owner, kind, key, Number(pinned));
      };
      if (change.action === "set")
        write(change.kind, change.key, change.pinned);
      else {
        const imports = db
          .query("SELECT count(*) AS n FROM picker_pin_imports WHERE owner=?")
          .get(owner) as { n: number };
        if (imports.n >= 1024) throw new Error("Browser import limit reached.");
        change.models.forEach((key) => write("model", key, true, true));
        change.sessions.forEach((key) => write("session", key, true, true));
        db.query("INSERT INTO picker_pin_imports VALUES (?,?)").run(
          owner,
          change.browser,
        );
      }
      // Include tombstone/import-only writes so clients never accept an older reply.
      db.query(
        "UPDATE picker_pin_scopes SET revision=revision+1 WHERE owner=?",
      ).run(owner);
      return readPickerPins(db, owner, canReadSession);
    })
    .immediate();
}
