import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root=join(import.meta.dir,'..');
const required:Record<string,string[]>={
  'channels/web/family-authorisation.test.ts':['SSE receives only approved own-chat events','foreign, unknown, blank, duplicate and unowned targets all deny'],
  'channels/web/family-message-provenance.test.ts':['admission atomically persists owner/login authority','queued processChat recovers persisted identity'],
  'agent-pool/owned-fork-lifecycle.test.ts':['family HTTP fork/rename/picker use cookie owner','runtime handle lookup and active/known lists'],
  'web/family.playwright.optional.test.ts':['switch account is distinct','owned session Settings creates, renames','account profile and device controls','memory publication previews exact source','due task run requires separate confirmation'],
  'agent-pool/scheduled-dispatch.test.ts':['two concurrent owners retain separate identities'],
  'agent-memory/family-dream-admission.test.ts':['provider capacity allows one per owner and two globally'],
  'db/family-workspace-policy.test.ts':['workspace policy distinguishes routing/config/activation and shared filesystem from private conversation scope'],
};

test('family release acceptance manifest retains the supported two-user browser and runtime outcomes',()=>{
  for(const [relative,names] of Object.entries(required)){
    const source=readFileSync(join(root,relative),'utf8');
    for(const name of names)expect(source,name).toContain(name);
  }
});

test('family release keeps explicitly unsupported global surfaces denied in the user guide',()=>{
  const source=readFileSync(join(import.meta.dir,'../../../docs/multi-user/user-guide.md'),'utf8');
  for(const text of ['global provider login and generic add-on panes','shell, terminal and VNC access','automatic family task scheduling and Dream','cross-account sharing','privileged Adaptive Card/add-on intents'])expect(source).toContain(text);
  for(const supported of ['standard compose box','attachment upload/download/preview','Generic Adaptive Card submissions','widget text submissions'])expect(source).toContain(supported);
});
