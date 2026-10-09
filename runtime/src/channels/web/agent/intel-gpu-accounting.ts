/** Linux DRM client accounting. No device handles, commands or process payloads. */
export interface IntelDevice { id: string; name: string; driver: "i915"; render_node: string }
export interface DrmClient {
  device: string;
  id: string;
  owners: string[];
  engines: Map<string, bigint>;
  capacities: Map<string, number>;
  regions: Map<string, { resident_bytes: number | null; total_bytes: number | null; shared_bytes: number | null }>;
  invalid: boolean;
}
export interface GpuCoverage {
  scope: "observed-clients";
  clients: number;
  scanned_processes: number;
  unreadable_processes: number;
  unreadable_clients: number;
  truncated: boolean;
}
export interface GpuHistory { timestamp_ms: number; busy_percent: number | null; resident_bytes: number | null }
export interface IntelGpuSnapshot {
  id: string; name: string; driver: "i915"; provider: "intel-drm-fdinfo";
  sample_time_ms: number | null;
  status: "ok" | "partial" | "unavailable" | "stale";
  reasons: string[];
  engines: Array<{ name: string; capacity: number; busy_percent: number | null }>;
  busy_percent: number | null;
  memory: { resident_bytes: number | null; total_bytes: number | null; shared_bytes: number | null; regions: Array<{ name: string; resident_bytes: number | null; total_bytes: number | null; shared_bytes: number | null }> };
  coverage: GpuCoverage;
  history: GpuHistory[];
}
export const emptyCoverage = (): GpuCoverage => ({ scope: "observed-clients", clients: 0, scanned_processes: 0, unreadable_processes: 0, unreadable_clients: 0, truncated: false });
const field = (text: string, key: string) => text.match(new RegExp(`^${key}:\\s*(\\S+)`, "m"))?.[1];

export function parseDrmClient(text: string, device: string, owner: string): DrmClient | null {
  if (field(text, "drm-driver") !== "i915" || field(text, "drm-pdev")?.toLowerCase() !== device.toLowerCase()) return null;
  const id = field(text, "drm-client-id");
  if (!id || !/^\d{1,30}$/.test(id)) return null;
  const client: DrmClient = { device, id, owners: [owner], engines: new Map(), capacities: new Map(), regions: new Map(), invalid: false };
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    const pair = line.match(/^(drm-[\w-]+):\s*(.*?)\s*$/);
    if (!pair) continue;
    const [, key, value] = pair;
    const engine = key.match(/^drm-engine-(?!capacity-)([\w-]{1,64})$/);
    const capacity = key.match(/^drm-engine-capacity-([\w-]{1,64})$/);
    const memory = key.match(/^drm-(resident|total|shared)-([\w-]{1,64})$/);
    if (!engine && !capacity && !memory) continue;
    if (seen.has(key)) { client.invalid = true; continue; }
    seen.add(key);
    if (engine) {
      const n = value.match(/^(\d{1,30}) ns$/);
      if (n) client.engines.set(engine[1], BigInt(n[1])); else client.invalid = true;
    } else if (capacity) {
      const n = Number(value);
      if (/^\d+$/.test(value) && Number.isSafeInteger(n) && n > 0 && n <= 1024) client.capacities.set(capacity[1], n);
      else client.invalid = true;
    } else if (memory) {
      const n = value.match(/^(\d{1,20})(?: (KiB|MiB))?$/);
      const bytes = n ? Number(n[1]) * (n[2] === "KiB" ? 1024 : n[2] === "MiB" ? 1024 ** 2 : 1) : NaN;
      const region = client.regions.get(memory[2]) ?? { resident_bytes: null, total_bytes: null, shared_bytes: null };
      if (Number.isSafeInteger(bytes) && bytes >= 0) region[`${memory[1]}_bytes` as keyof typeof region] = bytes;
      else client.invalid = true;
      client.regions.set(memory[2], region);
    }
  }
  return client;
}

type Previous = { client: DrmClient; engines: Map<string, { value: bigint; at: number; capacity: number }> };
function sumKnown(values: Array<number | null>): number | null {
  if (!values.length || values.some(v => v === null)) return null;
  const sum = values.reduce<number>((s, v) => s + v!, 0);
  return Number.isSafeInteger(sum) ? sum : null;
}

export class IntelGpuAccounting {
  private previous = new Map<string, Previous>();
  private histories = new Map<string, GpuHistory[]>();
  private lastMono: number | null = null;
  constructor(private readonly maxSamples = 30, private readonly intervalMs = 2000) {}
  reset(): void { this.previous.clear(); this.histories.clear(); this.lastMono = null; }

