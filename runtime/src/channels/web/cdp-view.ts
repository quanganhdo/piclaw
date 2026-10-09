import { createLogger, debugSuppressedError } from '../../utils/logger.js';
const log = createLogger('web.cdp-view');
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getWorkspaceDir } from '../../core/config.js';
interface CDPTarget { id: string; type: string; title: string; url: string; webSocketDebuggerUrl: string }
async function getTargets(port: number): Promise<CDPTarget[]> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) });
  if (!response.ok) throw Error('Browser unavailable');
  return (await response.json() as CDPTarget[]).filter(t => t.type === 'page');
}
async function findCDP(): Promise<number | null> {
  let preferred: number | undefined;
  try { const state = JSON.parse(readFileSync(join(getWorkspaceDir(), '.piclaw/browser/managed-desktop.json'), 'utf8')); if (state.version === 1 && Number.isInteger(state.cdpPort) && state.cdpPort >= 9224 && state.cdpPort <= 9233) preferred = state.cdpPort; } catch (error) { debugSuppressedError(log, "Managed browser state unavailable", error); }
  const ports = preferred ? [preferred, ...Array.from({ length: 10 }, (_, i) => 9224 + i).filter(p => p !== preferred)] : Array.from({ length: 10 }, (_, i) => 9224 + i);
  const results = await Promise.all(ports.map(async port => { try { const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) }); const value = await response.json(); return value && typeof value === 'object' && !Array.isArray(value) ? port : null; } catch { return null; } }));
  return results.find(p => p !== null) ?? null;
}

export interface CdpBrowserSource { id: string; label: string; port: number; restoreViewport?: "clear" }
const sources = new Map<string, CdpBrowserSource>();
const controllers = new Map<string, CdpViewConnection>();
const toolCalls = new Map<string, number>();
const tabViewers = new Map<string, CdpViewConnection>();

/** Trusted runtime/add-on registration; browser URLs supplied by the web client are never accepted. */
export function registerCdpViewSource(source: CdpBrowserSource): () => void {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(source.id) || source.id === 'cdp' || !Number.isInteger(source.port) || source.port < 1024 || source.port > 65535) throw Error('Invalid CDP source');
  if (sources.has(source.id)) throw Error('CDP source already registered');
  const captured = Object.freeze({ ...source, label: source.label.slice(0, 100) });
  sources.set(source.id, captured);
  return () => {
    if (sources.get(source.id) !== captured) return;
    sources.delete(source.id);
    for (const connection of connections) if (connection.sourceId === source.id) connection.close();
  };
}
export function assertCdpViewToolControl(sourceId: string): void {
  if (controllers.has(sourceId)) throw Error('Browser is under manual control in the CDP viewer. Release control before using browser tools.');
}
export function beginCdpViewTool(sourceId: string): () => void {
  assertCdpViewToolControl(sourceId);
  toolCalls.set(sourceId, (toolCalls.get(sourceId) ?? 0) + 1);
  let released = false;
  return () => { if (released) return; released = true; const count = (toolCalls.get(sourceId) ?? 1) - 1; count ? toolCalls.set(sourceId, count) : toolCalls.delete(sourceId); };
}
(globalThis as any).__piclaw_cdpToolActive = (sourceId: string) => Boolean(toolCalls.get(sourceId));
(globalThis as any).__piclaw_hasCdpViewer = (sourceId: string) => [...tabViewers.keys()].some(key => key.startsWith(sourceId + '/'));
(globalThis as any).__piclaw_beginCdpViewTool = beginCdpViewTool;
(globalThis as any).__piclaw_registerCdpViewSource = registerCdpViewSource;
(globalThis as any).__piclaw_assertCdpViewToolControl = assertCdpViewToolControl;

