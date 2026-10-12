import{render}from'preact';
import{KeychainSection}from'../../../web/static/visual/frontend/src/panels/settings/KeychainSection';
import{html,render as renderClassic}from'../../../web/src/vendor/preact-htm.js';
import{KeychainSection as ClassicKeychain}from'../../../web/src/components/settings/keychain';
window.fetch=async()=>{if(new URL(location.href).searchParams.has('delay'))await new Promise(resolve=>setTimeout(resolve,500));return Response.json({ok:true,entries:[],status:{enabled:false,reason:'not_configured'}});};
if(new URL(location.href).searchParams.get('skin')==='visual')render(<KeychainSection/>,document.getElementById('root')!);
else renderClassic(html`<${ClassicKeychain} />`,document.getElementById('root'));
