import { sanitizeQmdHref } from '../qmd-links.js';
import { sanitizeVaultHref } from '../vault-links.js';
import type { PaneContext, PaneInstance } from './pane-types.js';

const MESSAGE_TYPE = 'piclaw-document-viewer';
const MAX_HISTORY_ENTRIES = 100;

export type DocumentViewerKind = 'qmd' | 'vault';

export interface DocumentViewerReference {
  kind: DocumentViewerKind;
  reference: string;
}

interface DocumentViewerHistoryEntry extends DocumentViewerReference {
  title: string;
  scrollY: number | null;
}

interface DocumentViewerMessage {
  type?: unknown;
  action?: unknown;
  reference?: unknown;
  currentReference?: unknown;
  title?: unknown;
  scrollY?: unknown;
  delta?: unknown;
}

export function resolveDocumentViewerReference(value: unknown): DocumentViewerReference | null {
  const vault = sanitizeVaultHref(value);
  if (vault) return { kind: 'vault', reference: vault };
  const qmd = sanitizeQmdHref(value);
  if (qmd) return { kind: 'qmd', reference: qmd };
  return null;
}

export function buildDocumentViewerUrl(value: unknown): string | null {
  const resolved = resolveDocumentViewerReference(value);
  if (!resolved) return null;
  const route = resolved.kind === 'vault' ? '/vault-viewer/' : '/qmd-viewer/';
  return `${route}?ref=${encodeURIComponent(resolved.reference)}&embedded=1`;
}

function createNavigationButton(label: string, glyph: string, shortcut: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = glyph;
  button.setAttribute('aria-label', label);
  button.dataset.documentHistory = label.toLowerCase();
  button.title = `${label} (${shortcut})`;
  button.disabled = true;
  button.style.cssText = 'width:32px;height:32px;padding:0;border:1px solid color-mix(in srgb,var(--text-primary,#111) 18%,transparent);border-radius:7px;background:var(--bg-secondary,#f5f5f5);color:var(--text-primary,#111);font:18px/1 system-ui,sans-serif;cursor:pointer;';
  return button;
}

export class DocumentViewerInstance implements PaneInstance {
  private container: HTMLElement;
  private readonly shell: HTMLDivElement;
  private readonly toolbar: HTMLDivElement;
  private readonly backButton: HTMLButtonElement;
  private readonly forwardButton: HTMLButtonElement;
  private readonly title: HTMLDivElement;
  private iframe: HTMLIFrameElement | null = null;
  private readonly entries: DocumentViewerHistoryEntry[];
  private index = 0;
  private disposed = false;
  private loadedOnce = false;