  sample(devices: IntelDevice[], readings: DrmClient[], coverage: GpuCoverage, mono: number, wall: number): IntelGpuSnapshot[] {
    const elapsed = this.lastMono === null ? 0 : mono - this.lastMono;
    if (elapsed <= 0 || elapsed > this.intervalMs * 2.5) this.previous.clear();
    // A DRM file shared by several descriptors/processes is one client. Keep one
    // reading (not a sum), but retain all owners for disappearance/reuse detection.
    const unique = new Map<string, DrmClient>();
    for (const reading of readings) {
      const key = `${reading.device}/${reading.id}`, prior = unique.get(key);
      if (prior) prior.owners.push(...reading.owners);
      else unique.set(key, { ...reading, owners: [...reading.owners] });
    }
    const next = new Map<string, Previous>();
    const result = devices.map(device => {
      const clients = [...unique.values()].filter(c => c.device === device.id);
      const reasons = new Set<string>();
      if (coverage.unreadable_processes) reasons.add("Some process descriptors are not accessible");
      if (coverage.unreadable_clients) reasons.add("Some client readings were lost or invalid");
      if (coverage.truncated) reasons.add("Discovery or sampling budget reached");
      if (!clients.length) reasons.add("No visible clients");
      const names = new Set(clients.flatMap(c => [...c.engines.keys()]));
      const engines = [...names].sort().map(name => {
        const contributors = clients.filter(c => c.engines.has(name));
        const capacities = new Set(contributors.map(c => c.capacities.get(name) ?? 1));
        const capacity = capacities.values().next().value ?? 1;
        let valid = capacities.size === 1, total = 0;
        if (!valid) reasons.add("Inconsistent engine capacity");
        for (const c of contributors) {
          const key = `${c.device}/${c.id}`;
          const prior = this.previous.get(key);
          const sameOwner = prior?.client.owners.some(o => c.owners.includes(o));
          const old = sameOwner ? prior?.engines.get(name) : undefined;
          const value = c.engines.get(name)!;
          let baseline = { value, at: mono, capacity: c.capacities.get(name) ?? 1 };
          if (c.invalid || !old || old.capacity !== baseline.capacity) {
            valid = false; reasons.add(c.invalid ? "Malformed client fields" : "Waiting for comparable engine samples");
          } else if (value < old.value) {
            baseline = old; valid = false; reasons.add("Engine counter moved backwards");
          } else if (old.at !== this.lastMono || elapsed <= 0) {
            valid = false; reasons.add("Engine counter recovered across a sampling gap");
          } else {
            const fraction = Number(value - old.value) / (elapsed * 1e6);
            if (!Number.isFinite(fraction) || fraction < 0 || fraction > capacity) {
              valid = false; reasons.add("Inconsistent engine interval");
            } else total += fraction;
          }
          let state = next.get(key);
          if (!state) { state = { client: c, engines: new Map() }; next.set(key, state); }
          state.engines.set(name, baseline);
        }
        if (total > capacity) { valid = false; reasons.add("Overlapping or inconsistent client engine time"); }
        return { name, capacity, busy_percent: valid ? Math.round(total / capacity * 1000) / 10 : null };
      });
      // A missing/invalid engine prevents a trustworthy busiest-class headline.
      const missingEngines = clients.some(c => c.engines.size === 0);
      const busy = engines.length && !missingEngines && engines.every(e => e.busy_percent !== null) ? Math.max(...engines.map(e => e.busy_percent!)) : null;
      if (clients.length && (!engines.length || missingEngines)) reasons.add("Engine accounting unavailable for some clients");
      if (clients.some(c => c.invalid)) reasons.add("Malformed client fields");
      const regionNames = new Set(clients.flatMap(c => [...c.regions.keys()]));
      const regions = [...regionNames].sort().map(name => ({ name,
        resident_bytes: sumKnown(clients.map(c => c.regions.get(name)?.resident_bytes ?? null)),
        total_bytes: sumKnown(clients.map(c => c.regions.get(name)?.total_bytes ?? null)),
        shared_bytes: sumKnown(clients.map(c => c.regions.get(name)?.shared_bytes ?? null)),
      }));
      const resident = sumKnown(regions.map(r => r.resident_bytes));
      if (clients.length && resident === null) reasons.add("Resident memory accounting unavailable");
      const history = [...(this.histories.get(device.id) ?? []), { timestamp_ms: wall, busy_percent: busy, resident_bytes: resident }].slice(-this.maxSamples);
      this.histories.set(device.id, history);
      return { id: device.id, name: device.name, driver: device.driver, provider: "intel-drm-fdinfo" as const,
        sample_time_ms: wall, status: !clients.length ? "unavailable" as const : reasons.size ? "partial" as const : "ok" as const,
        reasons: [...reasons], engines, busy_percent: busy,
        memory: { resident_bytes: resident, total_bytes: sumKnown(regions.map(r => r.total_bytes)), shared_bytes: sumKnown(regions.map(r => r.shared_bytes)), regions },
        coverage: { ...coverage, clients: clients.length }, history,
      };
    });
    for (const id of this.histories.keys()) if (!devices.some(d => d.id === id)) this.histories.delete(id);
    this.previous = next; this.lastMono = mono;
    return result;
  }
}
