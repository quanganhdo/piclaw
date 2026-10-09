/** Demand-driven, bounded Intel i915 fdinfo sampling for all meter consumers. */
import fs from "node:fs/promises";
import path from "node:path";
import { IntelGpuAccounting, emptyCoverage, parseDrmClient, type IntelDevice, type IntelGpuSnapshot, type GpuCoverage, type DrmClient } from "./intel-gpu-accounting.js";

export interface IntelScan { devices: IntelDevice[]; clients: DrmClient[]; coverage: GpuCoverage }
type Handle = { pid: string; start: string; fd: string; device: string };
export function procStartTime(stat: string): string | null {
  const close = stat.lastIndexOf(")");
  const start = close >= 0 ? stat.slice(close + 1).trim().split(/\s+/)[19] : undefined;
  return start && /^\d+$/.test(start) ? start : null;
}
async function readBounded(file: string, maxBytes = 16384): Promise<string> {
  const handle = await fs.open(file, "r");
  try {
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxBytes) throw new Error("GPU accounting file too large");
    return buffer.toString("utf8", 0, bytesRead);
  } finally { await handle.close(); }
}

export class IntelDrmReader {
  private devices: IntelDevice[] = [];
  private handles: Handle[] = [];
  private coverage = emptyCoverage();
  private nextDevices = 0;
  private nextClients = 0;
  private deviceScanIncomplete = false;
  constructor(private readonly procRoot = "/proc", private readonly drmRoot = "/sys/class/drm", private readonly now = () => performance.now(), private readonly platform = process.platform) {}
  async scan(): Promise<IntelScan> {
    if (this.platform !== "linux") return { devices: [], clients: [], coverage: emptyCoverage() };
    const start = this.now(), deadline = start + 150;
    let operations = 0;
    const withinBudget = () => ++operations <= 8192 && this.now() < deadline;
    if (start >= this.nextDevices) {
      const found: IntelDevice[] = [];
      this.deviceScanIncomplete = false;
      try {
        const dir = await fs.opendir(this.drmRoot);
        for await (const entry of dir) {
          if (!withinBudget() || found.length >= 8) { this.deviceScanIncomplete = true; break; }
          if (!/^renderD\d+$/.test(entry.name)) continue;
          const base = path.join(this.drmRoot, entry.name, "device");
          try {
            const vendor = (await readBounded(path.join(base, "vendor"), 128)).trim();
            const driver = path.basename(await fs.readlink(path.join(base, "driver")));
            if (vendor.toLowerCase() !== "0x8086" || driver !== "i915") continue;
            const uevent = await readBounded(path.join(base, "uevent"));
            const id = uevent.match(/^PCI_SLOT_NAME=([\da-f:.]+)$/mi)?.[1]?.toLowerCase();
            if (!id) continue;
            found.push({ id, name: `Intel GPU (${id})`, driver: "i915", render_node: entry.name });
          } catch { this.deviceScanIncomplete = true; }
        }
      } catch (error) {
        this.deviceScanIncomplete = (error as NodeJS.ErrnoException).code !== "ENOENT";
      }
      // An interrupted sysfs scan is not proof that known devices disappeared.
      this.devices = this.deviceScanIncomplete
        ? [...new Map([...this.devices, ...found].map(device => [device.id, device])).values()].slice(0, 8)
        : found;
      this.nextDevices = start + (this.deviceScanIncomplete ? 5000 : 30000);
      this.nextClients = 0;
    }
    if (!this.devices.length) { this.handles = []; return { devices: [], clients: [], coverage: emptyCoverage() }; }
    if (start >= this.nextClients) {
      const handles: Handle[] = [], coverage = emptyCoverage();
      try {
        const pids = await fs.opendir(this.procRoot);
        for await (const entry of pids) {
          if (!/^\d+$/.test(entry.name)) continue;
          if (!withinBudget() || coverage.scanned_processes >= 1024 || handles.length >= 256) { coverage.truncated = true; break; }
          coverage.scanned_processes++;
          const pid = entry.name, base = path.join(this.procRoot, pid);
          try {
            const fds = await fs.opendir(path.join(base, "fd"));
            let count = 0;
            let identity: string | null = null;
            for await (const fd of fds) {
              if (!withinBudget() || ++count > 512 || handles.length >= 256) { coverage.truncated = true; break; }
              if (!/^\d+$/.test(fd.name)) continue;
              try {
                const target = await fs.readlink(path.join(base, "fd", fd.name));
                const device = this.devices.find(d => target === `/dev/dri/${d.render_node}`);
                if (device) {
                  identity ??= procStartTime(await readBounded(path.join(base, "stat")));
                  if (identity) handles.push({ pid, start: identity, fd: fd.name, device: device.id });
                  else coverage.unreadable_clients++;
                }
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") coverage.unreadable_clients++;
              }
            }
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") coverage.unreadable_processes++;
          }
        }
      } catch { coverage.unreadable_processes++; }
      this.handles = handles; this.coverage = coverage;
      this.nextClients = start + 5000;
    }
    const coverage = { ...this.coverage, truncated: this.coverage.truncated || this.deviceScanIncomplete }, clients: DrmClient[] = [];
    // Group by PID so stat/read/stat protects against PID reuse while avoiding a
    // status read per descriptor. Only stat identity and DRM fdinfo are consumed.
    const groups = new Map<string, Handle[]>();
    for (const h of this.handles) groups.set(h.pid, [...(groups.get(h.pid) ?? []), h]);
    for (const [pid, handles] of groups) {
      if (!withinBudget()) { coverage.truncated = true; break; }
      const base = path.join(this.procRoot, pid), pending: DrmClient[] = [];
      try {
        const identity = procStartTime(await readBounded(path.join(base, "stat")));
        if (!identity || identity !== handles[0].start) { coverage.unreadable_clients++; this.nextClients = 0; continue; }
        for (const h of handles) {
          if (!withinBudget()) { coverage.truncated = true; break; }
          try {
            const c = parseDrmClient(await readBounded(path.join(base, "fdinfo", h.fd)), h.device, `${pid}:${identity}`);
            if (c) pending.push(c); else { coverage.unreadable_clients++; this.nextClients = 0; }
          } catch { coverage.unreadable_clients++; this.nextClients = 0; }
        }
        if (procStartTime(await readBounded(path.join(base, "stat"))) === identity) clients.push(...pending);
        else { coverage.unreadable_clients++; this.nextClients = 0; }
      } catch { coverage.unreadable_clients++; this.nextClients = 0; }
    }
    return { devices: this.devices, clients, coverage };
  }
}

