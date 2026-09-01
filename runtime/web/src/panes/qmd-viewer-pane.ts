import { sanitizeQmdHref } from '../qmd-links.js';
import { DocumentViewerInstance } from './document-viewer-pane.js';
import type { PaneCapability, PaneContext, WebPaneExtension } from './pane-types.js';

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
  mount(container: HTMLElement, context: PaneContext): DocumentViewerInstance {
    return new DocumentViewerInstance(container, context);
  },
};
