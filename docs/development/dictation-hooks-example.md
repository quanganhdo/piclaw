# Connected dictation hook example

A self-contained add-on can import types from `piclaw/runtime/public/addon-hooks` with TypeScript bundler module resolution. The declaration file ships in the package and has no private source dependencies. Feature-detect both version-1 APIs; these hooks are not available on older installed cores merely because a source PR merged.

The browser entry exports `register(api)`. Registering does not enable capture. The add-on's existing settings/config action persists opt-in, then calls `selectComposerDictationProvider(id)`; disabling selects `null`. Core retains its mic and Send controls.

```ts
import type { ComposerDictationAddonApi } from 'piclaw/runtime/public/addon-hooks';

export function register(api: ComposerDictationAddonApi) {
  const unregister = api.registerComposerDictationProvider({
    id: 'server-dictation', label: 'Server dictation',
    availability: () => ({ available: Boolean(navigator.mediaDevices?.getUserMedia) }),
    async start(context) {
      // These are add-on-owned adapters, not Piclaw APIs or private core imports.
      const capture = await openCapture({ signal: context.signal });
      const socket = await openAuthenticatedSocket({
        url: `/agent/addons/server-dictation/realtime?chat_jid=${encodeURIComponent(context.chatJid)}`,
        signal: context.signal,
      });
      const stopForwarding = capture.onFrame(bytes => socket.sendOrdered(bytes));
      socket.onSegment(segment => context.updateSegment(segment));
      let cleanup: Promise<void> | undefined;
      const cancel = () => cleanup ??= (async () => {
        stopForwarding(); await capture.cancel(); await socket.dispose();
      })();
      return {
        async finish() {
          await capture.stop();       // No new audio after this resolves.
          await socket.drainAudio();  // All accepted frames processed in order.
          await socket.finish();      // Wait for final segments, not merely an ACK.
          stopForwarding(); await socket.dispose();
          return { status: 'finished' as const };
        },
        cancel,
      };
    },
  });
  // Existing config UI only, after persisted user opt-in:
  // api.selectComposerDictationProvider('server-dictation');
  return unregister;
}
```

The adapter's `finish()` must settle only after `onSegment` has applied final text. It must reject recogniser errors. Socket close alone cannot signal successful finishing. Partial and final segments use the same stable ID; core owns revision-safe insertion and submission. No DOM interception or direct Send call belongs in this entry. The capture/socket adapters must honour cancellation, clean up failed startup and never log audio, transcripts or credentials.

The runtime startup entry uses `globalThis.__piclaw_runtime.authenticatedSockets`:

```ts
import type { AuthenticatedSocketAddonApi } from 'piclaw/runtime/public/addon-hooks';
const sockets = (globalThis as typeof globalThis & {
  __piclaw_runtime?: { authenticatedSockets?: AuthenticatedSocketAddonApi }
}).__piclaw_runtime?.authenticatedSockets;
if (sockets?.version !== 1) throw new Error('Authenticated socket hooks v1 required');
const unregister = sockets.register({
  path: 'realtime', maxMessageBytes: 65536, maxQueuedBytes: 262144,
  maxSessionMs: 60000, maxConnections: 1,
  async authorize({ request, signal }) {
    // Validate protocol/query fields. Core resolves this chat and workspace;
    // the supplied chat ID itself is not authority.
    const chatJid = new URL(request.url).searchParams.get('chat_jid');
    if (!chatJid) throw new Error('Missing chat');
    return { chatJid };
  },
  async open({ scope, signal, send }) {
    const recogniser = await openPrivateRecogniser({ scope, signal });
    recogniser.onSegment(segment => send(JSON.stringify(segment)));
    return {
      async message(frame) {
        if (typeof frame === 'string') await recogniser.control(JSON.parse(frame));
        else await recogniser.audio(frame);
      },
      async dispose() { await recogniser.dispose(); },
    };
  },
});
```

`openCapture`, `openAuthenticatedSocket` and `openPrivateRecogniser` are deliberately unspecified add-on interfaces. This example connects ownership and final-drain semantics; it installs no recogniser, model, inference service or extra listener. Use same-origin cookie authentication over WSS, validate controls and await every send. Core fails closed for unsupported access modes and retains connection capacity through actual cleanup.
