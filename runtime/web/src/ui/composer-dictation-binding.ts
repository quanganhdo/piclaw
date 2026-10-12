import { ComposerDictationController, type DictationDraft, type DictationState } from './composer-dictation';
import { getSelectedDictationProvider, subscribeDictationProviders } from './composer-dictation-registry';
export interface DictationComposerBindingHost {
  read(): {text:string;chatJid:string;selectionStart:number;selectionEnd:number};
  write(text:string):void;
  state(state:DictationState,message?:string):void;
  providerSelected?():void;
}
/** Shared by both skins; core remains the only writer/submission owner. */
export function createDictationComposerBinding(host:DictationComposerBindingHost){
 let revision=0,previous=host.read(),disposed=false,intentGeneration=0;
 const draft=():DictationDraft=>{synchronize();return {...host.read(),revision};};
 const controller=new ComposerDictationController({readDraft:draft,writeDraft:(text,expected)=>{
  synchronize();
  if(disposed||revision!==expected)return false;
  host.write(text);revision++;previous={...host.read(),text};return true;
 },state:host.state});
 function synchronize(){
  const current=host.read();
  if(current.text!==previous.text||current.chatJid!==previous.chatJid){intentGeneration++;const before={...previous,revision};revision++;previous=current;controller.draftChanged(before,{...current,revision});}
 };
 let selected=getSelectedDictationProvider()?.provider;
 const unsubscribe=subscribeDictationProviders(()=>{const next=getSelectedDictationProvider()?.provider;if(next!==selected){intentGeneration++;if(controller.active)void controller.cancel();if(next)host.providerSelected?.();}selected=next;});
 return{
  get selected(){return getSelectedDictationProvider()?.provider;},
  get active(){return controller.active;},
  draftChanged:synchronize,
  async toggle():Promise<boolean>{synchronize();const provider=getSelectedDictationProvider()?.provider;if(!provider)return false;if(controller.active)await controller.finish();else await controller.start(provider);return true;},
  submit(send:()=>Promise<void>):Promise<boolean>{synchronize();const generation=intentGeneration,chatJid=host.read().chatJid,provider=getSelectedDictationProvider()?.provider;return controller.submit(async()=>{synchronize();if(disposed||intentGeneration!==generation||host.read().chatJid!==chatJid||getSelectedDictationProvider()?.provider!==provider)return;await send();});},
  async dispose(){disposed=true;unsubscribe();await controller.cancel();},
  cancel:()=>{intentGeneration++;return controller.cancel();},
 };
}
