import type { JsonRpcMessage, McpTransport } from '@earendil-works/pi-mcp';

const deniedMethods = new Set(['resources/list', 'resources/templates/list', 'resources/read', 'resources/subscribe', 'resources/unsubscribe', 'prompts/list', 'prompts/get']);

/** Enforce the tool-only experimental profile below the Native discovery/UI layer. */
export function constrainNativeTransport(transport: McpTransport) {
  let closePromise: Promise<void> | undefined;
  let closing = false;
  const pendingReplies = new Set<Promise<void>>();
  const replyFailures: unknown[] = [];
  let closeFailure: unknown;
  const wrapped: McpTransport = {
    start: () => transport.start(),
    async send(message) {
      if ('method' in message && deniedMethods.has(message.method)) throw new Error('Native experimental profile disables resources and prompts.');
      await transport.send(message);
    },
    close() {
      // Publish one raw-close obligation. A suppressed upstream error cannot erase it.
      if (!closePromise) {
        closing = true;
        closePromise = (async () => {
          const closed = Promise.resolve().then(() => transport.close());
          const results = await Promise.allSettled([closed, ...pendingReplies]);
          const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
          if (failed) throw failed.reason;
          if (replyFailures.length) throw replyFailures[0];
        })();
        // Native may suppress this rejection; retain it independently until host shutdown awaits close.
        void closePromise.catch(error => { closeFailure = error; });
      }
      return closePromise;
    },
    onMessage(listener) {
      return transport.onMessage((message: JsonRpcMessage) => {
        const record = message as unknown as Record<string, unknown>;
        if (!record || typeof record !== 'object' || Array.isArray(record)) {
          replyFailures.push(new Error('Native MCP returned a malformed JSON-RPC envelope.'));
          void wrapped.close().catch(failure => { closeFailure = failure; });
          return;
        }
        const method = Object.hasOwn(record, 'method');
        const result = Object.hasOwn(record, 'result');
        const error = Object.hasOwn(record, 'error');
        if (record.jsonrpc !== '2.0' || (method && (typeof record.method !== 'string' || result || error)) || (!method && (result === error || !Object.hasOwn(record, 'id'))) || ('id' in record && record.id !== null && typeof record.id !== 'string' && typeof record.id !== 'number') || (error && (!record.error || typeof record.error !== 'object' || typeof (record.error as any).code !== 'number' || typeof (record.error as any).message !== 'string'))) {
          replyFailures.push(new Error('Native MCP returned an ambiguous or malformed JSON-RPC envelope.'));
          void wrapped.close().catch(failure => { closeFailure = failure; });
          return;
        }
        // Strip capabilities on every response, including initialize. Never expose
        // resource/prompt discovery even when a server advertises those surfaces.
        if ('result' in message && message.result && typeof message.result === 'object' && 'capabilities' in message.result) {
          const result = message.result as Record<string, unknown>;
          const capabilities = result.capabilities;
          if (capabilities && typeof capabilities === 'object' && !Array.isArray(capabilities)) {
            const { resources: _resources, prompts: _prompts, ...toolsOnly } = capabilities as Record<string, unknown>;
            listener({ ...message, result: { ...result, capabilities: toolsOnly } });
            return;
          }
        }
        if ('method' in message && /^(?:notifications\/(?:resources|prompts)\/|sampling\/|elicitation\/)/.test(message.method)) {
          if ('id' in message && !closing) {
            const pending = Promise.resolve().then(() => transport.send({ jsonrpc: '2.0', id: message.id!, error: { code: -32601, message: 'Method disabled by Native experimental profile.' } }));
            pendingReplies.add(pending);
            void pending.then(() => pendingReplies.delete(pending), error => { pendingReplies.delete(pending); replyFailures.push(error); });
          }
          return;
        }
        listener(message);
      });
    },
    onError: listener => transport.onError(listener),
    onClose: listener => transport.onClose(listener),
    setProtocolVersion: version => transport.setProtocolVersion?.(version),
  };
  return { transport: wrapped, close: () => wrapped.close(), get closeFailure() { return closeFailure; } };
}
