import { expect, test } from 'bun:test';

import {
  countAvailableModels,
  isProviderReadyCompletedForInstance,
  resolveOobePanelState,
} from '../../web/src/ui/oobe-state.ts';

test('countAvailableModels prefers structured model options and falls back to legacy model labels', () => {
  expect(countAvailableModels({ model_options: [{ label: 'openai/gpt-4.1' }, { label: 'anthropic/claude-sonnet-4' }] })).toBe(2);
  expect(countAvailableModels({ models: ['openai/gpt-4.1', ''] })).toBe(1);
  expect(countAvailableModels(null)).toBe(0);
});

test('resolveOobePanelState shows the provider-missing panel when no models are loaded for this instance', () => {
  expect(resolveOobePanelState({
    modelsLoaded: true,
    modelPayload: { models: [] },
  })).toEqual({
    kind: 'provider-missing',
    hasAvailableModels: false,
    availableModelCount: 0,
    hasConfiguredModelHint: false,
  });
});

test('resolveOobePanelState suppresses provider-missing when a current model is already configured', () => {
  expect(resolveOobePanelState({
    modelsLoaded: true,
    modelPayload: { current: 'openai/gpt-4.1', models: [] },
  })).toEqual({
    kind: 'hidden',
    hasAvailableModels: false,
    availableModelCount: 0,
    hasConfiguredModelHint: true,
  });
});

test('resolveOobePanelState keeps the panel hidden when provider options are available', () => {
  expect(resolveOobePanelState({
    modelsLoaded: true,
    modelPayload: { model_options: [{ label: 'openai/gpt-4.1' }] },
  })).toEqual({
    kind: 'hidden',
    hasAvailableModels: true,
    availableModelCount: 1,
    hasConfiguredModelHint: false,
  });
});

test('resolveOobePanelState keeps missing panel hidden when dismissed', () => {
  expect(resolveOobePanelState({
    modelsLoaded: true,
    modelPayload: { models: [] },
    providerMissingDismissed: true,
  }).kind).toBe('hidden');

  expect(resolveOobePanelState({
    modelsLoaded: true,
    modelPayload: { models: ['openai/gpt-4.1'], oobe: { provider_ready_completed_instance: true } },
  }).kind).toBe('hidden');
});

test('isProviderReadyCompletedForInstance reads the instance-scoped completion flag from model payloads', () => {
  expect(isProviderReadyCompletedForInstance({ oobe: { provider_ready_completed_instance: true } })).toBe(true);
  expect(isProviderReadyCompletedForInstance({ oobe: { provider_ready_completed_instance: false } })).toBe(false);
  expect(isProviderReadyCompletedForInstance(null)).toBe(false);
});

test('resolveOobePanelState suppresses the panel in pane-popout mode and before model readiness is known', () => {
  expect(resolveOobePanelState({
    panePopoutMode: true,
    modelsLoaded: true,
    modelPayload: { models: ['openai/gpt-4.1'] },
  }).kind).toBe('hidden');

  expect(resolveOobePanelState({
    panePopoutMode: false,
    modelsLoaded: false,
    modelPayload: { models: [] },
  }).kind).toBe('hidden');
});

test('compact passive model snapshot retains OOBE readiness without a catalogue', () => {
  expect(countAvailableModels({current:null,models:[],model_options:[],available_model_count:5})).toBe(5);
  expect(resolveOobePanelState({modelPayload:{current:null,models:[],available_model_count:5},modelsLoaded:true}).kind).toBe('hidden');
});
