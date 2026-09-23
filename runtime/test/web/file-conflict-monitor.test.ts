import { afterEach, expect, test } from 'bun:test';
import { createFileConflictMonitor } from '../../web/src/panes/file-conflict-monitor.js';
const originalSet=globalThis.setInterval,originalClear=globalThis.clearInterval;
afterEach(()=>{globalThis.setInterval=originalSet;globalThis.clearInterval=originalClear;});
test('editor conflict monitor owns exactly one timer and disposal prevents restart',()=>{
 let next=1;const active=new Set<number>(),cleared:number[]=[];
 globalThis.setInterval=((_fn:any,_ms?:number)=>{const id=next++;active.add(id);return id as any;}) as any;
 globalThis.clearInterval=((id:any)=>{active.delete(Number(id));cleared.push(Number(id));}) as any;
 const monitor=createFileConflictMonitor({path:'notes/a.md',getCurrentMtime:()=>null,anchorParent:{} as any,anchorBefore:null,onReload(){},onSaveCopy(){},onOverwrite(){},ownerDocument:{} as any});
 expect(active.size).toBe(0);monitor.start();expect(active.size).toBe(1);monitor.start();expect(active.size).toBe(1);expect(cleared).toEqual([1]);
 monitor.stop();expect(active.size).toBe(0);monitor.onSaved('next');expect(active.size).toBe(1);monitor.dispose();expect(active.size).toBe(0);monitor.start();monitor.onSaved('later');expect(active.size).toBe(0);
});
