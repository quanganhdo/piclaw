import { expect, test } from 'bun:test';
import { createVisibleInterval } from '../../web/src/ui/visible-interval.js';
test('visible interval owns no timer while hidden and refreshes once on restore',()=>{
 let state:'visible'|'hidden'='visible',next=1,calls=0;const timers=new Map<number,()=>void>();let listener:()=>void=()=>{};
 const doc:any={get visibilityState(){return state;},addEventListener:(_t:string,fn:()=>void)=>listener=fn,removeEventListener:(_t:string,fn:()=>void)=>{if(listener===fn)listener=()=>{};}};
 const win:any={setInterval:(fn:()=>void)=>{const id=next++;timers.set(id,fn);return id;},clearInterval:(id:number)=>timers.delete(id)};
 const dispose=createVisibleInterval(()=>calls++,5000,{document:doc,window:win});expect(timers.size).toBe(1);timers.values().next().value();expect(calls).toBe(1);
 state='hidden';listener();expect(timers.size).toBe(0);listener();expect(timers.size).toBe(0);
 state='visible';listener();expect(calls).toBe(2);expect(timers.size).toBe(1);listener();expect(calls).toBe(2);expect(timers.size).toBe(1);
 dispose();expect(timers.size).toBe(0);state='hidden';listener();state='visible';listener();expect(timers.size).toBe(0);expect(calls).toBe(2);
});
