import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import type { HarnessEvent } from "@earendil-works/pi-agent-core";

/** Test-only deterministic gate. It exposes no timer, network, or production authority. */
export interface DeterministicGate {
  readonly promise: Promise<void>;
  readonly released: boolean;
  release(): void;
}

export function createDeterministicGate(): DeterministicGate {
  let release!: () => void;
  let released = false;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return Object.freeze({
    promise,
    get released() { return released; },
    release() {
      if (released) return;
      released = true;
      release();
    },
  });
}

/** Records immutable selected-release events without retaining model/tool payloads. */
export interface HarnessEventReceipt {
  readonly type: HarnessEvent["type"];
  readonly lane: string | null;
  readonly runId: string | null;
  readonly recovery: boolean;
}

export class DeterministicHarnessEventLog {
  readonly #receipts: HarnessEventReceipt[] = [];

  readonly listener = (event: HarnessEvent, _context: Context): void => {
    this.#receipts.push(Object.freeze({
      type: event.type,
      lane: "lane" in event && typeof event.lane === "string" ? event.lane : null,
      runId: "runId" in event && typeof event.runId === "string" ? event.runId : null,
      recovery: "recovery" in event && event.recovery === true,
    }));
  };

  snapshot(): readonly HarnessEventReceipt[] {
    return Object.freeze(this.#receipts.map((receipt) => Object.freeze({ ...receipt })));
  }

  types(): readonly HarnessEvent["type"][] {
    return Object.freeze(this.#receipts.map((receipt) => receipt.type));
  }
}
