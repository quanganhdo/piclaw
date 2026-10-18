import{html,render}from'../../../web/src/vendor/preact-htm.js';
import{SettingsDialogContent}from'../../../web/src/components/settings-dialog';
let entries=[{name:'synthetic/phone-entry-with-long-name',type:'secret',envVar:'SYNTHETIC_PHONE_ENTRY_WITH_LONG_NAME',updatedAt:new Date().toISOString()}];
(window as any).keychainTouches={deletes:0};window.fetch=async(_input,init)=>{if(init?.method==='DELETE'){(window as any).keychainTouches.deletes++;entries=[];}return Response.json({ok:true,entries,status:{enabled:true,reason:'ready'}});};
(window as any).__piclawSettingsRequestedSection='keychain';
render(html`<${SettingsDialogContent} onClose=${()=>{}} />`,document.getElementById('root'));
