import { sanitizeVaultHref } from '../vault-links.js';
import { DocumentViewerInstance } from './document-viewer-pane.js';
import type { PaneCapability, PaneContext, WebPaneExtension } from './pane-types.js';

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
  mount(container: HTMLElement, context: PaneContext): DocumentViewerInstance {
    return new DocumentViewerInstance(container, context);
  },
};
