/** One demand-driven worker and cache for all HUD clients; no native calls on the HTTP thread. */
import { createLogger, debugSuppressedError } from "../../../utils/logger.js";
const log = createLogger("gpu-metrics-cache");
export interface GpuVramUsageSnapshot {
  totalBytes: number;
  usedBytes: number;
  percent: number;
  provider: string;
}

export interface GpuMetricsWorker {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

const SAMPLE_MS = 2000;
const STALE_MS = 5000;
const RETRY_MS = 60000;

export function validGpuSnapshot(value: unknown): value is GpuVramUsageSnapshot {
  if (!value || typeof value !== "object") return false;
  const s = value as GpuVramUsageSnapshot;
  return Number.isSafeInteger(s.totalBytes) && s.totalBytes > 0 &&
    Number.isSafeInteger(s.usedBytes) && s.usedBytes >= 0 && s.usedBytes <= s.totalBytes &&
    Number.isFinite(s.percent) && s.percent >= 0 && s.percent <= 100 &&
    Math.abs(s.percent - (s.usedBytes / s.totalBytes) * 100) <= 0.051 &&
    (s.provider === "nvml" || s.provider === "nvml-v1");
}

export class GpuMetricsCache {
  private worker: GpuMetricsWorker | null = null;
  private snapshot: GpuVramUsageSnapshot | null = null;
  private capturedAt = -Infinity;
  private nextAt = 0;
  private pending: { id: number; startedAt: number } | null = null;
  private sequence = 0;
  private disabled = false;

  constructor(
    private readonly createWorker: () => GpuMetricsWorker,
    private readonly now: () => number = () => performance.now(),
  ) {}

  read(): GpuVramUsageSnapshot | null {
    const now = this.now();
    if (!this.disabled && !this.pending && now >= this.nextAt) {
      try {
        if (!this.worker) {
          const worker = this.createWorker();
          this.worker = worker;
          worker.onmessage = (event) => {
            if (this.worker !== worker || !this.pending || event.data?.id !== this.pending.id) return;
            const receivedAt = this.now();
            const fresh = receivedAt - this.pending.startedAt < STALE_MS;
            this.pending = null;
            this.snapshot = fresh && validGpuSnapshot(event.data.snapshot) ? { ...event.data.snapshot } : null;
            this.capturedAt = receivedAt;
            this.nextAt = receivedAt + (this.snapshot ? SAMPLE_MS : RETRY_MS);
          };
          worker.onerror = (event) => {
            event.preventDefault?.();
            // A broken worker/native runtime must not cause a restart storm. Process restart resets this circuit.
            this.dispose();
          };
        }
        this.pending = { id: ++this.sequence, startedAt: now };
        this.worker.postMessage({ type: "sample", id: this.sequence });
      } catch {
        if (this.worker) this.dispose();
        else this.nextAt = now + RETRY_MS;
      }
    }
    // A stuck native call stays single-flight. Never terminate-and-replace it repeatedly.
    if (this.disabled || now - this.capturedAt >= STALE_MS || (this.pending && now - this.pending.startedAt >= STALE_MS)) return null;
    return this.snapshot ? { ...this.snapshot } : null;
  }

  dispose(): void {
    this.disabled = true;
    this.snapshot = null;
    this.pending = null;
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      try { worker.postMessage({ type: "close" }); } catch (error) { debugSuppressedError(log, "GPU worker already stopped during disposal.", error, {}); }
      // Do not force-terminate a worker inside a native call. It is unreferenced and closes when the call returns.
    }
  }
}
