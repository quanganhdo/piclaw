import { expect, test } from 'bun:test';
import type { JsonRpcMessage, McpTransport } from '@earendil-works/pi-mcp';
import { constrainNativeTransport } from '../../src/agent-pool/mcp-native-transport';
function fixture() {
  let listener: (message: JsonRpcMessage) => void = () => {};
  const sent: JsonRpcMessage[] = [];
  let closes = 0;
  const transport: McpTransport = { start: async () => {}, send: async m => { sent.push(m); }, close: async () => { closes++; throw Error('raw close failed'); }, onMessage: f => { listener = f; return () => {}; }, onClose: () => () => {}, onError: () => () => {} };
  return { transport, sent, emit: (m: JsonRpcMessage) => listener(m), closes: () => closes };
}
test('Native tool-only transport strips resource/prompt capabilities and rejects direct access', async () => {
  const f = fixture(), owner = constrainNativeTransport(f.transport), received: JsonRpcMessage[] = [];
  owner.transport.onMessage(m => received.push(m));
  f.emit({ jsonrpc: '2.0', id: 1, result: { capabilities: { tools: {}, resources: { subscribe: true }, prompts: {} }, protocolVersion: '2025-03-26' } });
  expect(received).toEqual([{ jsonrpc: '2.0', id: 1, result: { capabilities: { tools: {} }, protocolVersion: '2025-03-26' } }]);
  for (const method of ['resources/list', 'resources/read', 'resources/templates/list', 'resources/subscribe', 'prompts/list', 'prompts/get']) {
    await expect(owner.transport.send({ jsonrpc: '2.0', id: 2, method })).rejects.toThrow('disables resources and prompts');
  }
  await owner.transport.send({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
  expect(f.sent).toEqual([{ jsonrpc: '2.0', id: 3, method: 'tools/list' }]);
});
test('Native close seals start and send admission while raw cleanup is held and after completion', async () => {
  let starts = 0, sends = 0, closes = 0;
  let release!: () => void;
  const held = new Promise<void>(resolve => release = resolve);
  const raw: McpTransport = {
    start: async () => { starts++; },
    send: async () => { sends++; },
    close: () => { closes++; return held; },
    onMessage: () => () => {}, onClose: () => () => {}, onError: () => () => {},
  };
  const owner = constrainNativeTransport(raw);
  await owner.transport.start();
  await owner.transport.send({ jsonrpc: '2.0', id: 1, method: 'tools/call' });
  await expect(owner.transport.send({ jsonrpc: '2.0', id: 2, method: 'resources/list' })).rejects.toThrow('disables resources and prompts');
  expect([starts, sends, closes]).toEqual([1, 1, 0]);
  const pending = owner.close();
  try {
    expect(owner.close()).toBe(pending);
    await expect(owner.transport.start()).rejects.toThrow('Native MCP transport is closing.');
    await expect(owner.transport.send({ jsonrpc: '2.0', id: 3, method: 'tools/call' })).rejects.toThrow('Native MCP transport is closing.');
    await expect(owner.transport.send({ jsonrpc: '2.0', id: 4, method: 'resources/list' })).rejects.toThrow('Native MCP transport is closing.');
    expect([starts, sends, closes]).toEqual([1, 1, 1]);
  } finally { release(); await pending; }
  await expect(owner.transport.start()).rejects.toThrow('Native MCP transport is closing.');
  await expect(owner.transport.send({ jsonrpc: '2.0', id: 5, method: 'tools/call' })).rejects.toThrow('Native MCP transport is closing.');
  expect([starts, sends, closes]).toEqual([1, 1, 1]);
});

test('Native failed close stays cached and keeps start and send admission sealed', async () => {
  const f = fixture();
  let starts = 0;
  f.transport.start = async () => { starts++; };
  const owner = constrainNativeTransport(f.transport);
  await owner.transport.start();
  const pending = owner.close();
  await expect(pending).rejects.toThrow('raw close failed');
  expect(owner.close()).toBe(pending);
  expect(owner.closeFailure).toBeInstanceOf(Error);
  expect((owner.closeFailure as Error).message).toBe('raw close failed');
  await expect(owner.transport.start()).rejects.toThrow('Native MCP transport is closing.');
  await expect(owner.transport.send({ jsonrpc: '2.0', id: 1, method: 'tools/call' })).rejects.toThrow('Native MCP transport is closing.');
  await expect(owner.close()).rejects.toThrow('raw close failed');
  expect(starts).toBe(1);
  expect(f.sent).toEqual([]);
  expect(f.closes()).toBe(1);
});

test('Native transport rejects server-side model/user interaction and retains raw close failure', async () => {
  const f = fixture(), owner = constrainNativeTransport(f.transport), received: JsonRpcMessage[] = [];
  owner.transport.onMessage(m => received.push(m));
  f.emit({ jsonrpc: '2.0', id: 7, method: 'sampling/createMessage' });
  f.emit({ jsonrpc: '2.0', method: 'notifications/resources/list_changed' });
  expect(received).toEqual([]);
  await Promise.resolve();
  expect(f.sent[0]).toMatchObject({ id: 7, error: { code: -32601 } });
  const first = owner.close();
  expect(owner.close()).toBe(first);
  await expect(first).rejects.toThrow('raw close failed');
  await expect(owner.close()).rejects.toThrow('raw close failed');
  expect(f.closes()).toBe(1);
});

test('Native close waits for a held policy-denial response before acknowledging cleanup', async () => {
  let listener: (m: JsonRpcMessage) => void = () => {};
  let release!: () => void;
  const held = new Promise<void>(resolve => release = resolve);
  const transport: McpTransport = { start: async () => {}, send: () => held, close: async () => {}, onMessage: f => { listener = f; return () => {}; }, onClose: () => () => {}, onError: () => () => {} };
  const owner = constrainNativeTransport(transport);
  owner.transport.onMessage(() => {});
  listener({ jsonrpc: '2.0', id: 1, method: 'elicitation/create' });
  let closed = false;
  const pending = owner.close().then(() => closed = true);
  await Promise.resolve(); await Promise.resolve();
  expect(closed).toBe(false);
  release(); await pending;
  expect(closed).toBe(true);
});

test('hybrid response/request envelope cannot smuggle a forbidden method and blocks clean acknowledgement', async () => {
  let listener:(m:JsonRpcMessage)=>void=()=>{};
  let closes=0;
  const raw:McpTransport={start:async()=>{},send:async()=>{},close:async()=>{closes++;},onMessage:f=>{listener=f;return()=>{};},onError:()=>()=>{},onClose:()=>()=>{}};
  const owner=constrainNativeTransport(raw),received:JsonRpcMessage[]=[];owner.transport.onMessage(m=>received.push(m));
  listener({jsonrpc:'2.0',id:1,method:'resources/read',result:{capabilities:{tools:{}}}} as any);
  expect(received).toEqual([]);
  await expect(owner.close()).rejects.toThrow('malformed JSON-RPC');expect(closes).toBe(1);
});
