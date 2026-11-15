import {expect,test} from 'bun:test';
import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {getRegisteredDomainConfigSchemas,readDomainConfig,writeDomainConfig,registerDomainConfig,boolField} from '../../src/core/domain-config.js';
import {getGeneralSettingsData,saveGeneralSettings} from '../../src/channels/web/handlers/general-settings.js';
import {getConfigPath,setCompactionRuntimeConfig,getCompactionRuntimeConfig} from '../../src/core/config.js';
import {initDatabase} from '../../src/db.js';
import {withTempWorkspaceEnv} from '../helpers.js';

const retiredGeneral=['sessionAutoRotate','sessionMaxSizeMb','sessionMaxLines','sessionMaxCompactions','automaticRecoveryEnabled','automaticRecoveryMaxAttempts','automaticRecoveryTotalBudgetMs','automaticRecoveryEffectiveBudgetMs'];
test('schema retirement cannot overlap an active field or allow duplicate historical keys',()=>{
  const fields={enabled:boolField({key:'enabled',owner:'fixture',defaultValue:false,persistence:'json-config',precedence:['persisted','default'],secretClass:'none'})};
  expect(()=>registerDomainConfig({domain:'retired-overlap-probe',fields,retiredKeys:['enabled']})).toThrow('Invalid retired domain config keys');
  expect(()=>registerDomainConfig({domain:'retired-duplicate-probe',fields,retiredKeys:['old','old']})).toThrow('Invalid retired domain config keys');
});

test('native general settings expose no retired file rotation or Core recovery policy',()=>{
  initDatabase();const data=getGeneralSettingsData();
  for(const name of retiredGeneral)expect(data).not.toHaveProperty(name);
  expect(existsSync(resolve(import.meta.dir,'../../src/agent-pool/recovery-policy.ts'))).toBe(false);
});
test('stale execution-policy input refuses the whole save before identity or config writes',async()=>{
  await withTempWorkspaceEnv('retired-execution-policy-',{},async()=>{
    const path=getConfigPath();mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify({domains:{identity:{assistantName:'keep original'}}}));
    const before=readFileSync(path,'utf8');
    await expect(saveGeneralSettings({assistantName:'must not save',automaticRecoveryEnabled:true} as any)).rejects.toThrow('Unsupported native general settings');
    expect(readFileSync(path,'utf8')).toBe(before);
  });
});
test('native auto-toggle preserves inert stored compaction fields without resolving or rewriting them',async()=>{
  await withTempWorkspaceEnv('retired-compaction-keys-',{PICLAW_AUTO_COMPACTION_ENABLED:undefined},async()=>{
    // The shared fixture enforces a valid auto-toggle override; shadow it with
    // an invalid compatibility value so this test exercises stored policy.
    const inherited=process.env.PICLAW_AUTO_COMPACTION_ENABLED;process.env.PICLAW_AUTO_COMPACTION_ENABLED='invalid-fixture-toggle';
    try {
    const path=getConfigPath(),historical={thresholdPercent:'old-invalid',maxThresholdTokens:-9,autoCompactionScope:{old:true},hardCeilingPercent:null,warningThreshold:'old',backoffDecayFactor:false,idleAutoCompactionDelayMs:-1,prePromptForegroundMs:-2};
    mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify({compaction:{threshold_percent:'old alias'},domains:{compaction:{...historical,autoCompactionEnabled:true}}}));
    for(const key of Object.keys(historical))expect(getCompactionRuntimeConfig()).not.toHaveProperty(key);
    expect(setCompactionRuntimeConfig({autoCompactionEnabled:false}).autoCompactionEnabled).toBe(false);
    const stored=JSON.parse(readFileSync(path,'utf8'));
    for(const [key,value]of Object.entries(historical))expect(stored.domains.compaction[key]).toEqual(value);
    expect(stored.compaction.threshold_percent).toBe('old alias');
    }finally{if(inherited===undefined)delete process.env.PICLAW_AUTO_COMPACTION_ENABLED;else process.env.PICLAW_AUTO_COMPACTION_ENABLED=inherited;}
  });
});

test('retired stored values are inert and preserved; unrelated unknown keys and stale writes still reject',async()=>{
  await withTempWorkspaceEnv('retired-domain-keys-',{},async()=>{
    const path=getConfigPath(),schema=getRegisteredDomainConfigSchemas().find(s=>s.domain==='session')!;
    mkdirSync(dirname(path),{recursive:true});
    const historical={maxSizeMb:'historical bytes',maxLines:-1,maxCompactionsBeforeRotation:null,autoRotate:{old:true}};
    writeFileSync(path,JSON.stringify({domains:{session:{...historical,isolation:'none'}}}));
    const options={configPath:path,env:{}};
    expect(readDomainConfig(schema,options)).toEqual({isolation:'none'});
    expect(writeDomainConfig(schema,options,{isolation:'summary'})).toEqual({isolation:'summary'});
    expect(JSON.parse(readFileSync(path,'utf8')).domains.session).toEqual({...historical,isolation:'summary'});
    expect(()=>writeDomainConfig(schema,options,{autoRotate:true})).toThrow('Unknown domain config key');
    writeFileSync(path,JSON.stringify({domains:{session:{...historical,isolation:'none',unexpectedTypo:true}}}));
    expect(()=>readDomainConfig(schema,options)).toThrow('Unknown persisted domain config key');
  });
});