  constructor(container: HTMLElement, context: PaneContext) {
    this.container = container;
    const initial = resolveDocumentViewerReference(context.path);
    this.entries = initial ? [{ ...initial, title: initial.kind === 'vault' ? 'Learning note' : 'QMD Document', scrollY: null }] : [];

    this.shell = document.createElement('div');
    this.shell.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%;min-height:0;background:var(--bg-primary,#fff);';
    this.toolbar = document.createElement('div');
    this.toolbar.setAttribute('role', 'toolbar');
    this.toolbar.setAttribute('aria-label', 'Document history');
    this.toolbar.style.cssText = 'display:flex;align-items:center;gap:4px;flex:0 0 auto;padding:7px 10px;border-bottom:1px solid var(--border-color,rgba(127,127,127,.22));background:var(--bg-primary,#fff);';
    this.backButton = createNavigationButton('Back', '←', 'Alt+Left');
    this.forwardButton = createNavigationButton('Forward', '→', 'Alt+Right');
    this.title = document.createElement('div');
    this.title.setAttribute('aria-live', 'polite');
    this.title.style.cssText = 'min-width:0;flex:1;margin-left:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:650;color:var(--text-primary,#111);';
    this.toolbar.append(this.backButton, this.forwardButton, this.title);
    this.shell.appendChild(this.toolbar);
    container.appendChild(this.shell);

    this.backButton.addEventListener('click', this.handleBack);
    this.forwardButton.addEventListener('click', this.handleForward);
    window.addEventListener('message', this.handleMessage);

    if (!initial) {
      this.title.textContent = 'Invalid document reference';
      this.updateControls();
      return;
    }

    this.iframe = document.createElement('iframe');
    this.iframe.title = initial.kind === 'vault' ? 'Learning-vault note viewer' : 'QMD document viewer';
    this.iframe.style.cssText = 'width:100%;min-height:0;flex:1 1 auto;border:none;background:var(--bg-primary,#fff);';
    this.shell.appendChild(this.iframe);
    this.updateControls();
    this.loadCurrentEntry();
  }

  private readonly handleBack = () => this.move(-1);
  private readonly handleForward = () => this.move(1);

  private currentEntry(): DocumentViewerHistoryEntry | null {
    return this.entries[this.index] ?? null;
  }

  private captureCurrentScroll(explicit?: unknown): void {
    const current = this.currentEntry();
    if (!current) return;
    if (typeof explicit === 'number' && Number.isFinite(explicit)) {
      current.scrollY = Math.max(0, explicit);
      return;
    }
    try {
      const scrollY = this.iframe?.contentWindow?.scrollY;
      if (typeof scrollY === 'number' && Number.isFinite(scrollY)) current.scrollY = Math.max(0, scrollY);
    } catch {
      // Same-origin viewer routes are expected; ignore a transient cross-document state.
    }
  }

  private updateControls(): void {
    const previous = this.index > 0 ? this.entries[this.index - 1] : null;
    const next = this.index >= 0 && this.index < this.entries.length - 1 ? this.entries[this.index + 1] : null;
    this.backButton.disabled = !previous;
    this.forwardButton.disabled = !next;
    this.backButton.title = previous ? `Back to ${previous.title} (Alt+Left)` : 'Back (Alt+Left)';
    this.forwardButton.title = next ? `Forward to ${next.title} (Alt+Right)` : 'Forward (Alt+Right)';
    const current = this.currentEntry();
    this.title.textContent = current?.title || 'Document viewer';
  }

  private loadCurrentEntry(): void {
    const current = this.currentEntry();
    const url = current ? buildDocumentViewerUrl(current.reference) : null;
    if (!this.iframe || !current || !url) return;
    this.iframe.title = current.kind === 'vault' ? 'Learning-vault note viewer' : 'QMD document viewer';
    this.updateControls();
    if (!this.loadedOnce) {
      this.loadedOnce = true;
      this.iframe.src = url;
      return;
    }
    try {
      this.iframe.contentWindow?.location.replace(url);
    } catch {
      this.iframe.src = url;
    }
  }

  private navigate(reference: unknown, scrollY?: unknown): void {
    const next = resolveDocumentViewerReference(reference);
    if (!next) return;
    this.captureCurrentScroll(scrollY);
    this.entries.splice(this.index + 1);
    this.entries.push({ ...next, title: next.kind === 'vault' ? 'Learning note' : 'QMD Document', scrollY: null });
    if (this.entries.length > MAX_HISTORY_ENTRIES) this.entries.shift();
    this.index = this.entries.length - 1;
    this.loadCurrentEntry();
  }

  private move(delta: number): void {
    const nextIndex = this.index + delta;
    if (nextIndex < 0 || nextIndex >= this.entries.length) return;
    this.captureCurrentScroll();
    this.index = nextIndex;
    this.loadCurrentEntry();
  }

  private readonly handleMessage = (event: MessageEvent): void => {
    if (this.disposed || event.origin !== window.location.origin || event.source !== this.iframe?.contentWindow) return;
    const message = event.data as DocumentViewerMessage | null;
    if (!message || message.type !== MESSAGE_TYPE) return;
    const current = this.currentEntry();
    const source = resolveDocumentViewerReference(message.currentReference);
    if (source && current && source.reference !== current.reference) return;

    if (message.action === 'navigate') {
      this.navigate(message.reference, message.scrollY);
      return;
    }
    if (message.action === 'history') {
      const delta = Number(message.delta);
      if (delta === -1 || delta === 1) this.move(delta);
      return;
    }
    if (message.action === 'state') {
      this.captureCurrentScroll(message.scrollY);
      if (current && typeof message.title === 'string' && message.title.trim()) {
        current.title = message.title.trim().slice(0, 240);
        this.updateControls();
      }
      return;
    }
    if (message.action === 'ready' && current) {
      const canonical = resolveDocumentViewerReference(message.reference);
      if (canonical && canonical.kind === current.kind) current.reference = canonical.reference;
      if (typeof message.title === 'string' && message.title.trim()) current.title = message.title.trim().slice(0, 240);
      this.updateControls();
      if (typeof current.scrollY === 'number' && Number.isFinite(current.scrollY)) {
        this.iframe?.contentWindow?.postMessage({ type: MESSAGE_TYPE, action: 'restore', scrollY: current.scrollY }, window.location.origin);
      }
    }
  };

  getContent(): string | undefined { return undefined; }
  isDirty(): boolean { return false; }
  focus(): void { this.iframe?.focus(); }
  resize(): void {}
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('message', this.handleMessage);
    this.backButton.removeEventListener('click', this.handleBack);
    this.forwardButton.removeEventListener('click', this.handleForward);
    if (this.iframe) {
      this.iframe.src = 'about:blank';
      this.iframe.remove();
      this.iframe = null;
    }
    this.shell.remove();
    this.container.innerHTML = '';
  }
}
