#!/usr/bin/env bun

import { createConnection, type Socket } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    closeHarnessWebSocket,
    destroyHarnessUpstream,
    parseHarnessControlMessage,
    sendHarnessPayload,
} from './vnc-harness-bridge-helpers.ts';

const DEFAULT_TARGET = "";
const DEFAULT_PASSWORD = "";
const DEFAULT_PORT = 8791;
const DEFAULT_HOST = '127.0.0.1';

type HarnessSocketData = {
    upstream?: Socket | null;
    bytesIn?: number;
    bytesOut?: number;
};

function parseArgs(argv: string[]) {
    const args = {
        host: process.env.VNC_HARNESS_HOST || DEFAULT_HOST,
        port: Number(process.env.VNC_HARNESS_PORT || DEFAULT_PORT),
        target: process.env.VNC_HARNESS_TARGET || DEFAULT_TARGET,
        password: process.env.VNC_HARNESS_PASSWORD || DEFAULT_PASSWORD,
    };

    for (let i = 0; i < argv.length; i += 1) {
        const value = argv[i];
        const next = i + 1 < argv.length ? argv[i + 1] : '';
        if (value === '--host' && next) {
            args.host = next;
            i += 1;
            continue;
        }
        if (value === '--port' && next) {
            args.port = Number(next || DEFAULT_PORT);
            i += 1;
            continue;
        }
        if (value === '--target' && next) {
            args.target = next;
            i += 1;
            continue;
        }
        if (value === '--password' && next) {
            args.password = next;
            i += 1;
            continue;
        }
    }
    if (!Number.isFinite(args.port) || args.port <= 0 || args.port > 65535) {
        throw new Error(`Invalid --port value: ${args.port}`);
    }
    return args;
}

function parseTarget(target: string) {
    const text = String(target || '').trim();
    const ipv6 = /^\[([^\]]+)\]:(\d+)$/.exec(text);
    if (ipv6) {
        return { host: ipv6[1], port: Number(ipv6[2]), label: text };
    }
    const first = text.indexOf(':');
    const last = text.lastIndexOf(':');
    if (first <= 0 || first !== last) {
        throw new Error(`Invalid --target value: ${text}. Expected host:port or [ipv6]:port`);
    }
    const host = text.slice(0, last).trim();
    const port = Number(text.slice(last + 1));
    if (!host || !Number.isFinite(port) || port <= 0 || port > 65535) {
        throw new Error(`Invalid --target value: ${text}. Expected host:port or [ipv6]:port`);
    }
    return { host, port, label: text };
}

function getPaths() {
    const scriptDir = dirname(fileURLToPath(import.meta.url));
    return {
        scriptDir,
        harnessEntry: resolve(scriptDir, '../web/src/vnc-harness.ts'),
        decoderWasm: resolve(scriptDir, '../web/static/common/js/vendor/remote-display-decoder.wasm'),
    };
}

async function buildHarnessBundle(entry: string) {
    const result = await Bun.build({
        entrypoints: [entry],
        target: 'browser',
        format: 'esm',
        minify: false,
        sourcemap: 'inline',
    });
    if (!result.success || !result.outputs?.length) {
        const logs = (result.logs || []).map((item) => item?.message || String(item)).join('\n');
        throw new Error(`Failed to build vnc-harness bundle:\n${logs}`);
    }
    return await result.outputs[0].text();
}