async function sourceList(): Promise<CdpBrowserSource[]> {
  const port = await findCDP();
  return [...(port ? [{ id: 'cdp', label: 'CDP browser', port }] : []), ...sources.values()];
}
async function targets(source: CdpBrowserSource): Promise<CDPTarget[]> {
  const rows = await getTargets(source.port);
  return rows.filter(row => {
    try { const u = new URL(row.webSocketDebuggerUrl); return ['ws:', 'wss:'].includes(u.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && Number(u.port) === source.port; } catch { return false; }
  });
}
const connections = new Set<CdpViewConnection>();
const MAX_INPUT = 16 * 1024;
const MAX_FRAME = 4 * 1024 * 1024;
type ViewerSocket = { send(value: string): unknown; close(code?: number, reason?: string): unknown };

export class CdpViewConnection {
  sourceId = '';
  private targetId = '';
  private upstream?: WebSocket;
  private generation = 0;
  private nextId = 0;
  private pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private unacked?: number;
  private frameTimer?: ReturnType<typeof setTimeout>;
  private control = false;
  private heldKeys = new Map<string, { key: string; code: string; modifiers: number }>();
  private pointer = { x: 0, y: 0 };
  private heldButtons = new Set<string>();
  private touching = false;
  private resized = false;
  private cleanup?: Promise<void>;
  private disposed = false;
  private queue: Promise<void> = Promise.resolve();
  private queued = 0;
  constructor(private viewer: ViewerSocket) { connections.add(this); }
  private send(value: unknown) { if (!this.disposed) this.viewer.send(JSON.stringify(value)); }
  async list() {
    const list = await sourceList();
    const rows = await Promise.all(list.map(async source => ({ id: source.id, label: source.label, tabs: (await targets(source).catch(() => [])).map(t => ({ id: t.id, title: t.title, url: t.url })) })));
    this.send({ type: 'tabs', sources: rows });
  }
  message(raw: string | Buffer) {
    if (Buffer.byteLength(raw) > MAX_INPUT) { this.viewer.close(1009, 'Input too large'); this.close(); return; }
    let value: any;
    try { value = JSON.parse(String(raw)); } catch { this.send({ type: 'error', message: 'Invalid viewer message' }); return; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) { this.send({ type: 'error', message: 'Invalid viewer message' }); return; }
    if (value.type === 'ack') {
      if (Number.isInteger(value.frame) && value.frame === this.unacked && value.stream === this.generation) {
        clearTimeout(this.frameTimer); this.unacked = undefined;
        void this.command('Page.screencastFrameAck', { sessionId: value.frame }).catch(error => debugSuppressedError(log, "CDP cleanup or frame acknowledgement failed", error));
      }
      return;
    }
    if (this.queued >= 64) { this.viewer.close(1008, 'Too many pending inputs'); this.close(); return; }
    ++this.queued;
    this.queue = this.queue.then(async () => {
      if (this.disposed) return;
      switch (value.type) {
        case 'list': await this.list(); break;
        case 'attach':
          try { await this.attach(value.source, value.target); }
          catch (error) { await this.detach(); throw error; }
          break;
        case 'control':
          if (value.enabled !== true) { await this.releaseInput(); if (this.resized) await this.restoreViewport(); }
          this.setControl(value.enabled === true); break;
        case 'input': await this.input(value); break;
        case 'release-input': await this.releaseInput(); break;
        case 'resize': await this.resize(value); break;
        case 'detach': await this.detach(); break;
        default: throw Error('Unknown viewer message');
      }
    }).catch(error => this.send({ type: 'error', message: error instanceof Error ? error.message : 'Viewer operation failed' })).finally(() => { --this.queued; });
  }
  private setControl(enabled: boolean) {
    if (!this.upstream || this.upstream.readyState !== WebSocket.OPEN) throw Error('Select a connected tab first');
    if (enabled) {
      if (toolCalls.get(this.sourceId)) throw Error('Browser tool is still running; wait before taking control');
      const owner = controllers.get(this.sourceId);
      if (owner && owner !== this) throw Error('Another viewer controls this browser');
      controllers.set(this.sourceId, this);
    } else if (controllers.get(this.sourceId) === this) controllers.delete(this.sourceId);
    this.control = enabled;
    this.send({ type: 'control', enabled });
  }
  private command(method: string, params: unknown = {}): Promise<any> {
    const socket = this.upstream;
    if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(Error('Tab disconnected'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error('CDP request timed out')); }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      try { socket.send(JSON.stringify({ id, method, params })); } catch { clearTimeout(timer); this.pending.delete(id); reject(Error('Tab disconnected')); }
    });
  }
  async attach(sourceId: string, targetId: string) {
    if (typeof sourceId !== 'string' || typeof targetId !== 'string') throw Error('Invalid target');
    const source = (await sourceList()).find(s => s.id === sourceId);
    if (!source) throw Error('Browser source unavailable');
    const target = (await targets(source)).find(t => t.id === targetId);
    if (!target) throw Error('Tab unavailable');
    const key = `${sourceId}/${targetId}`;
    if (tabViewers.has(key) && tabViewers.get(key) !== this) throw Error('Tab is already streaming in another pane');
    await this.detach();
    if (tabViewers.has(key) && tabViewers.get(key) !== this) throw Error('Tab is already streaming in another pane');
    if (this.disposed || sourceId !== "cdp" && sources.get(sourceId) !== source) return;
    tabViewers.set(key, this);
    this.sourceId = sourceId; this.targetId = targetId;
    const generation = ++this.generation;
    const socket = this.upstream = new WebSocket(target.webSocketDebuggerUrl);
    socket.onmessage = event => {
      if (generation !== this.generation) return;
      let msg: any; try { msg = JSON.parse(String(event.data)); } catch { return; }
      if (msg.id) {
        const job = this.pending.get(msg.id); if (!job) return;
        clearTimeout(job.timer); this.pending.delete(msg.id);
        msg.error ? job.reject(Error('CDP operation rejected')) : job.resolve(msg.result); return;
      }
      if (msg.method === 'Page.screencastFrame') {
        const frame = msg.params;
        if (typeof frame.data !== 'string' || frame.data.length > MAX_FRAME) { void this.close(); this.send({ type: 'error', message: 'Frame exceeds viewer limit' }); return; }
        if (this.unacked !== undefined) { void this.command('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(error => debugSuppressedError(log, "CDP cleanup or frame acknowledgement failed", error)); return; }
        this.unacked = frame.sessionId;
        this.send({ type: 'frame', frame: frame.sessionId, stream: generation, source: sourceId, target: targetId, data: frame.data, metadata: frame.metadata });
        this.frameTimer = setTimeout(() => { this.viewer.close(1008, 'Frame acknowledgement timeout'); void this.close(); }, 10000);
      }
    };
    socket.onclose = () => { if (generation === this.generation) { this.release(); void this.close(); this.send({ type: 'status', state: 'disconnected' }); } };
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(Error('Tab connection timed out')); }, 5000);
      socket.onopen = () => { clearTimeout(timer); resolve(); };
      socket.onerror = () => { clearTimeout(timer); reject(Error('Tab connection failed')); };
    });
    if (this.disposed || generation !== this.generation) { socket.close(); return; }
    await this.command('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
    if (this.disposed || generation !== this.generation) return;
    this.send({ type: 'status', state: 'connected', source: sourceId, target: targetId, stream: generation });
  }
  private async input(value: any) {
    if (!this.control) throw Error('Take control before sending input');
    if (value.kind === 'mouse') {
      if (!['mousePressed', 'mouseReleased', 'mouseMoved', 'mouseWheel'].includes(value.event) || ![value.x, value.y].every(n => Number.isFinite(n) && n >= 0 && n <= 8192)) throw Error('Invalid pointer input');
      const button = ['left', 'middle', 'right', 'none'].includes(value.button) ? value.button : 'none';
      const params: any = { type: value.event, x: value.x, y: value.y, button, clickCount: value.event === 'mousePressed' || value.event === 'mouseReleased' ? 1 : 0 };
      if (value.event === 'mouseWheel') { if (![value.dx, value.dy].every(n => Number.isFinite(n) && Math.abs(n) <= 8192)) throw Error('Invalid wheel input'); params.deltaX = value.dx; params.deltaY = value.dy; }
      this.pointer = { x: value.x, y: value.y };
      if (value.event === 'mousePressed') this.heldButtons.add(button);
      if (value.event === 'mouseReleased') this.heldButtons.delete(button);
      await this.command('Input.dispatchMouseEvent', params);
    } else if (value.kind === 'touch') {
      if (!['touchStart', 'touchMove', 'touchEnd', 'touchCancel'].includes(value.event)) throw Error('Invalid touch input');
      const points = value.event === 'touchEnd' || value.event === 'touchCancel' ? [] : [{ x: value.x, y: value.y, id: 0 }];
      if (points.length && ![value.x, value.y].every(n => Number.isFinite(n) && n >= 0 && n <= 8192)) throw Error('Invalid touch coordinates');
      this.touching = points.length > 0;
      await this.command('Input.dispatchTouchEvent', { type: value.event, touchPoints: points });
    } else if (value.kind === 'text') {
      if (typeof value.text !== 'string' || value.text.length > 2048) throw Error('Invalid text input');
      await this.command('Input.insertText', { text: value.text });
    } else if (value.kind === 'key') {
      if (!['keyDown', 'keyUp'].includes(value.event) || typeof value.key !== 'string' || value.key.length > 50 || typeof value.code !== 'string' || value.code.length > 50 || !Number.isInteger(value.modifiers) || value.modifiers < 0 || value.modifiers > 15) throw Error('Invalid key input');
      if (value.event === 'keyDown') this.heldKeys.set(value.code, { key: value.key, code: value.code, modifiers: value.modifiers });
      else this.heldKeys.delete(value.code);
      await this.command('Input.dispatchKeyEvent', { type: value.event, key: value.key, code: value.code, modifiers: value.modifiers });
    } else throw Error('Invalid input type');
  }
  private async resize(value: any) {
    if (!this.control) throw Error('Take control before changing viewport');
    if (value.enabled === false) { await this.restoreViewport(); return; }
    if (![value.width, value.height].every(n => Number.isInteger(n) && n >= 200 && n <= 4096)) throw Error('Invalid viewport size');
    if (this.sourceId === 'stealth' && sources.get('stealth')?.restoreViewport !== 'clear') throw Error('Stealth viewport restoration is not supported by this source');
    this.resized = true;
    await this.command('Emulation.setDeviceMetricsOverride', { width: value.width, height: value.height, deviceScaleFactor: 1, mobile: false });
    this.send({ type: 'viewport', resized: true });
  }
  private async releaseInput() {
    for (const button of this.heldButtons) await this.command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...this.pointer, button, clickCount: 1 }).catch(error => debugSuppressedError(log, "CDP cleanup or frame acknowledgement failed", error));
    for (const key of this.heldKeys.values()) await this.command('Input.dispatchKeyEvent', { type: 'keyUp', ...key }).catch(error => debugSuppressedError(log, "CDP cleanup or frame acknowledgement failed", error));
    if (this.touching) await this.command('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }).catch(error => debugSuppressedError(log, "CDP cleanup or frame acknowledgement failed", error));
    this.heldButtons.clear(); this.heldKeys.clear(); this.touching = false;
  }
  private async restoreViewport() {
    if (!this.resized) return;
    await this.command('Emulation.clearDeviceMetricsOverride');
    this.resized = false;
    this.send({ type: 'viewport', resized: false });
  }
  private release() {
    const key = `${this.sourceId}/${this.targetId}`;
    if (tabViewers.get(key) === this) tabViewers.delete(key);
    if (controllers.get(this.sourceId) === this) controllers.delete(this.sourceId);
    this.control = false; clearTimeout(this.frameTimer); this.unacked = undefined;
    for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(Error('Tab disconnected')); }
    this.pending.clear();
  }
  async detach() {
    if (this.upstream?.readyState === WebSocket.OPEN) {
      await this.releaseInput();
      if (this.resized) await this.restoreViewport().catch(error => debugSuppressedError(log, "CDP cleanup or frame acknowledgement failed", error));
      await this.command('Page.stopScreencast').catch(error => debugSuppressedError(log, "CDP cleanup or frame acknowledgement failed", error));
    }
    ++this.generation; this.upstream?.close(); this.upstream = undefined; this.resized = false; this.release();
  }
  close(): Promise<void> {
    if (this.cleanup) return this.cleanup;
    this.disposed = true; connections.delete(this);
    this.cleanup = this.queue.then(() => this.detach());
    return this.cleanup;
  }
}
export async function closeCdpViewConnections() { await Promise.all([...connections].map(connection => connection.close())); }
