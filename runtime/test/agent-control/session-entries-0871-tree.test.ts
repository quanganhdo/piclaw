import { expect, test } from 'bun:test';
import { buildSessionTreeSnapshot } from '../../src/agent-control/session-tree-snapshot.js';
import { AgentRuntimeFacade } from '../../src/agent-pool/runtime-facade.js';

const stamp = '2026-09-06T00:00:00.000Z';
const entries = [
  { type: 'usage', id: 'usage', parentId: null, timestamp: stamp, kind: 'cache_warm', provider: 'test', model: 'fixture' },
  { type: 'context_edit', id: 'edit', parentId: 'usage', timestamp: stamp, targetId: 'message', replacement: { content: 'replacement' } },
  { type: 'context_edit', id: 'omit', parentId: 'edit', timestamp: stamp, targetId: 'message', replacement: null },
];
const roots = [{ entry: entries[0], children: [{ entry: entries[1], children: [{ entry: entries[2], children: [] }] }] }];

test('snapshot describes 0.87.1 usage, replacement and omission records', () => {
  const tree = buildSessionTreeSnapshot({ getLeafId: () => 'omit', getTree: () => roots } as any);
  expect(tree.nodes.map((node) => node.preview)).toEqual([
    '[usage cache_warm: test/fixture]', '[context replace message]', '[context omit message]',
  ]);
});

test('text tree describes the same entries', async () => {
  const session = { sessionManager: { getLeafId: () => 'omit', getTree: () => roots } };
  const snapshot=buildSessionTreeSnapshot(session.sessionManager as any);
  const facade=new AgentRuntimeFacade({pool:new Map(),authPath:'unused',modelRegistry:{} as any,modelRuntime:{} as any,
    getDurableSession:()=>({sessionId:'imported',branchId:'main',readPosition:async()=>'omit',readTree:async()=>snapshot})});
  const result=await facade.applyControlCommand('web:imported',{type:'tree',raw:'/tree',mode:'head',limit:10});
  expect(result.message).toContain('[usage cache_warm: test/fixture]');
  expect(result.message).toContain('[context replace message]');
  expect(result.message).toContain('[context omit message]');
});
