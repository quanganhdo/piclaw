import { expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTempWorkspace } from './helpers.js';

function validateClockCapture(source: string): void {
  const captures = [...source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*Date\s*\.\s*now\b(?!\s*\()/g)];
  if (captures.length !== 1 || captures[0][1] !== 'realDateNow'
    || !/^const realDateNow = Date\.now;$/m.test(source)) {
    throw new Error('Dream fixture must capture Date.now exactly once, at module scope');
  }
}

test('Dream clock capture guard rejects renamed and same-name local shadows', () => {
  const source = readFileSync(join(import.meta.dir,'dream-agent-turn.test.ts'),'utf8');
  validateClockCapture(source);
  for (const declaration of ['const realNow = Date.now;', 'const realDateNow = Date.now;', 'let capturedClock = Date.now;', 'var saved = Date.now;']) {
    const shadowed = source.replace('  const fixedNow =', `  ${declaration}\n  const fixedNow =`);
    expect(() => validateClockCapture(shadowed)).toThrow('exactly once');
  }
});

// Derive the cleanup statements from the actual Dream fixture. The child has
// one intentional timeout; later assertions must still observe a real clock.
test('Dream timeout cleanup cannot recapture or restore a frozen clock after a late finally', async () => {
  const source = readFileSync(join(import.meta.dir,'dream-agent-turn.test.ts'),'utf8');
  const moduleCapture = source.match(/^const realDateNow = Date\.now;$/m)?.[0] || '';
  const hook = source.match(/afterEach\(\(\) => \{([\s\S]*?)\n\}\);/)?.[1];
  validateClockCapture(source);
  const restores = [...source.matchAll(/Date\.now = (realDateNow|realNow);/g)].map(match=>match[0]);
  const finallyRestore = restores.at(-1);
  if (hook === undefined || !finallyRestore) throw new Error('Dream cleanup statements not found');
  expect(moduleCapture).toBe('const realDateNow = Date.now;');
  const finallyRestores = [...source.matchAll(/finally \{\s*Date\.now = ([A-Za-z]+);/g)].map(match=>match[1]);
  expect(finallyRestores).toEqual(['realDateNow','realDateNow']);
  const ws = createTempWorkspace('dream-clock-regression-');
  try {
    const file=join(ws.workspace,'clock-race.test.ts');
    writeFileSync(file,`import {afterEach,expect,test} from 'bun:test';
const nativeClock = Date.now;
${moduleCapture}
afterEach(()=>{${hook}
});
let releaseLate:()=>void;
const lateFinished=new Promise<void>(resolve=>{releaseLate=resolve;});
test('intentional timeout while Dream clock is frozen',async()=>{
 Date.now=()=>1000;
 try { await Bun.sleep(80); }
 finally { ${finallyRestore} releaseLate!(); }
},15);
test('next fixture must not restore a stale clock',async()=>{
 const observedAtStart=Date.now;
 Date.now=()=>2000;
 try { await lateFinished; }
 finally { ${finallyRestore} }
 expect(observedAtStart).toBe(nativeClock);
 expect(Date.now).toBe(nativeClock);
 console.log('REAL_CLOCK_AFTER_LATE_FINALLY');
},1000);
test('idle deadlines advance after timed-out Dream',async()=>{
 const before=Date.now();await Bun.sleep(20);expect(Date.now()-before).toBeGreaterThanOrEqual(10);
 console.log('REAL_CLOCK_ADVANCES');
},1000);
`);
    const env = { ...process.env };
    delete env.BUN_OPTIONS;
    const child=Bun.spawn(['bun','test',file],{cwd:ws.workspace,stdout:'pipe',stderr:'pipe',env});
    let timedOut = false;
    const timeout = setTimeout(()=>{ timedOut=true; child.kill('SIGKILL'); },3000);
    let out: string, err: string, code: number;
    try {
      [out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
    } finally { clearTimeout(timeout); }
    expect(timedOut).toBe(false);
    const output=out+err;
    expect(code).toBe(1); // Exactly the intentional timeout must fail.
    expect(output).toContain('1 fail');
    expect(output).toContain('2 pass');
    expect(output).toContain('REAL_CLOCK_AFTER_LATE_FINALLY');
    expect(output).toContain('REAL_CLOCK_ADVANCES');
  } finally {ws.cleanup();}
},5000);
