import { GpuMetricsCache, type GpuVramUsageSnapshot } from "./gpu-metrics-cache.js";

let cache: GpuMetricsCache | null = null;

/** Synchronous, cached HUD reader. First call starts asynchronous discovery and returns unavailable. */
export function readGpuVramUsage(): GpuVramUsageSnapshot | null {
  if (process.platform !== "linux" || !["x64", "arm64"].includes(process.arch)) return null;
  if (!cache) {
    cache = new GpuMetricsCache(() => new Worker(new URL("./gpu-metrics-worker.ts", import.meta.url).href, { smol: true, ref: false }));
    process.once("exit", () => cache?.dispose());
  }
  return cache.read();
}
