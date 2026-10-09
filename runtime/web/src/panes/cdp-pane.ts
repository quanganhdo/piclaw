import type { PaneContext, WebPaneExtension, PaneInstance } from './pane-types.js';
export const CDP_TAB_PATH = 'piclaw://cdp-view';
export function cdpPoint(rect: { left: number; top: number; width: number; height: number }, imageWidth: number, imageHeight: number, viewportWidth: number, viewportHeight: number, x: number, y: number) {
  if (!imageWidth || !imageHeight || !rect.width || !rect.height) return null;
  const scale = Math.min(rect.width / imageWidth, rect.height / imageHeight);
  const left = rect.left + (rect.width - imageWidth * scale) / 2;
  const top = rect.top + (rect.height - imageHeight * scale) / 2;
  const px = (x - left) / scale, py = (y - top) / scale;
  if (px < 0 || py < 0 || px > imageWidth || py > imageHeight) return null;
  return { x: px * viewportWidth / imageWidth, y: py * viewportHeight / imageHeight };
}
class CdpPane implements PaneInstance {
  private socket?: WebSocket;
  private root: HTMLDivElement;
  private image: HTMLImageElement;
  private area: HTMLDivElement;
  private tabs: HTMLSelectElement;
  private status: HTMLElement;
  private controlButton: HTMLButtonElement;
  private resizeInput: HTMLInputElement;
  private textInput: HTMLInputElement;
  private releaseFocus = () => { if (this.control) this.send({ type: 'release-input' }); };
  private control = false;
  private lastPoint = { x: 0, y: 0 };
  private target = '';
  private viewport = { width: 0, height: 0 };
  private observer: ResizeObserver;
  private resizeTimer?: ReturnType<typeof setTimeout>;
  private frameGeneration = 0;
  constructor(private host: HTMLElement, _context: PaneContext) {
    this.root = document.createElement('div');
    this.root.style.cssText = 'height:100%;display:flex;flex-direction:column;min-height:0;background:var(--bg-primary);color:var(--text-primary)';
    this.root.innerHTML = `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px"><select aria-label="Browser tab" style="max-width:240px"></select><button data-refresh>Refresh tabs</button><button data-control>Take control</button><label><input type="checkbox" data-resize> Resize browser to pane</label><span role="status">Connecting…</span><input data-text aria-label="Type into browser" placeholder="Type into browser" style="max-width:180px" disabled><button data-reconnect>Reconnect</button></div><div data-area tabindex="0" aria-label="Live browser view" style="flex:1;min-height:0;position:relative;overflow:hidden;outline:none"><img alt="Live browser tab" draggable="false" style="width:100%;height:100%;object-fit:contain;pointer-events:none;user-select:none"></div>`;
    this.tabs = this.root.querySelector('select')!; this.status = this.root.querySelector('[role=status]')!;
    this.controlButton = this.root.querySelector('[data-control]')!; this.resizeInput = this.root.querySelector('[data-resize]')!;
    this.textInput = this.root.querySelector('[data-text]')!; this.area = this.root.querySelector('[data-area]')!; this.image = this.root.querySelector('img')!;
    host.appendChild(this.root);
    this.root.querySelector('[data-refresh]')!.addEventListener('click', () => this.send({ type: 'list' }));
    this.root.querySelector('[data-reconnect]')!.addEventListener('click', () => this.connect());
    this.tabs.onchange = () => this.attach();
    this.controlButton.onclick = () => this.send({ type: 'control', enabled: !this.control });
    this.resizeInput.title = 'Changes page layout and browser fingerprint. Requires manual control.';
    this.resizeInput.onchange = () => {
      if (this.resizeInput.checked && !confirm('Resize the browser viewport? This changes page layout and may affect automation or stealth fingerprint settings.')) this.resizeInput.checked = false;
      this.requestResize();
    };
    this.textInput.oninput = () => { if (this.textInput.value) this.send({ type: 'input', kind: 'text', text: this.textInput.value.slice(0, 2048) }); this.textInput.value = ''; };
    this.area.onblur = this.releaseFocus;
    window.addEventListener('blur', this.releaseFocus);
    this.area.oncontextmenu = event => { if (this.control) event.preventDefault(); };
    this.area.onpointerdown = event => { if (!this.control) return; this.area.focus(); this.area.setPointerCapture(event.pointerId); this.pointer(event, 'mousePressed'); event.preventDefault(); };
    this.area.onpointerup = event => this.pointer(event, 'mouseReleased');
    this.area.onpointermove = event => { if (event.buttons || event.pointerType === 'touch' && this.area.hasPointerCapture(event.pointerId)) this.pointer(event, 'mouseMoved'); };
    this.area.onpointercancel = event => this.pointer(event, 'mouseReleased');
    this.area.addEventListener('wheel', event => { if (!this.control) return; const p = this.point(event); if (!p) return; event.preventDefault(); this.send({ type: 'input', kind: 'mouse', event: 'mouseWheel', ...p, dx: Math.max(-8192, Math.min(8192, event.deltaX)), dy: Math.max(-8192, Math.min(8192, event.deltaY)) }); }, { passive: false });
    for (const [eventName, type] of [['keydown', 'keyDown'], ['keyup', 'keyUp']] as const) this.area.addEventListener(eventName, event => {
      if (!this.control) return; event.preventDefault();
      const modifiers = (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);
      if (eventName === 'keydown' && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) this.send({ type: 'input', kind: 'text', text: event.key });
      else this.send({ type: 'input', kind: 'key', event: type, key: event.key, code: event.code, modifiers });
    });
    this.observer = new ResizeObserver(() => { clearTimeout(this.resizeTimer); this.resizeTimer = setTimeout(() => this.requestResize(), 200); });
    this.observer.observe(this.area); this.connect();
  }
  private point(event: { clientX: number; clientY: number }) { return cdpPoint(this.area.getBoundingClientRect(), this.image.naturalWidth, this.image.naturalHeight, this.viewport.width, this.viewport.height, event.clientX, event.clientY); }
  private pointer(event: PointerEvent, type: string) {
    if (!this.control) return; const p = this.point(event) ?? (type === 'mouseReleased' ? this.lastPoint : null); if (!p) return;
    this.lastPoint = p;
    if (event.pointerType === 'touch') this.send({ type: 'input', kind: 'touch', event: type === 'mousePressed' ? 'touchStart' : type === 'mouseReleased' ? 'touchEnd' : 'touchMove', ...p });
    else this.send({ type: 'input', kind: 'mouse', event: type, ...p, button: event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left' });
  }
  private send(value: unknown) { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(value)); }
  private setControl(value: boolean) { this.control = value; this.controlButton.textContent = value ? 'Release control' : 'Take control'; this.textInput.disabled = !value; this.area.style.touchAction = value ? 'none' : 'auto'; if (!value) this.resizeInput.checked = false; }
  private attach() { this.target = this.tabs.value; this.setControl(false); ++this.frameGeneration; this.image.removeAttribute('src'); const [source, target] = this.target.split('/'); if (source && target) this.send({ type: 'attach', source, target }); }
  private requestResize() {
    if (!this.control) { this.resizeInput.checked = false; return; }
    this.send(this.resizeInput.checked ? { type: 'resize', enabled: true, width: Math.max(200, Math.min(4096, Math.round(this.area.clientWidth))), height: Math.max(200, Math.min(4096, Math.round(this.area.clientHeight))) } : { type: 'resize', enabled: false });
  }
  private connect() {
    this.socket?.close(); this.setControl(false); ++this.frameGeneration; this.image.removeAttribute('src');
    const socket = this.socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/cdp-view/ws`);
    this.status.textContent = 'Connecting…';
    socket.onclose = () => { if (this.socket === socket) { this.setControl(false); this.status.textContent = 'Disconnected — reconnect to resume'; } };
    socket.onerror = () => { this.status.textContent = 'Connection failed'; };
    socket.onmessage = event => {
      if (this.socket !== socket) return;
      const msg = JSON.parse(String(event.data));
      if (msg.type === 'tabs') {
        this.tabs.replaceChildren();
        for (const source of msg.sources) for (const tab of source.tabs) { const option = document.createElement('option'); option.value = `${source.id}/${tab.id}`; option.textContent = `${source.label}: ${tab.title || tab.url}`; this.tabs.appendChild(option); }
        if ([...this.tabs.options].some(o => o.value === this.target)) this.tabs.value = this.target;
        this.status.textContent = this.tabs.options.length ? 'Select a tab' : 'No browser tabs available';
        if (this.tabs.options.length) this.attach();
      } else if (msg.type === 'frame') {
        if (`${msg.source}/${msg.target}` !== this.target) return;
        const generation = this.frameGeneration;
        this.viewport = { width: msg.metadata.deviceWidth, height: msg.metadata.deviceHeight };
        this.image.onload = () => { if (generation === this.frameGeneration && this.socket === socket) this.send({ type: 'ack', frame: msg.frame, stream: msg.stream }); };
        this.image.onerror = () => this.send({ type: 'ack', frame: msg.frame, stream: msg.stream });
        this.image.src = `data:image/jpeg;base64,${msg.data}`;
      } else if (msg.type === 'control') this.setControl(msg.enabled);
      else if (msg.type === 'status') { this.status.textContent = msg.state === 'connected' ? 'Live — scale to fit' : 'Disconnected'; if (msg.state !== 'connected') this.setControl(false); }
      else if (msg.type === 'viewport') this.status.textContent = msg.resized ? 'Live — viewport follows pane' : 'Live — scale to fit';
      else if (msg.type === 'error') this.status.textContent = msg.message;
    };
  }
  getContent() { return null; }
  isDirty() { return false; }
  focus() { this.area.focus(); }
  resize() { this.requestResize(); }
  dispose() { window.removeEventListener('blur', this.releaseFocus); this.observer.disconnect(); clearTimeout(this.resizeTimer); this.socket?.close(); this.socket = undefined; ++this.frameGeneration; this.root.remove(); }
}
export const cdpPaneExtension: WebPaneExtension = { id: 'cdp-viewer', label: 'Browser', capabilities: ['preview'], placement: 'tabs', canHandle: context => context.path === CDP_TAB_PATH ? 9000 : false, mount: (host, context) => new CdpPane(host, context) };
