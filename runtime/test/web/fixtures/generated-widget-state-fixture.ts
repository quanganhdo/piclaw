import { html, render, useState } from '../../../web/src/vendor/preact-htm.js';
import { FloatingWidgetPane } from '../../../web/src/components/floating-widget-pane.js';

const initial = {
  title: 'Fixture widget', widgetId: 'fixture-widget', toolCallId: 'fixture-tool', turnId: 'fixture-turn',
  source: 'live', status: 'streaming', runtimeState: { count: 0 },
  artifact: { kind: 'html', html: '<p>Disposable widget content</p>' },
};
const received: unknown[] = [];
function Fixture() {
  const [open, setOpen] = useState(true);
  const [widget, setWidget] = useState(initial);
  return html`
    <button id="open" onClick=${() => setOpen(true)}>Open</button>
    <button id="update" onClick=${() => setWidget({ ...widget, runtimeState: { count: widget.runtimeState.count + 1 } })}>Update</button>
    <button id="replace" onClick=${() => setWidget({ ...widget, artifact: { kind: 'html', html: '<p>Replacement content</p>' } })}>Replace document</button>
    ${open && html`<${FloatingWidgetPane} widget=${widget} onClose=${() => setOpen(false)} onWidgetEvent=${event => received.push(event)} />`}
  `;
}
(window as any).widgetPaneFixture = { received };
render(html`<${Fixture} />`, document.getElementById('app')!);