export function staleGpuSnapshots(snapshots: IntelGpuSnapshot[], wall: number, staleMs = 6000): IntelGpuSnapshot[] {
  return snapshots.map(s => s.sample_time_ms !== null && wall - s.sample_time_ms > staleMs ? {
    ...s, status: "stale", busy_percent: null, engines: s.engines.map(e => ({ ...e, busy_percent: null })),
    memory: { ...s.memory, resident_bytes: null }, reasons: [...s.reasons, "GPU sample is stale"],
  } : s);
}

export class IntelGpuMetrics {
  private readonly accounting: IntelGpuAccounting;
  private snapshots: IntelGpuSnapshot[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<void> | null = null;
  private leaseUntil = 0;
  private stopped = false;
  constructor(
    private readonly reader: { scan(): Promise<IntelScan> } = new IntelDrmReader(),
    private readonly mono = () => performance.now(), private readonly wall = () => Date.now(),
    private readonly intervalMs = 2000, private readonly idleMs = 10000,
  ) { this.accounting = new IntelGpuAccounting(30, intervalMs); }
  /** Renew meter demand; return cached data immediately, never scan in a request. */
  read(): IntelGpuSnapshot[] {
    if (this.stopped) return [];
    this.leaseUntil = this.mono() + this.idleMs;
    if (!this.timer && !this.inflight) this.schedule(0);
    return structuredClone(staleGpuSnapshots(this.snapshots, this.wall(), this.intervalMs * 3));
  }
  private schedule(delay: number): void {
    this.timer = setTimeout(() => { this.timer = null; void this.tick(); }, delay);
    this.timer.unref?.();
  }
  private async tick(): Promise<void> {
    if (this.stopped || this.inflight || this.mono() >= this.leaseUntil) return;
    this.inflight = (async () => {
      try {
        const sample = await this.reader.scan();
        if (!this.stopped) this.snapshots = this.accounting.sample(sample.devices, sample.clients, sample.coverage, this.mono(), this.wall());
      } catch {
        this.accounting.reset();
        this.snapshots = this.snapshots.map(s => ({ ...s, status: "unavailable", busy_percent: null,
          engines: s.engines.map(e => ({ ...e, busy_percent: null })), memory: { ...s.memory, resident_bytes: null },
          reasons: ["GPU collection failed"],
        }));
      }
    })();
    await this.inflight; this.inflight = null;
    if (!this.stopped && this.mono() < this.leaseUntil) this.schedule(this.intervalMs);
  }
  stop(): void { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = null; this.snapshots = []; this.accounting.reset(); }
}
