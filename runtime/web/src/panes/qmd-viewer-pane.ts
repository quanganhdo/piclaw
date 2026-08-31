import { sanitizeQmdHref } from '../qmd-links.js';
import type { PaneCapability, PaneContext, PaneInstance, WebPaneExtension } from './pane-types.js';

class QmdViewerInstance implements PaneInstance {
  private readonly container: HTMLElement;
  private iframe: HTMLIFrameElement | null = null;
  private disposed = false;

  constructor(container: HTMLElement, context: PaneContext) {
    this.container = container;
    const reference = sanitizeQmdHref(context.path);
    if (!reference) {
      const error = document.createElement('div');
      error.textContent = 'Invalid QMD document reference.';
      error.style.cssText = 'padding:24px;color:var(--danger-color,#dc2626);';
      container.appendChild(error);
      return;
    }

    this.iframe = document.createElement('iframe');
    this.iframe.src = `/qmd-viewer/?ref=${encodeURIComponent(reference)}`;
    this.iframe.title = 'QMD document viewer';
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

export const qmdViewerPaneExtension: WebPaneExtension = {
  id: 'qmd-viewer',
  label: 'QMD Document',
  icon: 'book-open',
  capabilities: ['readonly', 'preview'] as PaneCapability[],
  placement: 'tabs',
  retainOnTabSwitch: true,
  canHandle(context: PaneContext): boolean | number {
    return sanitizeQmdHref(context.path) ? 100 : false;
  },
  mount(container: HTMLElement, context: PaneContext): PaneInstance {
    return new QmdViewerInstance(container, context);
  },
};
