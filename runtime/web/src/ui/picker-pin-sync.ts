import {
  readModelCataloguePreferences,
  writeModelCataloguePreferences,
} from "./model-catalogue-preferences.js";
import {
  readSessionPickerPreferences,
  writeSessionPickerPreferences,
} from "./session-picker-preferences.js";
export const PICKER_PIN_WRITE_EVENT = "piclaw:picker-pin-write";
export const PICKER_PINS_CHANGED_EVENT = "piclaw:picker-pins-changed";
interface Runtime extends EventTarget {
  localStorage: Pick<Storage, "getItem" | "setItem">;
}
interface Snapshot {
  scope: string;
  revision: number;
  models: string[];
  sessions: string[];
}
interface Write {
  kind: "model" | "session";
  key: string;
  pinned: boolean;
}
interface Options {
  runtime?: Runtime;
  request?: (method: "GET" | "POST", body?: unknown) => Promise<Snapshot>;
  markerStorage?: Pick<Storage, "getItem" | "setItem">;
  onError?: (message: string) => void;
}
const browserRequest = async (
  method: "GET" | "POST",
  body?: unknown,
): Promise<Snapshot> => {
  const res = await fetch("/agent/picker-pins", {
    method,
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  if (!res.ok) throw Error("Pins could not be saved.");
  return res.json();
};
/** One lifecycle per page/account. Recents and sort stay browser-local; only
 * pin intents go to the server. No interval, polling or durable offline queue. */
export function startPickerPinSync(options: Options = {}) {
  const runtime = options.runtime ?? (window as unknown as Runtime);
  const request = options.request ?? browserRequest;
  let stopped = false,
    ready = false,
    snapshot: Snapshot | null = null,
    refreshing: Promise<void> | null = null;
  let chain: Promise<void> = Promise.resolve();
  let refreshAgain = false;
  const pending: Write[] = [];
  // Migration only imports what existed when this lifecycle began, never a
  // failed optimistic edit made while the initial GET was offline.
  const legacyModels = readModelCataloguePreferences(runtime).pinnedKeys;
  const legacySessions = readSessionPickerPreferences(runtime).pinnedChatJids;
  let memoryBrowser: string | null = null;
  const storage = () => options.markerStorage ?? runtime.localStorage;
  const get = (key: string) => {
    try {
      return storage().getItem(key);
    } catch {
      return null;
    }
  };
  const set = (key: string, value: string) => {
    try {
      storage().setItem(key, value);
    } catch (error) {
      console.debug('[picker-pin-sync] Migration marker storage unavailable.', error);
    }
  };
  const report = () => {
    if (stopped) return;
    const message =
      "Pin sync failed. Your change was not saved; try again when connected.";
    options.onError?.(message);
    runtime.dispatchEvent(
      new CustomEvent("piclaw:pin-sync-error", { detail: { message } }),
    );
  };
  const apply = () => {
    if (!snapshot || stopped) return;
    const models = new Set(snapshot.models),
      sessions = new Set(snapshot.sessions);
    for (const op of pending) {
      const target = op.kind === "model" ? models : sessions;
      if (op.pinned) target.add(op.key);
      else target.delete(op.key);
    }
    writeModelCataloguePreferences(
      { ...readModelCataloguePreferences(runtime), pinnedKeys: [...models] },
      runtime,
    );
    writeSessionPickerPreferences({ pinnedChatJids: [...sessions] }, runtime);
  };
  const accept = (next: Snapshot) => {
    if (
      !next ||
      typeof next.scope !== "string" ||
      !Number.isSafeInteger(next.revision) ||
      !Array.isArray(next.models) ||
      !Array.isArray(next.sessions)
    )
      throw Error("Invalid pin response.");
    if (stopped) return;
    if (snapshot && next.scope !== snapshot.scope)
      throw Error("Pin scope changed. Reload.");
    if (!snapshot || next.revision >= snapshot.revision) snapshot = next;
  };
  const initialize = async () => {
    if (ready) return;
    const next = await request("GET");
    if (stopped) return;
    accept(next);
    const marker = "piclaw:pins-imported:" + next.scope;
    if (get(marker) !== "1" && (legacyModels.length || legacySessions.length)) {
      const idKey = "piclaw:pins-browser:" + next.scope;
      let browser = get(idKey) || memoryBrowser;
      if (!browser) {
        browser = Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) =>
          n.toString(16).padStart(2, "0"),
        ).join("");
        set(idKey, browser);
      }
      memoryBrowser = browser;
      const imported = await request("POST", {
        action: "import",
        browser,
        models: legacyModels,
        sessions: legacySessions,
      });
      if (stopped) return;
      accept(imported);
      set(marker, "1");
    }
    set(marker, "1");
    ready = true;
    apply();
  };
  const enqueue = (job: () => Promise<void>) => {
    const run = chain.then(async () => {
      if (!stopped) await job();
    });
    chain = run.catch((error) => { console.debug('[picker-pin-sync] Queued refresh failed; later requests remain runnable.', error); });
    return run;
  };
  const refresh = () => {
    if (refreshing) {
      refreshAgain = true;
      return refreshing;
    }
    refreshing = enqueue(async () => {
      if (!ready) await initialize();
      else {
        accept(await request("GET"));
        apply();
      }
    })
      .catch(report)
      .finally(() => {
        refreshing = null;
        if (refreshAgain && !stopped) {
          refreshAgain = false;
          void refresh();
        }
      });
    return refreshing;
  };
  const write = (event: Event) => {
    const op = (event as CustomEvent<Write>).detail;
    if (
      !op ||
      !["model", "session"].includes(op.kind) ||
      typeof op.key !== "string" ||
      typeof op.pinned !== "boolean"
    )
      return;
    pending.push(op);
    void enqueue(async () => {
      try {
        await initialize();
        if (!stopped) accept(await request("POST", { action: "set", ...op }));
      } catch {
        report();
      } finally {
        pending.splice(pending.indexOf(op), 1);
        if (snapshot) apply();
        else if (!stopped) {
          writeModelCataloguePreferences(
            {
              ...readModelCataloguePreferences(runtime),
              pinnedKeys: legacyModels,
            },
            runtime,
          );
          writeSessionPickerPreferences(
            { pinnedChatJids: legacySessions },
            runtime,
          );
        }
      }
    });
  };
  const onRefresh = () => {
    void refresh();
  };
  const onVisible = () => {
    if (!document.hidden) onRefresh();
  };
  runtime.addEventListener(PICKER_PIN_WRITE_EVENT, write);
  runtime.addEventListener(PICKER_PINS_CHANGED_EVENT, onRefresh);
  runtime.addEventListener("piclaw:sse-connected", onRefresh);
  window.addEventListener("focus", onRefresh);
  document.addEventListener("visibilitychange", onVisible);
  void refresh();
  return {
    refresh,
    stop: () => {
      stopped = true;
      runtime.removeEventListener(PICKER_PIN_WRITE_EVENT, write);
      runtime.removeEventListener(PICKER_PINS_CHANGED_EVENT, onRefresh);
      runtime.removeEventListener("piclaw:sse-connected", onRefresh);
      window.removeEventListener("focus", onRefresh);
      document.removeEventListener("visibilitychange", onVisible);
    },
  };
}
