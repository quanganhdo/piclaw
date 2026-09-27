import type { WebPaneExtension } from './pane-types.js';

/** A restored virtual tab must never fall through to filesystem editor behaviour. */
export const addonUnavailablePane: WebPaneExtension = {
  id: 'addon-unavailable', label: 'Add-on unavailable', placement: 'tabs', capabilities: ['readonly'],
  mount(container) {
    const notice = document.createElement('div');
    notice.className = 'pane-unavailable';
    notice.setAttribute('role', 'status');
    notice.textContent = 'This add-on pane is unavailable. Enable the add-on and reopen this tab.';
    container.appendChild(notice);
    return { focus() {}, dispose() { notice.remove(); }, isDirty() { return false; }, getContent() { return undefined; } };
  },
};
