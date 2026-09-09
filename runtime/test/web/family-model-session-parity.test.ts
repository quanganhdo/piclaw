import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectFamilyModelState } from '../../src/channels/web/http/family-model-control.js';
import { readModelCataloguePreferences, togglePinnedModelKey } from '../../web/src/ui/model-catalogue-preferences.js';
import { readSessionPickerPreferences, togglePinnedSessionChatJid } from '../../web/src/ui/session-picker-preferences.js';

function preferenceRuntime() {
  const values = new Map<string,string>();
  const target = new EventTarget() as EventTarget & { localStorage: { getItem(key:string):string|null; setItem(key:string,value:string):void } };
  target.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key,value) => values.set(key,value) };
  return target;
}

test('family model projection keeps curated metadata and omits provider/shared diagnostics', () => {
  const projected = projectFamilyModelState({
    current:'provider/model',models:['provider/model'],model_options:[{label:'provider/model',provider:'provider',id:'model',name:'Model',context_window:128000,pricing:{input_per_million:1,output_per_million:2,cache_read_per_million:null,cache_write_per_million:null},reasoning:true,thinking_levels:['off','high'],thinking_level_labels:['Off','High']}],
    thinking_level:'high',thinking_level_label:'High',supports_thinking:true,available_thinking_levels:['off','high'],available_thinking_level_labels:['Off','High'],provider_usage:{token:'secret'} as any,latest_requested_model:'provider/model',latest_response_model:'provider/model',scoped_models_only:true,scoped_model_filter_active:true,enabled_model_patterns:['provider/*'],provider_diagnostics:{providers:[{auth_label:'secret'}] as any,registered_provider_ids:['provider'],composition_error:null},
  }, {tokens:1000,contextWindow:128000,percent:1});
  expect(projected.model_options[0]).toMatchObject({ label:'provider/model', context_window:128000, reasoning:true });
  expect(projected.context_usage).toEqual({tokens:1000,contextWindow:128000,percent:1});
  const text=JSON.stringify(projected);
  for(const secret of ['provider_usage','provider_diagnostics','enabled_model_patterns','scoped_models_only','auth_label','secret']) expect(text).not.toContain(secret);
});

test('picker pins and recents remain isolated by injected account runtime', () => {
  const alice=preferenceRuntime(),bob=preferenceRuntime();
  togglePinnedModelKey('provider/model',alice);
  togglePinnedSessionChatJid('web:alice',alice);
  expect(readModelCataloguePreferences(alice).pinnedKeys).toEqual(['provider/model']);
  expect(readSessionPickerPreferences(alice).pinnedChatJids).toEqual(['web:alice']);
  expect(readModelCataloguePreferences(bob).pinnedKeys).toEqual([]);
  expect(readSessionPickerPreferences(bob).pinnedChatJids).toEqual([]);
});

test('family adapter reuses standard model/session and account-scoped compose controls without rollup, purge, or model settings', () => {
  const root=join(import.meta.dir,'../../web/src');
  const family=readFileSync(join(root,'family-chat-surface.ts'),'utf8');
  const compose=readFileSync(join(root,'components/compose-box.ts'),'utf8');
  expect(family).toContain('modelPicker: true');
  for(const disabled of ['modelSettings: false','modelCompaction: false','sessionRollup: false']) expect(family).toContain(disabled);
  expect(family).toContain('persistBrowserState: true');
  expect(family).toContain('browserStorage: this.composeBrowserStorage');
  expect(family).toContain('preferenceRuntime: this.preferenceRuntime');
  expect(family).not.toContain('onPurgeArchivedSession:');
  expect(family).toContain('this.snapshot.currentChatJid !== sourceChatJid');
  expect(compose).toContain('preferenceRuntime = undefined');
  expect(readFileSync(join(import.meta.dir,'../../src/agent-pool/runtime-facade.ts'),'utf8')).toContain('allowCompaction: false');
  expect(compose).toContain('onSelectThinking');
});
