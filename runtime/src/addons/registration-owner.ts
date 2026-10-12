import { AsyncLocalStorage } from 'node:async_hooks';
export interface AddonRegistrationOwner { readonly addonId:string; readonly packageName:string; readonly entryPath:string }
const context=new AsyncLocalStorage<{owner:AddonRegistrationOwner;active:boolean;rollback:Array<()=>void>}>();
export function retainAddonRegistrationRollback(dispose:()=>void):void {const scope=context.getStore();if(!scope?.active)throw Error('Registration scope expired.');scope.rollback.push(dispose);}
/** Import-time owner is scoped to its async chain and expires when entry loading ends. */
export async function withAddonRegistrationOwner<T>(owner:AddonRegistrationOwner,run:()=>Promise<T>):Promise<T>{
 if(context.getStore()?.active)throw Error('Nested add-on registration contexts are unsupported.');
 const scope={owner:Object.freeze({...owner}),active:true,rollback:[] as Array<()=>void>};
 return context.run(scope,async()=>{try{return await run();}catch(error){for(const dispose of scope.rollback.reverse())dispose();throw error;}finally{scope.active=false;scope.rollback=[];}});
}
/** Bun's dynamic module evaluation may not inherit ALS; bind the host API to the expiring import scope. */
export function bindAddonRegistration<T extends (...args:any[])=>any>(callback:T):T {
 const scope=context.getStore();if(!scope?.active)throw Error('Registration scope unavailable.');
 return ((...args:Parameters<T>)=>{if(!scope.active)throw Error('Registration scope expired.');return context.run(scope,()=>callback(...args));}) as T;
}
export function getAddonRegistrationOwner():AddonRegistrationOwner|null{const scope=context.getStore();return scope?.active?scope.owner:null;}
