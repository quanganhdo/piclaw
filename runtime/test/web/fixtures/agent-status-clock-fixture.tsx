import { h, render, options } from 'preact';
import { useState } from 'preact/hooks';
import { AgentStatusPanel } from '../../../web/static/visual/frontend/src/components/AgentStatusPanel';

const counters = { renders: 0 };
const previousRender = (options as any).__r;
(options as any).__r = (vnode: any) => {
  if (vnode.type === AgentStatusPanel) counters.renders++;
  previousRender?.(vnode);
};
(window as any).statusClockFixture = {
  counters,
  emit(name: string, detail?: unknown) { window.dispatchEvent(new CustomEvent(`piclaw:${name}`, { detail })); },
};
function Fixture() {
  const [mounted, setMounted] = useState(true);
  return <><button id="toggle-panel" onClick={() => setMounted(value => !value)}>Toggle panel</button>{mounted && <AgentStatusPanel />}</>;
}
render(<Fixture />, document.getElementById('app')!);
