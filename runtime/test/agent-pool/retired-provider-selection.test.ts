import { expect, test } from 'bun:test';
import { SettingsManager, SessionManager } from '@earendil-works/pi-coding-agent';
import { assertCurrentProviderSelection } from '../../src/agent-pool/retired-provider-selection.js';

test('retired Azure defaults, patterns and thinking keys fail before provider fallback',()=>{
 for(const settings of [{defaultProvider:'azure-openai-responses',defaultModel:'synthetic'},{enabledModels:['azure-openai-responses/*']},{modelThinkingLevels:{'azure-openai-responses/synthetic':'high'}}]){
  expect(()=>assertCurrentProviderSelection(SettingsManager.inMemory(settings as any),SessionManager.inMemory())).toThrow('renamed the Azure provider to azure');
 }
});
test('latest branch model identity is checked without rejecting unrelated historical Azure choices',()=>{
 const manager=SessionManager.inMemory();manager.appendModelChange('azure-openai-responses','synthetic');
 expect(()=>assertCurrentProviderSelection(SettingsManager.inMemory(),manager)).toThrow('will not substitute');
 manager.appendModelChange('azure','synthetic');
 expect(()=>assertCurrentProviderSelection(SettingsManager.inMemory(),manager)).not.toThrow();
});
test('legacy assistant-derived model identity fails closed and newer assistant identity supersedes it',()=>{
 const manager=SessionManager.inMemory();
 const message=(provider:string)=>({role:'assistant' as const,api:'azure-openai-responses' as const,provider,model:'synthetic',content:[{type:'text' as const,text:'Synthetic response'}],usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop' as const,timestamp:1});
 manager.appendMessage(message('azure-openai-responses'));
 expect(()=>assertCurrentProviderSelection(SettingsManager.inMemory(),manager)).toThrow('will not substitute');
 manager.appendMessage(message('azure'));
 expect(()=>assertCurrentProviderSelection(SettingsManager.inMemory(),manager)).not.toThrow();
});
test('custom Piclaw Azure identities and API names are not renamed',()=>{
 for(const provider of ['azure','azure-openai','azure-foundry']){
  const manager=SessionManager.inMemory();manager.appendModelChange(provider,'synthetic');
  expect(()=>assertCurrentProviderSelection(SettingsManager.inMemory({defaultProvider:provider,enabledModels:[provider+'/*']}),manager)).not.toThrow();
 }
});
