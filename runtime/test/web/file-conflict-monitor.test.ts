import { afterEach, expect, test } from 'bun:test';
import { createFileConflictMonitor } from '../../web/src/panes/file-conflict-monitor.js';
const originalSet=globalThis.setInterval,originalClear=globalThis.clearInterval;
const originalFetch = globalThis.fetch;
afterEach(()=>{globalThis.setInterval=originalSet;globalThis.clearInterval=originalClear;globalThis.fetch=originalFetch;});
test('editor conflict monitor owns exactly one timer and disposal prevents restart',()=>{
 let next=1;const active=new Set<number>(),cleared:number[]=[];
 globalThis.setInterval=((_fn:any,_ms?:number)=>{const id=next++;active.add(id);return id as any;}) as any;
 globalThis.clearInterval=((id:any)=>{active.delete(Number(id));cleared.push(Number(id));}) as any;
 const monitor=createFileConflictMonitor({path:'notes/a.md',getCurrentMtime:()=>null,anchorParent:{} as any,anchorBefore:null,onReload(){},onSaveCopy(){},onOverwrite(){},ownerDocument:{} as any});
 expect(active.size).toBe(0);monitor.start();expect(active.size).toBe(1);monitor.start();expect(active.size).toBe(1);expect(cleared).toEqual([1]);
 monitor.stop();expect(active.size).toBe(0);monitor.onSaved('next');expect(active.size).toBe(1);monitor.dispose();expect(active.size).toBe(0);monitor.start();monitor.onSaved('later');expect(active.size).toBe(0);
});

for (const race of ['saved', 'disposed', 'overlap', 'handled']) test(`stat monitor rejects ${race} stale checks`, async () => {
  let tick!: () => Promise<void>;
  globalThis.setInterval = ((fn: any) => { tick = fn; return 1; }) as any;
  globalThis.clearInterval = (() => {}) as any;
  let resolveStat!: (response: Response) => void;
  let requests = 0;
  globalThis.fetch = (() => { requests++; return new Promise<Response>(resolve => { resolveStat = resolve; }); }) as any;
  let mtime = '1';
  let handled = 0;
  const monitor = createFileConflictMonitor({
    path: 'fixture.txt', getCurrentMtime: () => mtime,
    anchorParent: { insertBefore() { throw Error('unexpected conflict bar'); } } as any,
    anchorBefore: null, ownerDocument: { createElement() { throw Error('unexpected conflict bar'); } } as any,
    onReload() {}, onSaveCopy() {}, onOverwrite() {},
    onExternalChange() { handled++; return true; },
  });
  try {
    monitor.start();
    const pending = tick();
    if (race === 'saved') { mtime = '3'; monitor.onSaved(mtime); }
    if (race === 'disposed') monitor.dispose();
    if (race === 'overlap') await tick();
    resolveStat(Response.json({ mtime: '2' }));
    await pending;
    expect(requests).toBe(1);
    expect(handled).toBe(race === 'handled' || race === 'overlap' ? 1 : 0);
  } finally { monitor.dispose(); }
});
