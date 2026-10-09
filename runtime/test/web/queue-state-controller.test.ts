import { expect, test } from 'bun:test';
import { createQueueStateController } from '../../web/static/visual/frontend/src/components/queue-state-controller.js';
function harness() {
  const calls: Array<{ signal: AbortSignal; finish: (value: unknown) => void }> = [];
  const states: any[] = []; let current = true, errors = 0;
  const controller = createQueueStateController({ chatJid: 'web:test', isCurrent: () => current,
    request: signal => new Promise(finish => calls.push({ signal, finish })), publish: items => states.push(items), onError: () => { errors++; } });
  return { controller, calls, states, get errors() { return errors; }, leave() { current = false; } };
}
const row = { row_id: -1, content: 'durable queued input' };
test('queue snapshot recovers accepted input without an SSE event and deduplicates later delivery', async () => {
  const h = harness(), initial = h.controller.refresh(); h.calls[0].finish({ count: 1, items: [row] }); await initial;
  expect(h.states.at(-1)).toEqual([row]);
  h.controller.queued({ ...row, chat_jid: 'web:test' }); expect(h.states.at(-1)).toHaveLength(1);
  h.calls[1].finish({ count: 1, items: [row] }); await Bun.sleep(0); h.controller.stop();
});
test('consume during a held snapshot invalidates it and cannot resurrect consumed input', async () => {
  const h = harness(), held = h.controller.refresh();
  h.controller.removed({ row_id: -1, chat_jid: 'web:test' }); expect(h.calls[0].signal.aborted).toBe(true);
  h.calls[0].finish({ count: 1, items: [row] }); await held;
  expect(h.states.at(-1)).toEqual([]); expect(h.calls).toHaveLength(2);
  h.calls[1].finish({ count: 0, items: [] }); await Bun.sleep(0); expect(h.states.at(-1)).toEqual([]); h.controller.stop();
});
test('foreign chat, changed session and stopped responses never publish', async () => {
  const h = harness();h.controller.queued({ ...row, chat_jid: 'web:other' }); expect(h.states).toEqual([]);
  const held = h.controller.refresh(); h.leave();h.calls[0].finish({ count: 1, items: [row] });await held;expect(h.states).toEqual([]);
  h.controller.stop();await h.controller.refresh();expect(h.calls).toHaveLength(1);
  const stopped=harness(), pending=stopped.controller.refresh();stopped.controller.stop();stopped.calls[0].finish({count:1,items:[row]});await pending;expect(stopped.states).toEqual([]);
});
test('malformed queue snapshots fail visibly without replacing retained data', async () => {
  const h=harness(),seed=h.controller.refresh();h.calls[0].finish({count:1,items:[row]});await seed;
  const bad=h.controller.refresh();h.calls[1].finish({count:2,items:[row,row]});await bad;expect(h.errors).toBe(1);expect(h.states.at(-1)).toEqual([row]);h.controller.stop();
});
test('acknowledgement during an older held GET cannot publish that stale snapshot',async()=>{
  const h=harness(),old=h.controller.refresh();void h.controller.refresh();
  expect(h.calls[0].signal.aborted).toBe(true);h.calls[0].finish({count:1,items:[row]});await old;
  expect(h.states).toEqual([]);expect(h.calls).toHaveLength(2);
  h.calls[1].finish({count:0,items:[]});await Bun.sleep(0);expect(h.states.at(-1)).toEqual([]);h.controller.stop();
});
test('confirmed local action invalidates a held GET and has a single state owner',async()=>{
  const h=harness(),seed=h.controller.refresh();h.calls[0].finish({count:1,items:[row]});await seed;
  const held=h.controller.refresh();let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  const action=h.controller.mutate(()=>gate,-1);expect(h.calls[1].signal.aborted).toBe(true);
  h.calls[1].finish({count:1,items:[row]});await held;expect(h.calls).toHaveLength(2);expect(h.states.at(-1)).toEqual([row]);
  release();expect(await action).toBe(true);expect(h.states.at(-1)).toEqual([]);expect(h.calls).toHaveLength(3);
  h.calls[2].finish({count:0,items:[]});await Bun.sleep(0);expect(h.states.at(-1)).toEqual([]);h.controller.stop();
});
test('failed action never removes locally and reconciles ambiguous server outcome',async()=>{
  const h=harness(),seed=h.controller.refresh();h.calls[0].finish({count:1,items:[row]});await seed;
  await expect(h.controller.mutate(async()=>{throw Error('denied');},-1)).rejects.toThrow('denied');expect(h.states.at(-1)).toEqual([row]);
  h.calls[1].finish({count:1,items:[row]});await Bun.sleep(0);expect(h.states.at(-1)).toEqual([row]);h.controller.stop();
});
test('unmount/session change before action completes suppresses all late local success',async()=>{
  const h=harness();let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  const pending=h.controller.mutate(()=>gate,-1);h.controller.stop();release();expect(await pending).toBe(false);expect(h.states).toEqual([]);expect(h.calls).toHaveLength(0);
});
