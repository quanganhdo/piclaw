export interface DisplayUpdateCoalescer {
  queue(
    key: string,
    payload: Record<string, unknown>,
    emit: (payload: Record<string, unknown>) => void,
    options?: { mergeDelta?: boolean },
  ): void;
  emitImmediate(payload: Record<string, unknown>, emit: (payload: Record<string, unknown>) => void): void;
  flush(): void;
}

interface PendingDisplayUpdate {
  payload: Record<string, unknown>;
  emit: (payload: Record<string, unknown>) => void;
}

/**
 * Limit replaceable display payloads while preserving ordered text deltas.
 * Lifecycle callers use emitImmediate()/flush() so terminal state never waits
 * behind the cadence timer.
 */
export function createDisplayUpdateCoalescer(options: {
  intervalMs: number;
  order: readonly string[];
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancel?: (timer: unknown) => void;
}): DisplayUpdateCoalescer {
  const intervalMs = Math.max(0, options.intervalMs);
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const cancel = options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const rank = new Map(options.order.map((key, index) => [key, index]));
  const pending = new Map<string, PendingDisplayUpdate>();
  let timer: unknown | null = null;
  let lastFlushAt = 0;

  const flush = () => {
    if (timer !== null) cancel(timer);
    timer = null;
    if (pending.size === 0) return;
    const updates = [...pending.entries()].sort(([left], [right]) =>
      (rank.get(left) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right) ?? Number.MAX_SAFE_INTEGER));
    pending.clear();
    lastFlushAt = now();
    for (const [, update] of updates) update.emit(update.payload);
  };

  const scheduleFlush = () => {
    if (timer !== null || intervalMs <= 0) return;
    const elapsed = Math.max(0, now() - lastFlushAt);
    timer = schedule(flush, Math.max(0, intervalMs - elapsed));
  };

  const queue: DisplayUpdateCoalescer["queue"] = (key, payload, emit, queueOptions = {}) => {
    if (intervalMs <= 0) {
      emit(payload);
      return;
    }
    const timestamp = now();
    if (pending.size === 0 && timer === null && (!lastFlushAt || timestamp - lastFlushAt >= intervalMs)) {
      lastFlushAt = timestamp;
      emit(payload);
      return;
    }
    const existing = pending.get(key);
    if (queueOptions.mergeDelta && existing && !payload.reset) {
      const priorDelta = typeof existing.payload.delta === "string" ? existing.payload.delta : "";
      const nextDelta = typeof payload.delta === "string" ? payload.delta : "";
      existing.payload = { ...existing.payload, ...payload, delta: `${priorDelta}${nextDelta}` };
    } else {
      pending.set(key, { payload, emit });
    }
    scheduleFlush();
  };

  const emitImmediate: DisplayUpdateCoalescer["emitImmediate"] = (payload, emit) => {
    flush();
    emit(payload);
    lastFlushAt = now();
  };

  return { queue, emitImmediate, flush };
}
