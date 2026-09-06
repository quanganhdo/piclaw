import { hasScheduledDispatch } from "./scheduled-dispatch-context.js";

type RetrySettings = {enabled:boolean;maxRetries:number;baseDelayMs:number};
interface Settings {getRetrySettings:()=>RetrySettings}
const overrides=new WeakMap<Settings,{references:number;restore:()=>void}>();

/** Shared managers retain ordinary-run behaviour; scheduled overlaps restore only after the last holder. */
export function suppressScheduledRetries(settings:Settings):()=>void {
  if(typeof settings?.getRetrySettings!=="function")throw new Error("Scheduled execution requires SDK retry controls.");
  let entry=overrides.get(settings);
  if(!entry){
    const descriptor=Object.getOwnPropertyDescriptor(settings,"getRetrySettings"),original=settings.getRetrySettings;
    const replacement=()=>{const value=original.call(settings);return hasScheduledDispatch()?{...value,enabled:false,maxRetries:0}:value;};
    Object.defineProperty(settings,"getRetrySettings",{configurable:true,value:replacement});
    entry={references:0,restore:()=>{
      if(descriptor)Object.defineProperty(settings,"getRetrySettings",descriptor);
      else delete (settings as unknown as Record<string,unknown>).getRetrySettings;
    }};
    overrides.set(settings,entry);
  }
  entry.references++;let released=false;
  return ()=>{if(released)return;released=true;if(--entry!.references===0){entry!.restore();overrides.delete(settings);}};
}
