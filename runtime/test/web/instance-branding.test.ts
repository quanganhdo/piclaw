import { afterEach, expect, test } from 'bun:test';
import { applyBrandingIconLinks, applyInstanceBranding, refreshInstanceBranding } from '../../web/src/ui/instance-branding.js';
import { projectFamilySseEvent } from '../../src/channels/web/sse/family-event-projector.js';
const original = { document: (globalThis as any).document, fetch: globalThis.fetch };
afterEach(() => { (globalThis as any).document = original.document; globalThis.fetch = original.fetch; });
function setup() {
  const links = new Map(['dynamic-manifest','dynamic-favicon','dynamic-apple-touch-icon','dynamic-apple-touch-icon-180','dynamic-apple-touch-icon-167','dynamic-apple-touch-icon-152','dynamic-apple-touch-icon-precomposed'].map(id => [id, { href: '' }]));
  let title = '';
  (globalThis as any).document = { getElementById: (id: string) => links.get(id), querySelector: () => ({ setAttribute: (_key: string, value: string) => { title = value; } }) };
  return { links, title: () => title };
}
test('instance branding uses revision, clears all links, rejects branch identity', () => {
  const f = setup();
  applyInstanceBranding({agent_id:'default',agent_name:'Fixture',agent_avatar:'/avatar/agent?v=abc'});
  expect(f.title()).toBe('Fixture');
  for (const link of f.links.values()) expect(link.href).toEndWith('?v=abc');
  applyInstanceBranding({agent_id:'branch',agent_name:'Other',agent_avatar:'/avatar/agent?v=bad'});
  expect(f.title()).toBe('Fixture');
  applyInstanceBranding({agent_id:'default',agent_avatar:null});
  for (const link of f.links.values()) expect(link.href).toEndWith('?v=default');
});
test('older manifest fetch cannot undo an incoming profile event', async () => {
  const f = setup(); let resolve!: (value: Response) => void;
  globalThis.fetch = (() => new Promise<Response>(r => { resolve = r; })) as typeof fetch;
  const pending = refreshInstanceBranding();
  applyInstanceBranding({agent_id:'default',agent_name:'New',agent_avatar:'/avatar/agent?v=new'});
  resolve(Response.json({name:'Old',piclaw_avatar:'/avatar/agent?v=old'})); await pending;
  expect(f.links.get('dynamic-favicon')!.href).toBe('/favicon.ico?v=new'); expect(f.title()).toBe('New');
});
test('branding compares href attributes, avoiding redundant same-revision mutations', () => {
  let writes = 0;
  applyBrandingIconLinks({getElementById: id => ({getAttribute: () => id === 'dynamic-favicon' ? '/favicon.ico?v=abc' : null, set href(_value: string) { writes++; }})}, 'abc');
  expect(writes).toBe(6);
});
test('family profile projection strips operator identity, paths, diagnostics and arbitrary avatar query data', () => {
  expect(projectFamilySseEvent('profile_update', {agent_id:'default',agent_name:'Fixture',agent_avatar:'/avatar/agent?v=abc123',user_name:'Private',user_avatar:'/private',config:{secret:'x'}})).toEqual({agent_id:'default',agent_name:'Fixture',agent_avatar:'/avatar/agent?v=abc123'});
  for (const agent_avatar of ['/workspace/private.png','https://private.invalid/image','/avatar/agent?source=/private']) expect((projectFamilySseEvent('profile_update', {agent_id:'default',agent_avatar}) as any).agent_avatar).toBeNull();
  for (const agent_id of ['branch', 'operator', undefined]) expect(projectFamilySseEvent('profile_update', {agent_id,agent_name:'Private',agent_avatar:'/avatar/agent?v=abc'})).toBeNull();
});
