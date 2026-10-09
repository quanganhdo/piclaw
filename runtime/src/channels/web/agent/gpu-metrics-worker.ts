/// <reference lib="webworker" />
/** NVML state is owned exclusively by this worker. Driver errors never escape into the server. */
import { NvmlPoller } from "./nvml-poller.js";
const poller = new NvmlPoller(async () => (await import("./nvml-reader.js")).createNvmlReader());
let busy = false;
let closed = false;
self.onmessage = async (event: MessageEvent) => {
  if (event.data?.type === "close") {
    closed = true;
    if (!busy) { poller.close(); self.close(); }
    return;
  }
  if (event.data?.type !== "sample" || !Number.isSafeInteger(event.data.id) || busy || closed) return;
  const id = event.data.id;
  busy = true;
  const snapshot = await poller.sample();
  busy = false;
  if (closed) { poller.close(); self.close(); return; }
  self.postMessage({ id, snapshot });
};
