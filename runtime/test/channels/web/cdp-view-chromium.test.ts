import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CdpViewConnection, registerCdpViewSource, assertCdpViewToolControl, beginCdpViewTool } from '../../../src/channels/web/cdp-view.js';

const binary = process.env.PICLAW_TEST_CHROMIUM;
(binary ? test : test.skip)('real Chromium streams, accepts manual input/resize, and survives viewer detach', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cdp-view-real-'));
  const pageServer = Bun.serve({ port: 0, fetch: () => new Response('<html><body><input id="field"><button onclick="document.body.dataset.clicked=1">Click</button></body></html>', { headers: { 'Content-Type': 'text/html' } }) });
  const process = Bun.spawn([binary!, '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${root}`, `http://127.0.0.1:${pageServer.port}`], { stdout: 'ignore', stderr: 'pipe' });
  let closeSource: (() => void) | undefined, view: CdpViewConnection | undefined, socket: WebSocket | undefined;
  try {
    const { existsSync, readFileSync } = await import('node:fs');
    const deadline = Date.now() + 10000;
    while (!existsSync(join(root, 'DevToolsActivePort')) && Date.now() < deadline) await Bun.sleep(30);
    const port = Number(readFileSync(join(root, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
    let tab: any;
    while (!tab && Date.now() < deadline) {
      const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as any[];
      tab = tabs.find(t => t.type === 'page'); if (!tab) await Bun.sleep(30);
    }
    expect(tab).toBeTruthy();
    closeSource = registerCdpViewSource({ id: 'real-fixture', label: 'Real Chromium', port });
    const output: any[] = [];
    view = new CdpViewConnection({ send(value) { const row = JSON.parse(value); output.push(row); if (row.type === 'frame') view!.message(JSON.stringify({ type: 'ack', frame: row.frame, stream: row.stream })); }, close() {} });
    await view.attach('real-fixture', tab.id);
    const wait = async (predicate: () => boolean) => { const end = Date.now() + 5000; while (!predicate() && Date.now() < end) await Bun.sleep(20); expect(predicate()).toBe(true); };
    await wait(() => output.some(v => v.type === 'frame'));
    const releaseTool = beginCdpViewTool('real-fixture');
    view.message(JSON.stringify({ type: 'control', enabled: true })); await wait(() => output.some(v => v.type === 'error' && v.message.includes('still running')));
    releaseTool(); releaseTool();
    view.message(JSON.stringify({ type: 'control', enabled: true })); await wait(() => output.some(v => v.type === 'control' && v.enabled));
    expect(() => assertCdpViewToolControl('real-fixture')).toThrow('manual control');
    socket = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => { socket!.onopen = () => resolve(); socket!.onerror = reject; });
    let id = 100;
    const command = (method: string, params: unknown) => new Promise<any>((resolve, reject) => { const request = ++id; const listener = (event: MessageEvent) => { const msg = JSON.parse(String(event.data)); if (msg.id === request) { socket!.removeEventListener('message', listener); msg.error ? reject(msg.error) : resolve(msg.result); } }; socket!.addEventListener('message', listener); socket!.send(JSON.stringify({ id: request, method, params })); });
    await command('Runtime.evaluate', { expression: "document.querySelector('input').focus()" });
    view.message(JSON.stringify({ type: 'input', kind: 'text', text: 'tablet input' }));
    await Bun.sleep(100);
    expect((await command('Runtime.evaluate', { expression: "document.querySelector('input').value" })).result.value).toBe('tablet input');
    view.message(JSON.stringify({ type: 'resize', enabled: true, width: 640, height: 480 })); await Bun.sleep(100);
    expect((await command('Runtime.evaluate', { expression: 'innerWidth' })).result.value).toBe(640);
    view.message(JSON.stringify({ type: 'input', kind: 'key', event: 'keyDown', key: 'Shift', code: 'ShiftLeft', modifiers: 8 }));
    view.message(JSON.stringify({ type: 'input', kind: 'touch', event: 'touchStart', x: 100, y: 100 }));
    view.message(JSON.stringify({ type: 'input', kind: 'touch', event: 'touchEnd' }));
    await Bun.sleep(100);
    await view.close();
    await view.close();
    expect(() => assertCdpViewToolControl('real-fixture')).not.toThrow();
    expect((await command('Runtime.evaluate', { expression: 'innerWidth' })).result.value).not.toBe(640);
    const secondView = new CdpViewConnection({ send() {}, close() {} });
    await secondView.attach('real-fixture', tab.id); await secondView.close();
    expect((await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as any[]).some(t => t.id === tab.id)).toBe(true);
  } finally { view?.close(); closeSource?.(); socket?.close(); process.kill(); await process.exited; pageServer.stop(true); rmSync(root, { recursive: true, force: true }); }
}, 20000);
