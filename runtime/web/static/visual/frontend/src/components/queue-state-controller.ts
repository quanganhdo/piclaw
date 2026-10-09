export interface QueueStateItem {
  row_id: number;
  content: string;
  timestamp?: string;
}

/** Reconcile durable snapshots without reviving rows from an older GET. */
export function createQueueStateController(options: {
  chatJid: string;
  isCurrent: () => boolean;
  request: (signal: AbortSignal) => Promise<unknown>;
  publish: (items: QueueStateItem[]) => void;
  onError: () => void;
}) {
  let items: QueueStateItem[] = [];
  let generation = 0, stopped = false, mutating = false, again = false;
  let pending: Promise<void> | null = null;
  let abort: AbortController | null = null;
  const active = () => !stopped && options.isCurrent();
  const emit = () => { if (active()) options.publish([...items]); };
  const valid = (item: any): item is QueueStateItem => !!item
    && Number.isSafeInteger(item.row_id) && item.row_id !== 0
    && typeof item.content === 'string' && !!item.content.trim();
  const belongs = (value: any) => active() && value?.chat_jid === options.chatJid
    && Number.isSafeInteger(value?.row_id) && value.row_id !== 0;

  function refresh(): Promise<void> {
    if (!active()) return Promise.resolve();
    if (mutating) { again = true; return Promise.resolve(); }
    if (pending) {
      generation++;
      abort?.abort();
      again = true;
      return pending;
    }
    const version = generation;
    abort = new AbortController();
    pending = (async () => {
      try {
        const value = await options.request(abort!.signal) as any;
        if (!active() || mutating || generation !== version || abort!.signal.aborted) return;
        if (!value || !Array.isArray(value.items) || !Number.isSafeInteger(value.count)
          || value.count !== value.items.length || value.items.some((item: unknown) => !valid(item))) {
          throw Error('Invalid queue state');
        }
        const unique = new Map<number, QueueStateItem>();
        for (const item of value.items) {
          unique.set(item.row_id, {
            row_id: item.row_id,
            content: item.content,
            ...(typeof item.timestamp === 'string' ? { timestamp: item.timestamp } : {}),
          });
        }
        if (unique.size !== value.items.length) throw Error('Duplicate queue rows');
        items = [...unique.values()];
        emit();
      } catch {
        if (active() && generation === version && !abort!.signal.aborted) options.onError();
      } finally {
        pending = null;
        if (again && active() && !mutating) { again = false; void refresh(); }
      }
    })();
    return pending;
  }

  function changed() { generation++; abort?.abort(); void refresh(); }
  return {
    refresh,
    queued(value: any) {
      if (!belongs(value) || !valid(value)) return;
      if (!items.some(item => item.row_id === value.row_id)) {
        items = [...items, { row_id: value.row_id, content: value.content, timestamp: value.timestamp }];
      }
      emit();
      changed();
    },
    removed(value: any) {
      if (!belongs(value)) return;
      items = items.filter(item => item.row_id !== value.row_id);
      emit();
      changed();
    },
    async mutate(operation: () => Promise<void>, removeRowId?: number): Promise<boolean> {
      if (!active() || mutating) return false;
      mutating = true;
      generation++;
      abort?.abort();
      try {
        await operation();
        if (!active()) return false;
        if (removeRowId !== undefined) {
          items = items.filter(item => item.row_id !== removeRowId);
          emit();
        }
        return true;
      } finally {
        generation++;
        mutating = false;
        again = false;
        if (active()) void refresh();
      }
    },
    stop() { stopped = true; generation++; again = false; abort?.abort(); },
  };
}
