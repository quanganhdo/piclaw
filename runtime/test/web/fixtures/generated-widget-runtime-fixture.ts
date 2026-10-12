import { html, render } from '../../../web/src/vendor/preact-htm.js';
import { FloatingWidgetPane } from '../../../web/src/components/floating-widget-pane.js';
import { WidgetPane } from '../../../web/static/visual/frontend/src/components/WidgetPane';
import { h, render as renderVisual } from 'preact';

const content = `<iframe src="/child"></iframe><script>
window.result = {};
window.violations = [];
addEventListener('securitypolicyviolation', event => violations.push(event.effectiveDirective));
(async () => {
  const response = await fetch('/fixture.wasm');
  const { instance } = await WebAssembly.instantiateStreaming(response);
  result.answer = instance.exports.answer();
  try { await fetch('http://localhost:1/blocked'); result.crossOrigin = 'allowed'; }
  catch { result.crossOrigin = 'blocked'; }
  try { eval('1+1'); result.eval = 'allowed'; }
  catch { result.eval = 'blocked'; }
  const child = document.createElement('iframe'); child.src = 'http://localhost:1/blocked-frame'; document.body.append(child);
  result.ready = true;
})().catch(error => { result.error = String(error); result.ready = true; });
</script>`;
const mode = new URL(location.href).searchParams.get('mode');
const source = new URL(location.href).searchParams.get('static') ? 'message' : 'live';
const styledContent='<link rel="stylesheet" href="/fixture.css"><div id="styled">Styled</div>'+content;
const widget = { title: 'Runtime fixture', widgetId: 'runtime-fixture', source, status: 'final', artifact: { kind: 'html', html: styledContent } };
if (mode === 'visual') {
  renderVisual(h(WidgetPane, { tabMode: true, widgetHtml: styledContent, widgetTitle: 'Runtime fixture', widgetSource: source }), document.getElementById('app')!);
} else {
  render(html`<${FloatingWidgetPane} widget=${widget} onClose=${() => {}} />`, document.getElementById('app')!);
}
