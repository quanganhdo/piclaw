import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { createTempWorkspace } from '../../helpers.js';

// Config paths are bootstrap-scoped: each case must own a fresh process/store.
for (const name of [
  "large chat attachment completes outside DB and never publishes a partial target",
  "full configured 512 MiB boundary succeeds in bounded chunks with no multipart overhead",
  "rejects excess size, malformed names and incorrect chunk bodies/sequences",
  "rejects symlink upload destinations and does not write outside workspace",
  "rejects family workspace spillover, staging symlinks and unauthorised routes",
  "same upload cannot receive concurrent chunks while a body is pending",
  "stalled or oversized bodies are cancelled and slots remain bounded",
  "legacy compose setting is an alias of the common upload limit"
]) test(name, async () => {
  const ws=createTempWorkspace('piclaw-large-upload-');
  try {
    const env={...process.env,PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data,PICLAW_DB_IN_MEMORY:'1',PICLAW_WEB_WORKSPACE_UPLOAD_LIMIT_MB:'512'};
    const proc=Bun.spawn([process.execPath,join(import.meta.dir,'../../fixtures/workspace-attachment-upload.ts'),name],{env,stdout:'pipe',stderr:'pipe'});
    const [out,err,code]=await Promise.all([new Response(proc.stdout).text(),new Response(proc.stderr).text(),proc.exited]);
    expect({code,err:code===0?'':err}).toEqual({code:0,err:''});
    expect(out).toContain('PASS '+name);
  } finally {ws.cleanup();}
}, 30000);
