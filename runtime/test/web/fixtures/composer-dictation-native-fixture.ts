import {selectOwnedDictationProvider} from '../../../web/src/ui/composer-dictation-registry';
export function installNativeDictationFixture(calls:string[]){
 const mode=new URL(location.href).searchParams.get('native');if(!mode)return;
 let native:any;
 class Recognition {
  onstart:any;onresult:any;onerror:any;onend:any;continuous=true;interimResults=true;lang='en-US';
  constructor(){native=this;}
  start(){calls.push('native-start');this.onstart?.();}
  abort(){calls.push('native-abort');}
  stop(){calls.push('native-stop');}
 }
 Object.assign(window,{SpeechRecognition:Recognition,nativeDictationFixture:{enable:()=>selectOwnedDictationProvider('fixture','fixture'),late:()=>{native.onresult?.({resultIndex:0,results:[Object.assign([{transcript:'vendor late'}],{isFinal:true})]});native.onend?.();native.onerror?.({error:'network'});}}});
}
