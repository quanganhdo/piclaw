import { html, render, useState } from '../../../web/src/vendor/preact-htm.js';
import { WorkspaceExplorer } from '../../../web/src/components/workspace-explorer.js';
function Fixture() {
  const [visible, setVisible] = useState(false);
  const [active, setActive] = useState(false);
  return html`<button id="toggle" onClick=${() => setVisible(v => !v)}>Toggle</button><button id="active" onClick=${() => setActive(v => !v)}>Active</button><${WorkspaceExplorer} visible=${visible} active=${active} />`;
}
render(html`<${Fixture} />`, document.getElementById('app')!);
