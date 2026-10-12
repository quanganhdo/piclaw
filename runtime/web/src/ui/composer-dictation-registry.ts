import type { ComposerDictationProvider } from './composer-dictation';
export interface RegisteredDictationProvider { readonly owner: string; readonly provider: ComposerDictationProvider }
const providers = new Map<string, RegisteredDictationProvider>();
const listeners = new Set<() => void>();
let selected: RegisteredDictationProvider | undefined;
const notify = () => { for (const listener of listeners) listener(); };
/** Called only by the owner-bound API passed to a loaded add-on's entry function. */
export function registerOwnedDictationProvider(owner: string, provider: ComposerDictationProvider): () => void {
  if (!owner || !/^[a-z0-9][a-z0-9.-]{0,63}$/.test(provider.id) || !provider.label || typeof provider.start !== 'function' || typeof provider.availability !== 'function') throw Error('Invalid dictation provider registration.');
  if (providers.has(provider.id)) throw Error('Duplicate dictation provider.');
  const entry = Object.freeze({owner, provider: Object.freeze({...provider})});
  providers.set(provider.id, entry);
  let removed = false;
  return () => {
    if (removed) return; removed = true;
    if (selected === entry) selected = undefined;
    providers.delete(provider.id); notify();
  };
}
/** The add-on reads its existing persisted enablement setting, then explicitly selects itself. */
export function selectOwnedDictationProvider(owner: string, id: string | null): void {
  if (id === null) { if (selected?.owner === owner) { selected = undefined; notify(); } return; }
  const entry = providers.get(id);
  if (!entry || entry.owner !== owner) throw Error('Dictation provider belongs to another add-on or is unregistered.');
  if (selected && selected !== entry) throw Error('Another enabled dictation provider owns the composer.');
  selected = entry; notify();
}
export function getSelectedDictationProvider(): RegisteredDictationProvider | undefined { return selected; }
export function subscribeDictationProviders(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function resetDictationProvidersForTests(): void { providers.clear(); selected = undefined; notify(); }
