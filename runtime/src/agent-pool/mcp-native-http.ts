import { StreamableHttpTransport, type McpTransport, type JsonRpcMessage } from '@earendil-works/pi-mcp';

/** Experimental HTTP uses bounded JSON responses only; streaming responses require Adapter. */
export function createNativeHttp(url: string, headers: Record<string, string>): McpTransport {
  const controller = new AbortController();
  const work = new Set<Promise<unknown>>();
  const cleanupFailures: unknown[] = [];
  const requests = new Map<string | number, AbortController>();
  let closing = false;
  const track = <T>(promise: Promise<T>, cleanup = false) => {
    work.add(promise);
    void promise.then(() => work.delete(promise), error => { work.delete(promise); if (cleanup) cleanupFailures.push(error); });
    return promise;
  };
  const fetchOwned: typeof fetch = Object.assign((input: RequestInfo | URL, init?: RequestInit) => track((async () => {
    if (closing) throw Error('Native HTTP is closing.');
    const target = new URL(input instanceof Request ? input.url : String(input));
    if (target.href !== new URL(url).href) throw Error('Native HTTP may contact only its configured endpoint.');
    let id: string | number | undefined;
    if (typeof init?.body === 'string') {
      const message = JSON.parse(init.body);
      if (typeof message.id === 'string' || typeof message.id === 'number') id = message.id;
    }
    const operation = id === undefined ? undefined : requests.get(id);
    const signals = [controller.signal, ...(init?.signal ? [init.signal] : []), ...(operation ? [operation.signal] : [])];
    const response = await fetch(input, { ...init, signal: AbortSignal.any(signals), redirect: 'error' });
    if (!response.body) return response;
    const reader = response.body.getReader();
    try {
      if (response.headers.get('content-type')?.includes('text/event-stream')) throw Error('Experimental Native HTTP requires JSON responses; use Adapter for SSE.');
      const chunks: Uint8Array[] = []; let bytes = 0;
      while (true) {
        const {done,value} = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 1024 * 1024) throw Error('Native HTTP response exceeds 1 MiB.');
        chunks.push(value);
      }
      return new Response(Buffer.concat(chunks), {status:response.status,statusText:response.statusText,headers:response.headers});
    } finally {
      // Retain cancellation failures even after the operation promise leaves work.
      await track(reader.cancel(), true); reader.releaseLock();
    }
  })()), { preconnect: () => { throw Error('Native HTTP preconnect is disabled.'); } }) as typeof fetch;
  const inner = new StreamableHttpTransport({url,headers,fetch:fetchOwned,openGetStream:false});
  let closed: Promise<void> | undefined;
  return {
    start: () => inner.start(),
    async send(message: JsonRpcMessage) {
      if (closing) throw Error('Native HTTP is closing.');
      if (Buffer.byteLength(JSON.stringify(message)) > 1024 * 1024) throw Error('Native HTTP request exceeds 1 MiB.');
      if ('method' in message && message.method === 'notifications/cancelled') {
        const id = (message.params as {requestId?:string|number} | undefined)?.requestId;
        if (id !== undefined) requests.get(id)?.abort();
        // Cancellation is local and bounded; do not create another unbounded POST.
        return;
      }
      const id = 'id' in message ? message.id : undefined;
      if (id !== undefined && id !== null) requests.set(id, new AbortController());
      try { await track(inner.send(message)); }
      finally { if (id !== undefined && id !== null) requests.delete(id); }
    },
    close() {
      if (!closed) {
        closing = true; controller.abort();
        closed = (async () => {
          await track(inner.close(), true);
          // fetch continuations/cancel finally blocks can add work during drain.
          while (work.size) await Promise.allSettled([...work]);
          if (cleanupFailures.length) throw cleanupFailures[0];
        })();
      }
      return closed;
    },
    onMessage: listener => inner.onMessage(listener), onError: listener => inner.onError(listener), onClose: listener => inner.onClose(listener),
    setProtocolVersion: version => inner.setProtocolVersion(version),
  };
}
