import { afterEach, expect, test } from 'bun:test';
import { paneRegistry } from '../../web/src/panes/pane-registry.js';
import { createAddonWebApi, resetAddonWebRegistriesForTests } from '../../web/src/ui/addon-web-extensions.js';
import { workspaceActionContext, listWorkspaceActions, invokeWorkspaceAction, bindAddonPaneLauncher, subscribeWorkspaceActions, validAddonVirtualPath } from '../../web/src/ui/addon-workspace-actions.js';
import { normalizeRecentFiles, openRecentFile } from '../../web/src/ui/recent-files.js';
const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch; resetAddonWebRegistriesForTests();paneRegistry.unregister('test-editor');});
const context=()=>workspaceActionContext({path:'src/unchanged.ts',type:'file',size:25},null)!;

test('selected-file actions are registered, filtered, replaced and disposed without taking over editor',async()=>{
 const api=createAddonWebApi(null);expect(api.workspaceActionsVersion).toBe(1);
 let changes=0,calls=0;const stop=subscribeWorkspaceActions(()=>changes++);
 const dispose=api.registerWorkspaceAction({id:'example.review',label:'Review file',title:'Review saved file without opening editor',when:c=>c.path.endsWith('.ts'),run:c=>{expect(c.path).toBe('src/unchanged.ts');calls++;}});
 expect(listWorkspaceActions(context())).toHaveLength(1);
 expect(workspaceActionContext({path:'../secret',type:'file'},null)).toBeNull();
 expect(workspaceActionContext({path:'piclaw://addon/example/id',type:'file'},null)).toBeNull();
 expect(workspaceActionContext({path:'folder',type:'dir'},null)).toBeNull();
 expect(listWorkspaceActions(null)).toEqual([]);
 globalThis.fetch=(async(input)=>{expect(String(input)).toContain('/workspace/stat?');return Response.json({path:'src/unchanged.ts',type:'file',size:25});}) as typeof fetch;
 expect(await invokeWorkspaceAction('example.review',context())).toBe(true);expect(calls).toBe(1);
 globalThis.fetch=(async()=>Response.json({type:'dir'})) as typeof fetch;
 await expect(invokeWorkspaceAction('example.review',context())).rejects.toThrow('not a file');expect(calls).toBe(1);
 dispose();expect(listWorkspaceActions(context())).toEqual([]);expect(await invokeWorkspaceAction('example.review',context())).toBe(false);
 expect(changes).toBe(2);stop();
});

test('unregistering during path verification cancels action',async()=>{
 const api=createAddonWebApi(null);let calls=0;
 const dispose=api.registerWorkspaceAction({id:'example.review',label:'Review',title:'Review',run:()=>{calls++;}});
 globalThis.fetch=(async()=>{dispose();return Response.json({type:'file'});}) as typeof fetch;
 expect(await invokeWorkspaceAction('example.review',context())).toBe(false);expect(calls).toBe(0);
});

test('public pane launch is direct, readonly, namespace-bounded and lifecycle-bound',()=>{
 const api=createAddonWebApi(null);const path='piclaw://addon/example/review-1';let opened:any=null;
 api.registerPane({id:'example-review',placement:'tabs',capabilities:['readonly'],canHandle:(c:any)=>c.path===path,mount(){throw Error('not mounted by launcher');}});
 expect(api.openPane({path,paneId:'example-review'})).toBe(false);
 const unbind=bindAddonPaneLauncher((p,o)=>{opened={p,o};});
 expect(api.openPane({path,paneId:'example-review',label:'Review file'})).toBe(true);
 expect(opened).toEqual({p:path,o:{paneOverrideId:'example-review',label:'Review file'}});
 for(const bad of ['src/file.ts','piclaw://addon/example/../secret','piclaw://addon/example/%2e%2e','piclaw://addon/example/id?body=secret','piclaw://terminal']) {
  expect(validAddonVirtualPath(bad)).toBe(false);expect(api.openPane({path:bad,paneId:'example-review'})).toBe(false);
 }
 unbind();expect(api.openPane({path,paneId:'example-review'})).toBe(false);
});

test('virtual tabs mount the requested readonly pane in view mode, never a competing pane',()=>{
 const api=createAddonWebApi(null);
 const path='piclaw://addon/example/review-1';
 let opened:string|null=null;
 api.registerPane({id:'requested',placement:'tabs',capabilities:['readonly'],canHandle:(c:any)=>c.path===path&&c.mode==='view',mount(){}});
 api.registerPane({id:'competing',placement:'tabs',capabilities:['readonly'],canHandle:(c:any)=>c.path===path&&c.mode==='view'?10:false,mount(){}});
 const unbind=bindAddonPaneLauncher((_path,options)=>{opened=options.paneOverrideId;});
 expect(api.openPane({path,paneId:'requested'})).toBe(true);
 expect(opened).toBe('requested');
 expect(paneRegistry.resolve({path,mode:'view'},opened)?.id).toBe('requested');
 expect(paneRegistry.resolve({path,mode:'view'})?.id).toBe('competing');
 paneRegistry.unregister('requested');
 expect(paneRegistry.resolve({path,mode:'view'},opened)?.id).toBe('addon-unavailable');
 paneRegistry.register({id:'requested',placement:'tabs',capabilities:['edit'],canHandle:()=>true,mount(){}});
 expect(paneRegistry.resolve({path,mode:'view'},opened)?.id).toBe('addon-unavailable');
 unbind();
});

test('missing virtual addon never resolves editable fallback or appears in filesystem recents',async()=>{
 paneRegistry.register({id:'test-editor',label:'Editor',placement:'tabs',capabilities:['edit'],canHandle:()=>100,mount(){throw Error('must not mount');}});
 const path='piclaw://addon/missing/review-1';
 expect(paneRegistry.resolve({path,mode:'edit'})!.id).toBe('addon-unavailable');
 expect(paneRegistry.resolve({path:'src/a.ts',mode:'edit'})!.id).toBe('test-editor');
 expect(normalizeRecentFiles([path,'src/a.ts'])).toEqual(['src/a.ts']);
 let calls=0;globalThis.fetch=(async()=>{calls++;throw Error('must not stat virtual path');}) as typeof fetch;
 await openRecentFile(path,()=>{calls++;});expect(calls).toBe(0);
});
