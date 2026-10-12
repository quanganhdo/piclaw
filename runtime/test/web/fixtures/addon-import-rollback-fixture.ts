import{loadInstalledAddonWebEntries}from'../../../web/src/ui/addon-web-extensions';
import{getSelectedDictationProvider}from'../../../web/src/ui/composer-dictation-registry';
window.fetch=async()=>Response.json({entries:[{packageName:'rollback-addon',url:'/failed-addon.js'}]});
await loadInstalledAddonWebEntries(window);
(window as any).rollbackResult={selected:getSelectedDictationProvider()?.provider.id||null};
