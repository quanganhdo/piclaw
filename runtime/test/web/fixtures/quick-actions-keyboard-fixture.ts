import { html, render } from '../../../web/src/vendor/preact-htm.js';
import { TimelineQuickActions } from '../../../web/src/components/timeline-quick-actions.js';
// Installed before the component's capture listener, as an embedded control can be.
window.addEventListener('keydown', event => { if ((window as any).consumeKey) event.preventDefault(); }, true);
render(html`<${TimelineQuickActions} currentChatJid="web:fixture" agents=${[]} />`, document.getElementById('root'));
(window as any).keyboardFixtureReady = true;
