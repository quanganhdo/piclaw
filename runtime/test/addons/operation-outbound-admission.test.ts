import { beforeEach,expect,test } from 'bun:test';
import { initDatabase,getDb } from '../../src/db.js';
import { ensureBudgetWork,saveBudgetCap } from '../../src/db/budget-limits.js';
import { withBudgetWorkContext } from '../../src/budget/context.js';
import { withExecutionIdentity } from '../../src/core/execution-context.js';
import { admitAddonOutboundWork } from '../../src/addons/operation-outbound-admission.js';
beforeEach(()=>{initDatabase();getDb().exec('DELETE FROM budget_caps;');});
test('outbound admission requires real current work, observes caps and never accepts a supplied work identity',()=>{
 expect(()=>admitAddonOutboundWork('fixture')).toThrow('unavailable');
 const id=crypto.randomUUID();ensureBudgetWork({id,chatJid:'web:fixture',executionKind:'interactive'});
 const context={workId:id,chatJid:'web:fixture',kind:'interactive' as const};
 expect(withBudgetWorkContext(context,()=>admitAddonOutboundWork('fixture'))).toEqual({workId:id,chatJid:'web:fixture',allowed:true});
 expect(()=>withBudgetWorkContext({...context,chatJid:'other'},()=>admitAddonOutboundWork('fixture'))).toThrow('unavailable');
 expect(()=>withBudgetWorkContext(context,()=>withExecutionIdentity({mode:'family-shared'} as never,()=>admitAddonOutboundWork('fixture')))).toThrow('unavailable');
 saveBudgetCap({scope:'task',metric:'api_usd_micros',amount:0,enabled:true,workId:id});
 expect(()=>withBudgetWorkContext(context,()=>admitAddonOutboundWork('fixture'))).toThrow('unavailable');
 expect(getDb().query('SELECT status FROM budget_work WHERE id=?').get(id)).toEqual({status:'paused'});
});
