import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { buildWidgetSrcDoc, getGeneratedWidgetHostWindowName } from '../../web/src/ui/generated-widget.js';

const widget = { widgetId: 'fixture', source: 'live', artifact: { kind: 'html', html: '<p>fixture</p>' }, runtimeState: { count: 0 } };
function bootstrap(opaque = false, raf = true) {
  let nextId = 1;
  const scheduled = new Map<number, () => void>();
  const intervals = new Map<number, () => void>();
  const listeners = new Map<string, ((event: any) => void)[]>();
  const dispatched: any[] = [];
  const observers: { callback: () => void; connected: boolean; target?: unknown; options?: unknown }[] = [];
  const frame = { name: getGeneratedWidgetHostWindowName(widget), getAttribute: () => frame.name };
  const window: any = {
    origin: opaque ? 'null' : 'http://fixture.invalid',
    name: frame.name,
    get frameElement() { if (opaque) throw Error('Opaque frame accessed'); return frame; },
    parent: { postMessage() {} },
    addEventListener(type: string, fn: (event: any) => void) { listeners.set(type, [...(listeners.get(type) || []), fn]); },
    dispatchEvent(event: any) { dispatched.push(event.detail); },
  };
  const schedule = (fn: () => void) => { const id = nextId++; scheduled.set(id, fn); return id; };
  const script = buildWidgetSrcDoc(widget).match(/<script>([\s\S]*?)<\/script>/)![1];
  runInNewContext(script, {
    window, document: { readyState: 'complete', title: 'Fixture' }, CustomEvent,
    requestAnimationFrame: raf ? schedule : undefined,
    cancelAnimationFrame: raf ? (id: number) => scheduled.delete(id) : undefined,
    setTimeout: schedule, clearTimeout: (id: number) => scheduled.delete(id),
    setInterval: (fn: () => void) => { const id = nextId++; intervals.set(id, fn); return id; },
    clearInterval: (id: number) => intervals.delete(id),
    MutationObserver: class {
      entry: typeof observers[number];
      constructor(callback: () => void) { this.entry = { callback, connected: false }; observers.push(this.entry); }
      observe(target: unknown, options: unknown) { Object.assign(this.entry, { connected: true, target, options }); }
      disconnect() { this.entry.connected = false; }
    },
  });
  const emit = (type: string, event = {}) => listeners.get(type)?.forEach(fn => fn(event));
  const flush = () => { const callbacks = [...scheduled.values()]; scheduled.clear(); callbacks.forEach(fn => fn()); };
  const changeName = (raw: string) => { frame.name = raw; observers.filter(o => o.connected).forEach(o => o.callback()); };
  return { window, frame, intervals, scheduled, observers, dispatched, emit, flush, changeName };
}

test('widget bootstrap observes only the name attribute and deduplicates unchanged state', () => {
  const f = bootstrap(); f.flush();
  expect(f.intervals.size).toBe(0);
  expect(f.observers[0].target).toBe(f.frame);
  expect(f.observers[0].options).toEqual({ attributes: true, attributeFilter: ['name'] });
  expect(f.window.piclawWidget.hostState.runtimeState).toEqual({ count: 0 });
  f.changeName(f.frame.name); expect(f.scheduled.size).toBe(0);
  f.changeName(getGeneratedWidgetHostWindowName({ ...widget, runtimeState: { count: 1 } })); f.flush();
  expect(f.window.piclawWidget.hostState.runtimeState).toEqual({ count: 1 });
  expect(f.dispatched).toHaveLength(2);
});

test('widget bootstrap tolerates malformed name and resumes on the next valid state', () => {
  const f = bootstrap(); f.flush();
  f.changeName('__PICLAW_WIDGET_HOST__:{bad'); f.flush();
  expect(f.dispatched).toHaveLength(1);
  f.changeName(getGeneratedWidgetHostWindowName({ ...widget, runtimeState: { count: 2 } })); f.flush();
  expect(f.window.piclawWidget.hostState.runtimeState).toEqual({ count: 2 });
});

test('widget bootstrap page lifecycle disconnects observer, cancels queued work and reconnects once', () => {
  const f = bootstrap(); f.flush();
  f.changeName(getGeneratedWidgetHostWindowName({ ...widget, runtimeState: { count: 3 } }));
  expect(f.scheduled.size).toBe(1); f.emit('pagehide');
  expect(f.scheduled.size).toBe(0); expect(f.observers[0].connected).toBe(false);
  f.emit('message', { data: { __piclawGeneratedWidgetHost: true, widgetId: 'fixture', type: 'widget.update', payload: { paused: true } } });
  expect(f.scheduled.size).toBe(0);
  f.changeName(getGeneratedWidgetHostWindowName({ ...widget, runtimeState: { count: 4 } }));
  expect(f.scheduled.size).toBe(0);
  f.emit('pageshow'); f.emit('pageshow'); f.flush();
  expect(f.observers.filter(o => o.connected)).toHaveLength(1);
  expect(f.window.piclawWidget.hostState.runtimeState).toEqual({ count: 4 });
  expect(f.intervals.size).toBe(0);
});

test('widget bootstrap opaque fallback keeps one poll and tears it down on pagehide', () => {
  const f = bootstrap(true); f.flush();
  expect(f.observers).toHaveLength(0); expect(f.intervals.size).toBe(1);
  f.window.name = getGeneratedWidgetHostWindowName({ ...widget, runtimeState: { count: 5 } });
  f.intervals.forEach(fn => fn()); f.flush();
  expect(f.window.piclawWidget.hostState.runtimeState).toEqual({ count: 5 });
  f.emit('pagehide'); expect(f.intervals.size).toBe(0);
  f.emit('pageshow'); f.emit('pageshow'); expect(f.intervals.size).toBe(1);
});

test('widget bootstrap cancels timeout fallback and preserves message filtering/coalescing', () => {
  const f = bootstrap(false, false); f.flush();
  f.emit('message', { data: { __piclawGeneratedWidgetHost: true, widgetId: 'other' } });
  expect(f.scheduled.size).toBe(0);
  for (const count of [6, 7]) f.emit('message', { data: { __piclawGeneratedWidgetHost: true, widgetId: 'fixture', type: 'widget.update', payload: { runtimeState: { count } } } });
  expect(f.scheduled.size).toBe(1); f.flush();
  expect(f.window.piclawWidget.hostState.runtimeState).toEqual({ count: 7 });
  f.changeName(getGeneratedWidgetHostWindowName({ ...widget, runtimeState: { count: 8 } }));
  expect(f.scheduled.size).toBe(1); f.emit('pagehide'); expect(f.scheduled.size).toBe(0);
});