function buildHarnessHtml({ target, password }: { target: string; password: string }) {
    const encodedTarget = encodeURIComponent(target);
    const encodedPassword = encodeURIComponent(password || '');
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>PiClaw VNC Harness</title>
    <style>
      :root {
        color-scheme: dark;
        --bg:#0b1020;
        --card:#151b2f;
        --muted:#92a1c6;
        --text:#e7ecff;
        --accent:#7aa2ff;
        --border:#2a355b;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
        background: linear-gradient(160deg, #0b1020 0%, #101933 100%);
        color: var(--text);
      }
      main {
        width: min(1200px, 96vw);
        margin: 16px auto 32px;
        display: grid;
        gap: 12px;
      }
      .card {
        background: color-mix(in oklab, var(--card), black 8%);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 12px;
      }
      .controls {
        display: grid;
        gap: 10px;
        grid-template-columns: 2fr 1fr auto auto auto;
        align-items: end;
      }
      label { display: grid; gap: 5px; font-size: 12px; color: var(--muted); }
      input, button {
        border: 1px solid var(--border);
        border-radius: 9px;
        padding: 8px 10px;
        font: inherit;
        color: var(--text);
        background: #0d1327;
      }
      button { cursor: pointer; }
      button:hover { border-color: color-mix(in oklab, var(--accent), white 14%); }
      .status { color: var(--accent); font-size: 13px; }
      .meta, .summary { color: var(--muted); font: 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; white-space: pre-wrap; }
      .stage {
        min-height: 420px;
        border: 1px solid var(--border);
        border-radius: 12px;
        background: #05070f;
        display: grid;
        place-items: center;
        position: relative;
        overflow: hidden;
      }
      canvas {
        display: none;
        max-width: 100%;
        max-height: 100%;
        image-rendering: pixelated;
        background: #000;
      }
      .placeholder {
        color: #b3bedf;
        text-align: center;
        max-width: 520px;
        line-height: 1.5;
      }
      .placeholder .emoji { font-size: 40px; }
      .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      pre {
        margin: 0;
        max-height: 340px;
        overflow: auto;
        border-radius: 8px;
        background: #050814;
        border: 1px solid var(--border);
        padding: 10px;
        color: #cdd8fb;
        font: 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }
    </style>
  </head>
  <body>
    <main>
      <section class="card">
        <div class="controls">
          <label>Target
            <input data-target value="${target}" spellcheck="false" />
          </label>
          <label>Password
            <input data-password value="${password}" type="password" spellcheck="false" />
          </label>
          <button data-connect>Connect</button>
          <button data-disconnect>Disconnect</button>
          <button data-run-synthetic>Run synthetic suite</button>
        </div>
      </section>

      <section class="card">
        <div class="status" data-status>Booting harness…</div>
        <div class="meta" data-meta></div>
      </section>

      <section class="card stage">
        <canvas data-display-canvas width="1" height="1"></canvas>
        <div class="placeholder" data-placeholder>
          <div class="emoji">🖥️</div>
          <div>Standalone VNC harness is ready.</div>
          <div>Auto-connecting to ${target} through local WebSocket bridge.</div>
        </div>
      </section>

      <section class="grid2">
        <section class="card">
          <h3 style="margin:0 0 8px; font-size:14px;">Live summary</h3>
          <div class="summary" data-live-summary>pending…</div>
        </section>
        <section class="card">
          <h3 style="margin:0 0 8px; font-size:14px;">Synthetic encoder suite</h3>
          <div class="summary" data-synthetic>not run</div>
        </section>
      </section>

      <section class="card">
        <h3 style="margin:0 0 8px; font-size:14px;">Event log</h3>
        <pre data-events></pre>
      </section>
    </main>

    <script type="module" src="/harness.js?target=${encodedTarget}&password=${encodedPassword}"></script>
    <script>
      // Ensure harness uses local standalone bridge and autoconnects.
      const url = new URL(window.location.href);
      if (!url.searchParams.get('target')) url.searchParams.set('target', '${target}');
      if (!url.searchParams.get('password')) url.searchParams.set('password', '${password}');
      url.searchParams.set('ws', '/bridge');
      url.searchParams.set('autoconnect', '1');
      window.history.replaceState({}, '', url);
    </script>
  </body>
</html>`;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (process.env.PICLAW_E2E_DISPOSABLE !== '1' || !args.target) throw new Error('VNC harness requires an explicit disposable target and PICLAW_E2E_DISPOSABLE=1.');
    if (!['127.0.0.1', 'localhost', '::1'].includes(args.host)) throw new Error('VNC test harness must bind loopback.');
    const parsedTarget = parseTarget(args.target);
    const paths = getPaths();
    const harnessBundle = await buildHarnessBundle(paths.harnessEntry);
    const html = buildHarnessHtml({ target: args.target, password: args.password });

    const server = Bun.serve<HarnessSocketData>({
        hostname: args.host,
        port: args.port,
        idleTimeout: 120,
        async fetch(req, serverRef) {
            const url = new URL(req.url);
            if (url.pathname === '/') {
                return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
            }
            if (url.pathname === '/harness.js') {
                return new Response(harnessBundle, { headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' } });
            }
            if (url.pathname === '/static/common/js/vendor/remote-display-decoder.wasm') {
                const wasmFile = Bun.file(paths.decoderWasm);
                if (!(await wasmFile.exists())) {
                    return new Response('WASM decoder not found', { status: 404 });
                }
                return new Response(wasmFile, {
                    headers: {
                        'content-type': 'application/wasm',
                        'cache-control': 'no-store',
                    },
                });
            }
            if (url.pathname === '/bridge') {
                if (!serverRef.upgrade(req, { data: { bytesIn: 0, bytesOut: 0, upstream: null } })) {
                    return new Response('WebSocket upgrade failed', { status: 400 });
                }
                return undefined;
            }
            if (url.pathname === '/healthz') {
                return Response.json({ ok: true, target: parsedTarget.label, now: new Date().toISOString() });
            }
            return new Response('Not found', { status: 404 });
        },
        websocket: {
            open(ws) {
                const upstream = createConnection({ host: parsedTarget.host, port: parsedTarget.port });
                ws.data.upstream = upstream;

                upstream.on('connect', () => {
                    sendHarnessPayload(
                        ws,
                        JSON.stringify({ type: 'vnc.connected', target: { id: parsedTarget.label, label: parsedTarget.label } }),
                        { target: parsedTarget.label, eventType: 'vnc.connected' },
                    );
                });

                upstream.on('data', (chunk) => {
                    const byteLength = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.byteLength;
                    ws.data.bytesIn = Number(ws.data.bytesIn || 0) + byteLength;
                    sendHarnessPayload(ws, chunk, { target: parsedTarget.label, eventType: 'vnc.data', byteLength });
                });

                upstream.on('error', (error) => {
                    const message = error instanceof Error ? error.message : String(error || 'Unknown upstream error');
                    sendHarnessPayload(ws, JSON.stringify({ type: 'vnc.error', error: message }), {
                        target: parsedTarget.label,
                        eventType: 'vnc.error',
                    });
                    closeHarnessWebSocket(ws, 1011, 'upstream-error', { target: parsedTarget.label });
                });

                upstream.on('close', () => {
                    closeHarnessWebSocket(ws, 1000, 'upstream-closed', { target: parsedTarget.label });
                });
            },
            message(ws, message) {
                if (!ws.data.upstream) return;

                if (typeof message === 'string') {
                    const payload = parseHarnessControlMessage(message);
                    if (payload?.type === 'ping') {
                        sendHarnessPayload(ws, JSON.stringify({ type: 'pong' }), {
                            target: parsedTarget.label,
                            eventType: 'pong',
                        });
                        return;
                    }
                    ws.data.bytesOut = Number(ws.data.bytesOut || 0) + Buffer.byteLength(message);
                    ws.data.upstream.write(message);
                    return;
                }

                const chunk = Buffer.isBuffer(message) ? message : Buffer.from(message);
                ws.data.bytesOut = Number(ws.data.bytesOut || 0) + chunk.byteLength;
                ws.data.upstream.write(chunk);
            },
            close(ws) {
                destroyHarnessUpstream(ws.data.upstream, { target: parsedTarget.label });
                ws.data.upstream = null;
            },
        },
    });

    console.log(`[vnc-harness] listening on ${server.url.href.replace(/\/$/, '')}`);
    console.log(`[vnc-harness] bridge target ${parsedTarget.label}`);
    console.log(`[vnc-harness] default password length ${String(args.password || '').length}`);
}

await main();
