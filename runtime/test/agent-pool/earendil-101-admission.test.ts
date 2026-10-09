import {expect,test} from 'bun:test';
import{readFileSync}from'node:fs';import{resolve,join}from'node:path';
import{matchNegativeDiagnostics,missingSeams}from'../../../scripts/check-earendil-mcp-public-101.js';
const root=resolve(import.meta.dir,'../../..'),receipts=join(root,'docs/design/earendil-agent-harness-integration-adr/evidence/receipts');
test('historical1.0.1 MCP receipt retains ten documented public gaps',()=>{const receipt=JSON.parse(readFileSync(join(receipts,'earendil-101-mcp-public.json'),'utf8'));expect(receipt.compile.version).toBe('1.0.1');expect(receipt.compile.nativeParity).toBe('not_qualified');expect(receipt.compile.productionActivation).toBe(false);expect(receipt.compile.negative).toEqual(missingSeams);});
test('missing and altered1.0.1 gap diagnostics do not pass',()=>{const text=missingSeams.map(row=>`negative.ts(1,1): error ${row.code}: synthetic ${row.symbol}`).join('\n');expect(matchNegativeDiagnostics(text)).toHaveLength(10);expect(()=>matchNegativeDiagnostics(text.split('\n').slice(1).join('\n'))).toThrow('exactly 10');expect(()=>matchNegativeDiagnostics(text.replace('TS2740','TS2307'))).toThrow();});
