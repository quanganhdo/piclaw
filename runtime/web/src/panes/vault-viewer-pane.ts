import { sanitizeVaultHref } from '../vault-links.js';
import type { PaneCapability, PaneContext, PaneInstance, WebPaneExtension } from './pane-types.js';

class VaultViewerInstance implements PaneInstance {
  private readonly container: HTMLElement;
  private iframe: HTMLIFrameElement | null = null;
  private disposed = false;

  constructor(container: HTMLElement, context: PaneContext) {
    this.container = container;
    const reference = sanitizeVaultHref(context.path);
    if (!reference) {
      const error = document.createElement('div');
      error.textContent = 'Invalid learning-vault reference.';
      error.style.cssText = 'padding:24px;color:var(--danger-color,#dc2626);';
      container.appendChild(error);
      return;
    }
    this.iframe = document.createElement('iframe');
    this.iframe.src = `/vault-viewer/?ref=${encodeURIComponent(reference)}`;
    this.iframe.title = 'Learning-vault note viewer';
    this.iframe.style.cssText = 'width:100%;height:100%;border:none;background:var(--bg-primary,#fff);';
    container.appendChild(this.iframe);
  }

  getContent(): string | undefined { return undefined; }
  isDirty(): boolean { return false; }
  focus(): void { this.iframe?.focus(); }
  resize(): void {}
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.iframe) {
      this.iframe.src = 'about:blank';
      this.iframe.remove();
      this.iframe = null;
    }
    this.container.innerHTML = '';
  }
}

export const vaultViewerPaneExtension: WebPaneExtension = {
  id: 'vault-viewer',
  label: 'Learning note',
  icon: 'book-open',
  capabilities: ['readonly', 'preview'] as PaneCapability[],
  placement: 'tabs',
  retainOnTabSwitch: true,
  canHandle(context: PaneContext): boolean | number {
    return sanitizeVaultHref(context.path) ? 100 : false;
  },
  mount(container: HTMLElement, context: PaneContext): PaneInstance {
    return new VaultViewerInstance(container, context);
  },
};
