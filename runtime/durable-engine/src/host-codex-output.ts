/** Operation-local raw output observation. Sink owns durable/UI projection, never a session event shim. */
export interface CodexOutputOperation {
  id: string; sessionId: string; provider: string; model: string; api: string;
  signal: AbortSignal; assertCurrent(): void;
}
export interface CodexOutputPorts<Event> {
  observe(operation: Readonly<CodexOutputOperation>, event: Event, beforeEffect: () => void): Promise<void>;
  flush(sessionId: string): Promise<void>;
}
export function createHostCodexOutput<Event>(ports: CodexOutputPorts<Event>) {
  const operations = new Map<string, { sessionId: string; tail: Promise<void>; closed: boolean }>();
  let disposed = false;
  const flush = async (sessionId: string) => {
    await Promise.all([...operations.values()].filter(o => o.sessionId === sessionId).map(o => o.tail));
    await ports.flush(sessionId);
  };
  return {
    open(operation: CodexOutputOperation) {
      if (disposed || operations.has(operation.id)) throw new Error('Codex output lifetime unavailable');
      const scope = Object.freeze({ ...operation });
      const state = { sessionId: scope.sessionId, tail: Promise.resolve(), closed: false };
      const check = () => {
        if (disposed || state.closed) throw new Error('Codex output operation closed');
        scope.signal.throwIfAborted(); scope.assertCurrent();
        if (scope.provider !== 'openai-codex' || scope.api !== 'openai-codex-responses') throw new Error('Wrong output owner');
      };
      check(); operations.set(scope.id, state);
      return {
        observe(event: Event) {
          check();
          state.tail = state.tail.then(() => {
            // Closing intake must not expire already admitted work; revocation must.
            scope.signal.throwIfAborted(); scope.assertCurrent();
            return ports.observe(scope, event, () => { scope.signal.throwIfAborted(); scope.assertCurrent(); });
          });
          void state.tail.catch(() => {});
          return state.tail;
        },
        async end() {
          state.closed = true;
          // Keep failed work visible to subsequent shutdown/dispose; never silently drop it.
          await state.tail; await ports.flush(scope.sessionId); operations.delete(scope.id);
        },
      };
    },
    flush,
    async shutdown(sessionId: string) {
      for (const state of operations.values()) if (state.sessionId === sessionId) state.closed = true;
      await flush(sessionId);
      for (const [id, state] of operations) if (state.sessionId === sessionId) operations.delete(id);
    },
    async dispose() {
      disposed = true;
      for (const state of operations.values()) state.closed = true;
      for (const session of new Set([...operations.values()].map(o => o.sessionId))) await flush(session);
      operations.clear();
    },
  };
}
