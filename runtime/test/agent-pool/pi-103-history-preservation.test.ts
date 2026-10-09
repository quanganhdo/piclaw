import { expect,test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root=resolve(import.meta.dir,'../../..');
const rows=JSON.parse(readFileSync(resolve(root,'runtime/test/fixtures/earendil-102-preserved-hashes.json'),'utf8')) as Array<{path:string;sha256:string}>;
test('retarget preserves all twelve immutable Pi1.0.2 JSON receipts as historical evidence',()=>{
 expect(rows).toHaveLength(12);
 for(const row of rows)expect(createHash('sha256').update(readFileSync(resolve(root,row.path))).digest('hex'),row.path).toBe(row.sha256);
});
