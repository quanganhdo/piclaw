/** Coalesce cleanup requests and avoid synchronous reclamation during active work. */
export class MemoryReclamationGate {
  private pressureActive = false;
  private pending = false;
  private lastReclaimedAt: number | null = null;

  request(): void { this.pending = true; }

  shouldReclaim(options: { pressure: boolean; evicted: boolean; busy: boolean; now: number; intervalMs: number }): boolean {
    if (options.evicted || (options.pressure && !this.pressureActive)) this.pending = true;
    this.pressureActive = options.pressure;
    if (!this.pending || options.busy) return false;
    if (this.lastReclaimedAt !== null && options.now - this.lastReclaimedAt < options.intervalMs) return false;
    this.pending = false;
    this.lastReclaimedAt = options.now;
    return true;
  }
}
