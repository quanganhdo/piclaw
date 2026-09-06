/**
 * test/runtime-single-instance.test.ts – runtime lock regression tests.
 */

import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createTempWorkspace, importFresh } from "./helpers.js";

function makeInspector(pid: number, activePids = new Set<number>(), command = "bun /usr/local/bin/piclaw --port 8080") {
  return {
    pid,
    now: () => new Date("2026-05-18T16:00:00.000Z"),
    isAlive: (candidate: number) => activePids.has(candidate),
    commandLine: (candidate: number) => activePids.has(candidate) ? command : null,
  };
}

test("runtime lock rejects a second active Piclaw runtime", async () => {
  const ws = createTempWorkspace("piclaw-runtime-lock-active-");
  try {
    const lockPath = join(ws.store, "runtime.lock");
    mkdirSync(ws.store, { recursive: true });
    writeFileSync(lockPath, JSON.stringify({
      pid: 4242,
      startedAt: "2026-05-18T15:40:40.000Z",
      workspace: ws.workspace,
      command: "bun /usr/local/bin/piclaw --port 8080",
    }));

    const { acquireRuntimeLock } = await importFresh<typeof import("../src/runtime/single-instance.js")>("../src/runtime/single-instance.js");
    expect(() => acquireRuntimeLock({ lockPath, inspector: makeInspector(9999, new Set([4242])) })).toThrow(/already running/);
  } finally {
    ws.cleanup();
  }
});

test("runtime lock removes a stale owner and writes the new owner", async () => {
  const ws = createTempWorkspace("piclaw-runtime-lock-stale-");
  try {
    const lockPath = join(ws.store, "runtime.lock");
    mkdirSync(ws.store, { recursive: true });
    writeFileSync(lockPath, JSON.stringify({
      pid: 4242,
      startedAt: "2026-05-18T15:40:40.000Z",
      workspace: ws.workspace,
      command: "bun /usr/local/bin/piclaw --port 8080",
    }));

    const { acquireRuntimeLock } = await importFresh<typeof import("../src/runtime/single-instance.js")>("../src/runtime/single-instance.js");
    const handle = acquireRuntimeLock({ lockPath, inspector: makeInspector(9999) });
    const next = JSON.parse(readFileSync(lockPath, "utf8")) as { pid: number };
    expect(next.pid).toBe(9999);
    handle.release();
  } finally {
    ws.cleanup();
  }
});

test('maintenance refuses malformed/live owners and runtime recognises an active maintenance owner regardless of command', async () => {
  const ws=createTempWorkspace('piclaw-maintenance-lock-');
  try {
    const {acquireRuntimeLock}=await importFresh<typeof import('../src/runtime/single-instance.js')>('../src/runtime/single-instance.js');
    const lockPath=join(ws.store,'runtime.lock');
    writeFileSync(lockPath,'broken');expect(()=>acquireRuntimeLock({lockPath,maintenance:true,disabled:false,inspector:makeInspector(9999)})).toThrow('already running');
    writeFileSync(lockPath,JSON.stringify({pid:4242,command:'unrecognised'}));expect(()=>acquireRuntimeLock({lockPath,maintenance:true,disabled:false,inspector:makeInspector(9999,new Set([4242]),'unrelated')})).toThrow();
    const handle=acquireRuntimeLock({lockPath,maintenance:true,disabled:false,inspector:makeInspector(9999)});
    expect(handle.record.kind).toBe('maintenance');expect(()=>acquireRuntimeLock({lockPath,disabled:false,inspector:makeInspector(8888,new Set([9999]),'bun offline-script.ts')})).toThrow();handle.release();
  } finally {ws.cleanup();}
});
