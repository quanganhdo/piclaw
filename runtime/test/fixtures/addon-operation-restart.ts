import { initDatabase, closeDatabase } from '../../src/db.js';
import { AddonOperationService } from '../../src/addons/operation-service.js';
import { transitionAddonOperation } from '../../src/db/addon-operations.js';

initDatabase();
const phase=process.argv[2];
const id=process.argv[3];
const grant={revision:'r1',target:'fixture',allowedTools:[],timeoutMs:1000,maxToolCalls:0,parentWorkId:null};
let executions=0;
const service=new AddonOperationService({authorize:()=>({decision:'allow',grant}),execute:async()=>{executions++;return {status:'completed',output:'fixture output'};}});
const client=service.bind({addonId:'restart',principalId:'caller'});
try{
  if(phase==='admit'){
    const receipt=await client.admit({target:'fixture',idempotencyKey:'retry-stable',text:'fixture input'});
    // Simulate process death after committed admission but before worker completion.
    service.shutdown();await service.waitForIdle();
    // Mark a real running boundary durably; recovery may not replay it.
    transitionAddonOperation(receipt.operation!.id,['queued'],'working');
    console.log('RESULT '+JSON.stringify({id:receipt.operation!.id}));
  }else if(phase==='recover'){
    service.recover();await service.waitForIdle();
    const result=await client.get(id);
    const duplicate=await client.admit({target:'fixture',idempotencyKey:'retry-stable',text:'fixture input'});
    console.log('RESULT '+JSON.stringify({result,duplicateId:duplicate.operation!.id,created:duplicate.created,executions}));
  }else throw new Error('Unknown fixture phase');
}finally{service.shutdown();await service.waitForIdle();closeDatabase();}
