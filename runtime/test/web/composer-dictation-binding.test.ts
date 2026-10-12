import {expect,test} from 'bun:test';
import {createDictationComposerBinding} from '../../web/src/ui/composer-dictation-binding';
import {registerOwnedDictationProvider,selectOwnedDictationProvider,resetDictationProvidersForTests} from '../../web/src/ui/composer-dictation-registry';
test('binding synchronizes same-turn DOM edits and chat changes before provider callbacks',async()=>{
 resetDictationProvidersForTests();let draft={text:'',chatJid:'web:a',selectionStart:0,selectionEnd:0};let context:any;let cancelled=0;
 registerOwnedDictationProvider('a',{id:'a',label:'a',availability:()=>({available:true}),start:async c=>{context=c;return{finish:async()=>({status:'finished'}),cancel:async()=>{cancelled++;}};}});selectOwnedDictationProvider('a','a');
 const binding=createDictationComposerBinding({read:()=>draft,write:text=>{draft={...draft,text};},state:()=>{}});
 await binding.toggle();expect(context.updateSegment({segmentId:'a',text:'partial',final:false}).applied).toBe(true);
 draft={...draft,text:'user replacement'};
 expect(context.updateSegment({segmentId:'a',text:'late',final:true}).applied).toBe(false);
 expect(draft.text).toBe('user replacement');await binding.cancel();expect(cancelled).toBe(1);
 await binding.toggle();draft={...draft,chatJid:'web:b'};
 expect(context.updateSegment({segmentId:'a',text:'wrong chat',final:true}).applied).toBe(false);
 expect(draft.text).toBe('user replacement');await binding.dispose();resetDictationProvidersForTests();
});
test('unrelated provider registration does not cancel selected dictation',async()=>{
 resetDictationProvidersForTests();let cancelled=0;const provider=(id:string)=>({id,label:id,availability:()=>({available:true}),start:async()=>({finish:async()=>({status:'finished' as const}),cancel:async()=>{cancelled++;}})});
 registerOwnedDictationProvider('a',provider('a'));selectOwnedDictationProvider('a','a');
 const binding=createDictationComposerBinding({read:()=>({text:'',chatJid:'web:a',selectionStart:0,selectionEnd:0}),write:()=>{},state:()=>{}});
 await binding.toggle();const remove=registerOwnedDictationProvider('b',provider('b'));remove();expect(cancelled).toBe(0);expect(binding.active).toBe(true);await binding.dispose();expect(cancelled).toBe(1);resetDictationProvidersForTests();
});

test('finish-to-send continuation is fenced by provider removal and chat identity',async()=>{
 for(const change of ['remove','chat']){
  resetDictationProvidersForTests();let draft={text:'draft',chatJid:'web:a',selectionStart:5,selectionEnd:5};let finish!:()=>void;const held=new Promise<void>(resolve=>{finish=resolve;});let sends=0;
  const remove=registerOwnedDictationProvider('a',{id:'a',label:'a',availability:()=>({available:true}),start:async()=>({finish:async()=>{await held;queueMicrotask(()=>{if(change==='remove')remove();else draft={...draft,chatJid:'web:b'};});return{status:'finished'};},cancel:async()=>{}})});selectOwnedDictationProvider('a','a');
  const binding=createDictationComposerBinding({read:()=>draft,write:text=>{draft={...draft,text};},state:()=>{}});await binding.toggle();const pending=binding.submit(async()=>{sends++;});finish();await pending.catch(()=>false);expect(sends).toBe(0);await binding.dispose();resetDictationProvidersForTests();
 }
});

test('programmatic submission shares finishing and preserves the final draft once',async()=>{
 resetDictationProvidersForTests();let draft={text:'before ',chatJid:'web:a',selectionStart:7,selectionEnd:7};let context:any,release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});let sends=0;
 registerOwnedDictationProvider('a',{id:'a',label:'a',availability:()=>({available:true}),start:async c=>{context=c;return{finish:async()=>{await held;context.updateSegment({segmentId:'one',text:'final',final:true});return{status:'finished'};},cancel:async()=>{}};}});selectOwnedDictationProvider('a','a');const binding=createDictationComposerBinding({read:()=>draft,write:text=>{draft={...draft,text};},state:()=>{}});await binding.toggle();const send=()=>binding.submit(async()=>{sends++;expect(draft.text).toBe('before final');});const first=send();expect(send()).toBe(first);expect(sends).toBe(0);release();expect(await first).toBe(true);expect(sends).toBe(1);await binding.dispose();resetDictationProvidersForTests();
});
