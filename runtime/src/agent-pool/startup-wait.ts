/** Bound one caller's startup wait without cancelling shared runtime ownership. */
export async function waitForRuntimeStartup<T>(pending:Promise<T>,timeoutMs:number,signal?:AbortSignal):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 let abort:()=>void=()=>{};
 try{
  const cancelled=new Promise<never>((_,reject)=>{abort=()=>reject(Error('Runtime startup cancelled.'));signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();});
  const deadline=new Promise<never>((_,reject)=>{if(timeoutMs>0)timer=setTimeout(()=>reject(Error('Runtime startup timed out.')),timeoutMs);});
  return await Promise.race([pending,cancelled,deadline]);
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
