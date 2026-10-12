import {installNativeDictationFixture} from './composer-dictation-native-fixture';
import { render } from 'preact';
import { ChatPanel } from '../../../web/static/visual/frontend/src/panels/ChatPanel';
import { registerOwnedDictationProvider, selectOwnedDictationProvider } from '../../../web/src/ui/composer-dictation-registry';
let context: any;
let release!: () => void;
const held = new Promise<void>(resolve => { release = resolve; });
const calls: string[] = [];
registerOwnedDictationProvider('fixture', { id: 'fixture', label: 'Fixture', availability: () => ({available: true}), start: async c => {
 context = c; calls.push('start');
 return { finish: async () => { calls.push('finish'); await held; context.updateSegment({segmentId:'one', text:'final words', final:true}); return {status:'finished'}; }, cancel: async () => { calls.push('cancel'); } };
}});
if(!new URL(location.href).searchParams.has('native'))selectOwnedDictationProvider('fixture','fixture');
installNativeDictationFixture(calls);
Object.assign(window, {dictationFixture: {calls, release, partial: () => context.updateSegment({segmentId:'one', text:'partial', final:false})}});
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
 if (new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href).pathname.endsWith('/message')) {
  calls.push('send:' + JSON.parse(String(init?.body)).content);
  return Response.json({source_committed:true});
 }
 return originalFetch(input, init);
};
render(<ChatPanel />, document.getElementById('root')!);
