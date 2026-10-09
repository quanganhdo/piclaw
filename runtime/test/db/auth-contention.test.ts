import { expect,test } from "bun:test";
import { withTempWorkspaceEnv } from "../helpers.js";
for(const mode of ["modern","missing","expired","malformed","expired-legacy","malformed-legacy","legacy-token","legacy-id"]){
  test(`WAL writer and gateway auth: ${mode}`,async()=>{
    await withTempWorkspaceEnv("auth-wal-",{},async()=>{
      const child=Bun.spawn([process.execPath,"--no-env-file",new URL("../fixtures/auth-contention.ts",import.meta.url).pathname,mode,"250","instrument"],{env:{...process.env,PICLAW_DB_IN_MEMORY:"0",PI_OFFLINE:"1",OTEL_SDK_DISABLED:"true"},stdin:"ignore",stdout:"pipe",stderr:"pipe"});
      const timer=setTimeout(()=>child.kill("SIGKILL"),20000);
      try{
        const[stdout,stderr,exit]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);expect(exit,stderr).toBe(0);
        const row=JSON.parse(stdout.trim().split("\n").at(-1)!);expect(row).toMatchObject({mode,errorCode:null,network:0,afterReleaseCorrect:true});
        if(!mode.startsWith("legacy-")){expect(row.writerReleasedAtReturn).toBe(false);expect(Object.keys(row.metrics)).toEqual(["SELECT.get"]);}
      }finally{clearTimeout(timer);if(child.exitCode===null)child.kill("SIGKILL");await child.exited;}
    });
  },25000);
}
