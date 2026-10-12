import { expect } from 'bun:test';
import type { Page } from 'playwright';
export async function expectVisualComposerUsable(page: Page) {
 const original=page.viewportSize();
 try{for(const width of [1280,820,390]){
  await page.setViewportSize({width,height:900});
  const textarea=page.locator('.chat__input');await textarea.waitFor();
  const geometry=await textarea.evaluate(el=>{
   const r=el.getBoundingClientRect(),d=document.querySelector('.compose-latest-divider')!.getBoundingClientRect();
   const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
   return {width:r.width,height:r.height,hit:hit===el,dividerBottom:d.bottom,inputTop:r.top,parentRow:document.querySelector('.compose-latest-divider')?.parentElement===document.querySelector('.chat__compose')};
  });
  expect(geometry.width).toBeGreaterThan(100);expect(geometry.height).toBeGreaterThan(20);expect(geometry.hit).toBe(true);
  expect(geometry.parentRow).toBe(false);expect(geometry.dividerBottom).toBeLessThanOrEqual(geometry.inputTop);
  await textarea.click();await page.keyboard.type('Composer regression');expect(await textarea.inputValue()).toBe('Composer regression');await textarea.fill('');
 }}finally{if(original)await page.setViewportSize(original);}
}
