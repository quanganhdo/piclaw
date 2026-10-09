import type { NvmlReader, NvmlReadSnapshot } from "./nvml-reader.js";
import { createLogger, debugSuppressedError } from "../../../utils/logger.js";
const log = createLogger("nvml-poller");

/** Worker-owned driver lifecycle. Failures and absent cards release state and retry after one minute. */
export class NvmlPoller {
  private reader: NvmlReader | null = null;
  private nextAt = 0;
  private closed = false;
  constructor(
    private readonly create: () => Promise<NvmlReader>,
    private readonly now: () => number = () => performance.now(),
  ) {}
  async sample(): Promise<NvmlReadSnapshot | null> {
    if (this.closed || this.now() < this.nextAt) return null;
    try {
      if (!this.reader) this.reader = await this.create();
      if (this.closed) { this.release(); return null; }
      const snapshot = this.reader.read();
      if (snapshot) return snapshot;
    } catch (error) { debugSuppressedError(log, "GPU telemetry unavailable; retrying after backoff.", error, {}); }
    this.nextAt = this.now() + 60000;
    this.release();
    return null;
  }
  close(): void { this.closed = true; this.release(); }
  private release(): void {
    const reader = this.reader;
    this.reader = null;
    try { reader?.close(); } catch (error) { debugSuppressedError(log, "GPU telemetry cleanup failed.", error, {}); }
  }
}
