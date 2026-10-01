import {expect,test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dir,'../../..');

test('retained adapter exposes configured lifecycle/socket/request timeout while native exact target does not',()=>{
 const adapterTypes=readFileSync(resolve(root,'node_modules/pi-mcp-adapter/types.ts'),'utf8');
 expect(adapterTypes).toContain('socket?: string');expect(adapterTypes).toContain('lifecycle?: "keep-alive" | "lazy" | "lazy-keep-alive" | "eager"');expect(adapterTypes).toContain('requestTimeoutMs?: number');
 const nativeTypes=readFileSync(resolve(root,'node_modules/@earendil-works/pi-coding-agent/dist/core/mcp-servers.d.ts'),'utf8');
 const nativeOptions=readFileSync(resolve(root,'node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/index.d.ts'),'utf8');
 expect(nativeTypes).not.toContain('socket?:');expect(nativeTypes).not.toContain('lifecycle?:');expect(nativeOptions).not.toContain('absoluteDeadline');
});

test('adapter source keeps caller abort, request timeout, shutdown and no mutating transient retry',()=>{
 const manager=readFileSync(resolve(root,'node_modules/pi-mcp-adapter/server-manager.ts'),'utf8');
 expect(manager).toContain('combineAbortSignals(this.runtimeSignal, signal)');expect(manager).toContain('requestTimeoutMs');expect(manager).toContain('closeAll');
 const recovery=readFileSync(resolve(root,'node_modules/pi-mcp-adapter/session-recovery.ts'),'utf8');
 expect(recovery).toContain('if (!isTerminatedSession(err, hadSessionId))');
 const predicate=recovery.slice(recovery.indexOf('export function isTerminatedSession'),recovery.indexOf('function hasSessionId'));
 expect(predicate).toContain('err.status === 404');expect(predicate).toContain('err.status === 400');
 expect(predicate).not.toContain('status === 500');expect(recovery).toContain('throw err');
});
